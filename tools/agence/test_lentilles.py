#!/usr/bin/env python3
"""Spec 010, lot 8 : lentilles (FR-007). Une lentille reçoit la fiche seule et une consigne d'angle, propose, ne tranche
jamais. Elle se déclenche à la demande ou sur une décision structurante validée, toujours par une carte : aucun agent
sans clic. La liste est un fichier de données éditable. `cate` est simulé ; état en dossier temporaire et faux HOME."""
import contextlib
import io
import json
import os
import random
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
import backlog  # noqa: E402
import pratiques  # noqa: E402
from test_revue import NOW, Carte  # noqa: E402

LIVREES = os.path.join(HERE, 'lentilles.json')


def fiche_complete():
	b = backlog.vide()
	backlog.ajouter(b, 'Autre fiche secrète', NOW)
	f = backlog.ajouter(b, 'Exporter le registre', NOW, type='tache', priorite='P2', preuve='pr-merged:', fichiers=['docs/decisions.md'],
	                    dependances=['F1'], budgetJetons=20000, vision='FR-007', decisions=['D1'])
	backlog.noter(b, f['id'], 'journal secret', NOW)
	return f


class Liste(unittest.TestCase):
	"""T140 : brief = fiche + consigne ; tirage ; liste éditable."""

	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='lentilles-test-')
		self.addCleanup(shutil.rmtree, self.tmp, True)

	def test_six_lentilles_livrees_modele_null(self):
		ls = backlog.charger_lentilles(LIVREES)
		self.assertEqual([x['nom'] for x in ls], ['inverser', 'supprimer', 'novice', 'dans-un-an', 'pire-cas', 'agence-reelle'])
		self.assertTrue(all(x['consigne'].strip() and x['modele'] is None for x in ls))

	def test_brief_fiche_et_consigne_seules(self):
		f = fiche_complete()
		lentille = backlog.tirer(backlog.charger_lentilles(LIVREES), 'pire-cas')
		texte = backlog.brief_lentille(f, lentille)
		for morceau in (lentille['consigne'], 'F2 : Exporter le registre', 'docs/decisions.md', 'FR-007', 'pr-merged:', 'tache', 'P2'):
			self.assertIn(morceau, texte)
		for absent in ('D1', 'journal secret', 'Autre fiche secrète', 'F1', '20000', 'decisions :', 'dependances', 'journal'):
			self.assertNotIn(absent, texte)
		self.assertIn('ne tranche pas', texte)

	def test_hasard_avec_graine(self):
		ls = backlog.charger_lentilles(LIVREES)
		tires = [backlog.tirer(ls, rng=random.Random(7))['nom'] for _ in range(3)]
		self.assertEqual(len(set(tires)), 1)  # même graine, même tirage
		self.assertEqual(tires[0], random.Random(7).choice(ls)['nom'])

	def test_nom_inconnu_refuse_avec_la_liste(self):
		with self.assertRaises(backlog.Refus) as ctx:
			backlog.tirer(backlog.charger_lentilles(LIVREES), 'flou')
		self.assertIn('pire-cas', str(ctx.exception))

	def test_une_lentille_ajoutee_au_fichier_est_tiree(self):
		with open(LIVREES) as f:
			ls = json.load(f)
		ls.append({'nom': 'juriste', 'consigne': 'Lis la fiche comme un juriste.', 'modele': None})
		path = os.path.join(self.tmp, 'lentilles.json')
		with open(path, 'w') as f:
			json.dump(ls, f)
		rng = random.Random(3)
		self.assertIn('juriste', {backlog.tirer(backlog.charger_lentilles(path), rng=rng)['nom'] for _ in range(60)})
		self.assertEqual(backlog.tirer(backlog.charger_lentilles(path), 'juriste')['consigne'], 'Lis la fiche comme un juriste.')

	def test_fichier_invalide_refuse(self):
		path = os.path.join(self.tmp, 'lentilles.json')
		for contenu in ([], [{'nom': 'a', 'consigne': 'x'}], [{'nom': 'a', 'consigne': ' ', 'modele': None}],
		                [{'nom': 'a', 'consigne': 'x', 'modele': None}] * 2, [{'nom': 'a b', 'consigne': 'x', 'modele': None}]):
			with open(path, 'w') as f:
				json.dump(contenu, f)
			with self.assertRaises(backlog.Invalide, msg=contenu):
				backlog.charger_lentilles(path)


class Eclairer(Carte):
	"""T141 : une décision structurante validée pose une carte « Éclairer » ; le clic prévient l'orchestrateur, ne lance
	rien ; la note de lentille ne change ni l'état de la fiche ni le registre."""

	def setUp(self):
		super().setUp()
		code, _ = self.cli('fiche', 'add', 'Exporter le registre', '--decision', 'D1', '--vision', 'FR-007')
		self.assertEqual(code, 0)

	def proposer(self, *opts):
		code, out = self.cli('decision', 'add', 'Registre en JSON', '--pourquoi', 'éditable', *opts)
		self.assertEqual((code, out.strip()), (0, 'D1'))
		return next(q for q in self.questions() if 'D1 ' in q['question'])

	def eclairer(self):
		return [q for q in self.questions() if q['question'].startswith('Éclairer')]

	def lancements(self):
		return self.run.ran('cate', 'agent', 'start')

	def test_structurante_validee_pose_une_carte_eclairer(self):
		self.assertEqual(self.repond(self.proposer('--structurante'), 'Valider'), (303, '/'))
		[q] = self.eclairer()
		self.assertIn('D1', q['question'])
		self.assertEqual([o['label'] for o in q['options']], ['Éclairer F1', 'Vu'])
		self.assertEqual(q['clics'], ['/lentille/F1/eclairer', ''])
		self.assertEqual(self.envois(), [])
		self.assertEqual(self.lancements(), [])

	def test_decision_ordinaire_ou_rejetee_aucune_carte(self):
		self.repond(self.proposer(), 'Valider')
		self.assertEqual(self.eclairer(), [])
		with agence.verrou():
			d = backlog.charger(self.tmp)['decisions']
			backlog.decision_ajouter(d, 'autre', 'p', NOW, structurante=True)
			backlog.ecrire(self.tmp, 'decisions.json', d)
		self.assertEqual(agence.click('/decision/D2/rejeter', {}), (303, '/'))
		self.assertEqual(self.eclairer(), [])

	def test_clic_previent_l_orchestrateur_sans_lancer(self):
		self.repond(self.proposer('--structurante'), 'Valider')
		[q] = self.eclairer()
		self.assertEqual(self.repond(q, 'Éclairer F1'), (303, '/'))
		[msg] = [c[c.index('--panel') + 2] for c in self.envois()]
		self.assertIn('agence lentille F1 --hasard', msg)
		self.assertIn('agence fiche note F1', msg)
		self.assertEqual(self.lancements(), [])  # l'orchestrateur lance, jamais le régisseur
		self.assertEqual(self.eclairer(), [])
		self.assertEqual(self.repond(q, 'Éclairer F1')[0], 409)  # double clic

	def test_post_sans_carte_ouverte_refuse(self):
		code, msg = agence.click('/lentille/F1/eclairer', {})
		self.assertEqual(code, 409)
		self.assertIn('carte', msg)
		self.assertEqual(self.envois(), [])

	def test_post_rejoue_previent_une_seule_fois(self):
		self.cli('lentille', 'F1', '--carte')
		self.assertEqual(agence.click('/lentille/F1/eclairer', {}), (303, '/'))
		self.assertEqual(agence.click('/lentille/F1/eclairer', {})[0], 409)
		self.assertEqual(len(self.envois()), 1)

	def test_a_la_demande_une_carte_jamais_un_agent(self):
		code, out = self.cli('lentille', 'F1', '--carte')
		self.assertEqual(code, 0)
		[q] = self.eclairer()
		self.assertEqual(q['clics'], ['/lentille/F1/eclairer', ''])
		self.assertEqual((self.envois(), self.lancements()), ([], []))

	def test_brief_par_la_cli(self):
		code, out = self.cli('lentille', 'F1', '--nom', 'novice')
		self.assertEqual(code, 0)
		self.assertIn('F1 : Exporter le registre', out)
		self.assertNotIn('D1', out)
		sortie = io.StringIO()
		with contextlib.redirect_stdout(sortie):
			self.assertEqual(agence.main(['lentille', 'F1', '--hasard', '--json']), 0)
		j = json.loads(sortie.getvalue())
		self.assertEqual(set(j), {'nom', 'modele', 'brief'})
		self.assertIn('F1 : Exporter le registre', j['brief'])

	def test_fichier_du_projet_remplace_la_liste_livree(self):
		"""FR-007 : liste éditable par projet, à côté du fichier de politique du projet ; invalide, refus lisible."""
		projet = backlog.chemin(self.tmp, 'lentilles.json')
		self.assertEqual(os.path.dirname(projet), os.path.dirname(pratiques.fichier_projet(self.tmp)))
		with open(projet, 'w') as f:
			json.dump([{'nom': 'juriste', 'consigne': 'Lis la fiche comme un juriste.', 'modele': None}], f)
		code, out = self.cli('lentille', 'F1', '--hasard')
		self.assertEqual(code, 0)
		self.assertIn('Lentille juriste : Lis la fiche comme un juriste.', out)
		code, _ = self.cli('lentille', 'F1', '--nom', 'novice')  # la liste livrée est remplacée, pas complétée
		self.assertNotEqual(code, 0)
		with open(projet, 'w') as f:
			json.dump([{'nom': 'juriste'}], f)
		err = io.StringIO()
		with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
			code = agence.main(['lentille', 'F1', '--hasard'])
		self.assertNotEqual(code, 0)
		self.assertIn('lentilles.json du projet : lentille invalide', err.getvalue())
		self.assertNotIn('Traceback', err.getvalue())
		os.remove(projet)
		self.assertEqual(self.cli('lentille', 'F1', '--nom', 'novice')[0], 0)

	def test_note_de_lentille_ne_change_ni_etat_ni_registre(self):
		self.repond(self.proposer('--structurante'), 'Valider')
		registre = backlog.chemin(self.tmp, 'decisions.json')
		with open(registre, 'rb') as f:
			avant = f.read()
		code, _ = self.cli('fiche', 'note', 'F1', 'lentille pire-cas : si le registre casse, aucun lot ne part')
		self.assertEqual(code, 0)
		f1 = backlog.charger(self.tmp)['backlog']['fiches'][0]
		self.assertEqual(f1['etat'], 'discussion')
		self.assertEqual(f1['journal'][-1]['text'], 'lentille pire-cas : si le registre casse, aucun lot ne part')
		with open(registre, 'rb') as f:
			self.assertEqual(f.read(), avant)


if __name__ == '__main__':
	unittest.main()
