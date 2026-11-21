#!/usr/bin/env python3
"""Réglages par workspace, pour tous (spec 008, lots 1 et 2) : schéma en mots simples, champs publiés par le
régisseur, refus en phrases humaines, écriture par les routes /pratiques/..., couche ponctuelle de `agence start`.

Tout tourne en faux HOME et en dossier temporaire : un test échoue s'il voit le vrai ~/.config ou ~/.cate.
La vue publiée est le contrat du formulaire du panneau : fixtures/vue-reglages.json est une vraie sortie de un_tour,
comparée à chaque passage (AGENCE_REGEN_FIXTURES=1 la réécrit).
"""
import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
import pratiques  # noqa: E402
from test_agence import FakeRun  # noqa: E402

NOUVELLES = {'notifications.systeme': 'oui', 'notifications.rappel': 300, 'agents.modele': 'auto', 'agents.effort': 'auto'}
QUESTIONS = ['livraison.mode', 'tests', 'verification', 'agents.max']  # Q7 de 008, ordre du schéma
CHAMP = {'cle', 'nom', 'explique', 'groupe', 'portee', 'question', 'forme', 'choix', 'bornes', 'vide', 'defaut', 'valeur',
         'origine'}
FIXTURE = os.path.join(HERE, 'fixtures', 'vue-reglages.json')


class Base(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='reglages-test-')
		self.addCleanup(shutil.rmtree, self.tmp, True)
		self.home = os.path.join(self.tmp, 'home')
		self.racine = os.path.join(self.tmp, 'projet')
		os.makedirs(self.home)
		os.makedirs(self.racine)
		env = unittest.mock.patch.dict(os.environ, {'HOME': self.home, 'AGENCE_ROOT': self.racine, 'AGENCE_NOM': 'Camille',
		                                            'CATE_SOCKET': os.path.join(self.tmp, 'x.sock')})
		env.start()
		self.addCleanup(env.stop)
		self.assertTrue(os.path.expanduser('~').startswith(self.tmp))
		self.projet = pratiques.fichier_projet(self.racine)
		self.dev = pratiques.fichier_dev(self.home)
		self.sch = pratiques.schema()
		ancien = agence.RUN
		agence.RUN = self.run = FakeRun()
		self.addCleanup(setattr, agence, 'RUN', ancien)

	def ecrit(self, chemin, contenu):
		os.makedirs(os.path.dirname(chemin), exist_ok=True)
		with open(chemin, 'w') as f:
			f.write(contenu if isinstance(contenu, str) else json.dumps(contenu))

	def lit(self, chemin):
		with open(chemin) as f:
			return json.load(f)

	def agence(self, *argv):
		out, err = io.StringIO(), io.StringIO()
		with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
			code = agence.main(list(argv))
		return code, out.getvalue(), err.getvalue()

	def show(self):
		code, out, err = self.agence('pratiques', 'show', '--json')
		self.assertEqual(code, 0, err)
		return json.loads(out)

	def tour(self):
		agence.un_tour()
		return agence.load()['pratiques']

	def post(self, route, **form):
		return agence.click(route, {k: v if isinstance(v, list) else [v] for k, v in form.items()})


def textes(sch):
	"""Tous les textes montrés à une personne : noms, phrases, libellés, questions, presets, phrases des cohérences."""
	for spec in sch['cles'].values():
		yield from (spec[k] for k in ('nom', 'explique', 'question', 'vide') if k in spec)
		yield from spec.get('choix', {}).values()
	for p in sch['presets'].values():
		yield p['explique']
	for c in sch['coherences']:
		yield c['phrase']


# ---------- T001 : schéma complet (FR-001, FR-002) ----------

class Schema(Base):
	def test_chaque_cle_se_dit_en_mots_simples(self):
		for cle, spec in self.sch['cles'].items():
			with self.subTest(cle=cle):
				for champ in ('nom', 'explique', 'groupe', 'portee'):
					self.assertTrue(spec.get(champ), champ)
				self.assertIn(spec['groupe'], ('essentiel', 'avance'))
				self.assertIn(spec['portee'], ('workspace', 'dev'))
				self.assertNotIn('dit', spec)  # coupe nette : explique remplace dit
				if spec['groupe'] == 'essentiel':
					self.assertTrue(spec.get('question'))
				if spec.get('nul'):
					self.assertTrue(spec.get('vide'), 'une valeur vide permise a son libellé')

	def test_chaque_valeur_permise_a_un_libelle(self):
		for cle, spec in self.sch['cles'].items():
			permis = spec.get('valeurs') or spec.get('liste') or []
			with self.subTest(cle=cle):
				self.assertEqual(sorted(spec.get('choix', {})), sorted(pratiques.cle_choix(v) for v in permis))
				self.assertTrue(all(spec['choix'].values()) if permis else True)

	def test_trois_a_cinq_questions_dans_l_ordre(self):
		qs = [k for k, s in self.sch['cles'].items() if s.get('question')]
		self.assertEqual(qs, QUESTIONS)
		self.assertTrue(3 <= len(qs) <= 5)
		self.assertEqual([k for k, s in self.sch['cles'].items() if s['groupe'] == 'essentiel'], QUESTIONS)

	def test_presets_nommes_valeurs_dessous(self):
		for nom, p in self.sch['presets'].items():
			with self.subTest(preset=nom):
				self.assertEqual(set(p), {'nom', 'explique', 'valeurs'})
				self.assertLessEqual(set(p['valeurs']), set(self.sch['cles']))
		self.assertIn('PR', self.sch['presets']['pr-tdd']['nom'])

	def test_quatre_nouvelles_cles_dans_les_deux_presets(self):
		for cle, defaut in NOUVELLES.items():
			with self.subTest(cle=cle):
				self.assertIn(cle, self.sch['cles'])
				for p in self.sch['presets'].values():
					self.assertEqual(p['valeurs'][cle], defaut)
		self.assertEqual(self.sch['cles']['agents.effort']['valeurs'], ['auto', *agence.EFFORTS])
		self.assertEqual(self.sch['cles']['notifications.rappel']['valeurs'], [0, 300, 900])

	def test_chaque_coherence_a_sa_phrase(self):
		for c in self.sch['coherences']:
			self.assertTrue(c.get('phrase'))

	def test_textes_sans_jargon(self):
		cles = [c for c in self.sch['cles'] if '.' in c] + ['speckit', 'tdd', 'differente']  # tests, issue, preuve : des mots
		for t in textes(self.sch):
			with self.subTest(t=t):
				self.assertFalse(any(c in t for c in cles), 'clé technique visible')
				self.assertNotRegex(t, r'\bagence (start|pratiques|need|ask|draft|watch)\b|\bPR\b|[{}`]|/')  # ni commande, ni « PR » hors du nom du preset

	def test_declencheurs_nommes_par_la_table(self):
		champ = next(c for c in pratiques.champs(self.sch, pratiques.charger(self.racine, self.home))
		             if c['cle'] == 'declencheurs.actifs')
		table = agence.charger_table()
		self.assertEqual(champ['choix'], [{'valeur': r['id'], 'libelle': r['nom']} for r in table])


# ---------- T002 : champs publiés (FR-003, SC-003) ----------

class Champs(Base):
	def test_un_tour_publie_les_champs_dans_l_ordre_du_schema(self):
		pub = self.tour()
		self.assertEqual([c['cle'] for c in pub['champs']], list(self.sch['cles']))
		for c in pub['champs']:
			with self.subTest(cle=c['cle']):
				self.assertEqual(set(c), CHAMP)

	def test_valeur_et_origine_egales_a_show(self):
		self.ecrit(self.dev, {'preset': 'pr-tdd', 'livraison': {'methode': 'merge'}})
		self.ecrit(self.projet, {'agents': {'max': 2}, 'tests': 'libre'})
		pub, show = self.tour(), self.show()
		for c in pub['champs']:
			with self.subTest(cle=c['cle']):
				self.assertEqual((c['valeur'], c['origine']), (show['valeurs'][c['cle']], show['sources'][c['cle']]))
		origines = {c['cle']: c['origine'] for c in pub['champs']}
		self.assertEqual((origines['agents.max'], origines['livraison.methode'], origines['modele.tri']),
		                 ('projet', 'dev', 'défaut'))

	def test_defaut_du_preset_neutre(self):
		self.ecrit(self.projet, {'preset': 'pr-tdd'})
		for c in self.tour()['champs']:
			with self.subTest(cle=c['cle']):
				self.assertEqual(c['defaut'], self.sch['presets']['neutre']['valeurs'].get(c['cle']))

	def test_forme_et_choix(self):
		champs = {c['cle']: c for c in self.tour()['champs']}
		self.assertEqual((champs['agents.max']['forme'], champs['agents.max']['bornes'], champs['agents.max']['choix']),
		                 ('entier', [1, 16], None))
		self.assertEqual(champs['tests']['forme'], 'valeurs')
		self.assertEqual(champs['tests']['choix'][1], {'valeur': 'tdd', 'libelle': self.sch['cles']['tests']['choix']['tdd']})
		self.assertEqual(champs['notifications.rappel']['choix'][0]['valeur'], 0)
		self.assertEqual((champs['preuve']['forme'], champs['declencheurs.actifs']['forme']), ('liste', 'liste'))
		self.assertEqual((champs['modele.tri']['forme'], champs['modele.tri']['choix']), ('motif', None))
		self.assertTrue(champs['preuve']['vide'])
		self.assertIsNone(champs['tests']['vide'])
		self.assertEqual(champs['tests']['question'], self.sch['cles']['tests']['question'])

	def test_projet_et_nb_projet(self):
		pub = self.tour()
		self.assertEqual((pub['projet'], pub['nbProjet']), (False, 0))
		self.ecrit(self.projet, {})
		self.assertEqual((self.tour()['projet'], self.tour()['nbProjet']), (True, 0))
		self.ecrit(self.projet, {'preset': 'pr-tdd', 'agents': {'max': 2}, 'livraison': {'methode': 'merge'}})
		self.assertEqual(self.tour()['nbProjet'], 2)  # le preset n'est pas un réglage posé

	def test_presets_et_actif(self):
		pub = self.tour()
		self.assertEqual([(p['id'], p['actif']) for p in pub['presets']], [('neutre', True), ('pr-tdd', False)])
		self.assertEqual(pub['presets'][1]['nom'], self.sch['presets']['pr-tdd']['nom'])
		self.ecrit(self.projet, {'preset': 'pr-tdd'})
		self.assertEqual([p['actif'] for p in self.tour()['presets']], [False, True])

	def test_invariants_avec_le_nom_de_l_humain(self):
		inv = self.tour()['invariants']
		self.assertEqual(len(inv), len(self.sch['invariants']))
		self.assertIn('Camille', inv[0])
		self.assertFalse(any('{humain}' in i for i in inv))

	def test_fichier_invalide_champs_de_neutre_et_erreur(self):
		self.ecrit(self.projet, '{')
		pub = self.tour()
		self.assertTrue(pub['erreur'])
		self.assertEqual((pub['projet'], pub['nbProjet']), (True, 0))
		self.assertEqual({c['origine'] for c in pub['champs']}, {'défaut'})

	def test_fixture_du_contrat(self):
		"""La vue publiée, telle que le formulaire du panneau la reçoit (lot 3) : une vraie sortie de un_tour."""
		self.ecrit(self.projet, {'agents': {'max': 2}})
		pub = self.tour()
		vue = {k: pub[k] for k in ('preset', 'erreur', 'champs', 'presets', 'projet', 'nbProjet', 'invariants')}
		if os.environ.get('AGENCE_REGEN_FIXTURES') == '1':
			with open(FIXTURE, 'w') as f:
				json.dump(vue, f, ensure_ascii=False, indent=1)
				f.write('\n')
		with open(FIXTURE) as f:
			self.assertEqual(json.load(f), vue)


# ---------- T003 : phrases humaines (FR-005, SC-005) ----------

HORS_LISTE = {
	'livraison.mode': 'branche', 'livraison.merge': 'auto', 'livraison.methode': 'fast-forward', 'issue': 'parfois',
	'tests': 'tdd-strict', 'speckit': 'souvent', 'verification': 'croisee', 'preuve': ['pr-mergee', 'deploiement'],
	'agents.max': 17, 'declencheurs.actifs': ['T1', 'T99'], 'envoi.slack.variable': 'jeton-secret-1',
	'envoi.slack.fichier': 'jeton-secret-2', 'modele.tri': 42, 'modele.interlocuteur': 'opus --dangerously',
	'modele.implementation': ['sonnet'], 'modele.structurant': '', 'notifications.systeme': True,
	'notifications.rappel': 60, 'agents.modele': 'gpt', 'agents.effort': 'extreme',
}


class Phrases(Base):
	def test_une_valeur_hors_liste_par_cle(self):
		self.assertEqual(set(HORS_LISTE), set(self.sch['cles']))
		for cle, v in HORS_LISTE.items():
			with self.subTest(cle=cle):
				with self.assertRaises(pratiques.Invalide) as ctx:
					pratiques.regler(self.racine, self.home, cle, v)
				phrase = ctx.exception.phrase
				self.assertIn(self.sch['cles'][cle]['nom'], phrase)
				self.assertNotIn(cle, phrase)
				self.assertNotIn(self.tmp, phrase)
				self.assertNotIn('secret', phrase)  # la valeur refusée n'est jamais répétée
				for lib in self.sch['cles'][cle].get('choix', {}).values():
					self.assertIn(lib, phrase)

	def test_les_deux_coherences(self):
		c1, c2 = self.sch['coherences']
		with self.assertRaises(pratiques.Invalide) as ctx:
			pratiques.regler_plusieurs(self.racine, self.home, [('livraison.mode', 'main'), ('preuve', ['pr-mergee'])])
		self.assertEqual(ctx.exception.phrase, c1['phrase'])
		with self.assertRaises(pratiques.Invalide) as ctx:
			pratiques.regler_plusieurs(self.racine, self.home, [('verification', 'differente'), ('agents.max', 1)])
		self.assertEqual(ctx.exception.phrase, c2['phrase'])

	def test_cle_inconnue_et_fichier_illisible(self):
		with self.assertRaises(pratiques.Invalide) as ctx:
			pratiques.regler(self.racine, self.home, 'agents.maxi', 3)
		self.assertNotIn('agents.maxi', ctx.exception.phrase)
		self.ecrit(self.projet, '{')
		with self.assertRaises(pratiques.Invalide) as ctx:
			pratiques.regler(self.racine, self.home, 'tests', 'tdd')
		self.assertNotIn(self.tmp, ctx.exception.phrase)

	def test_la_cli_garde_la_cle_et_ajoute_la_phrase(self):
		code, _, err = self.agence('pratiques', 'set', 'tests', 'tdd-strict')
		self.assertEqual(code, 2)
		self.assertIn('tests', err)
		self.assertIn(self.projet, err)
		self.assertIn(self.sch['cles']['tests']['nom'], err)


# ---------- T004 : routes du régisseur (FR-004) ----------

class Routes(Base):
	def test_set_ecrit_le_fichier_du_projet(self):
		self.assertEqual(self.post('/pratiques/set', cle='agents.max', valeur='2')[0], 303)
		self.assertEqual(self.lit(self.projet), {'agents': {'max': 2}})
		pub = agence.load()['pratiques']  # publié tout de suite : le formulaire n'attend pas le tour suivant
		self.assertEqual(next(c for c in pub['champs'] if c['cle'] == 'agents.max')['origine'], 'projet')

	def test_portee_dev_ecrit_le_fichier_du_dev(self):
		self.assertEqual(self.post('/pratiques/set', cle='envoi.slack.variable', valeur='MON_SLACK')[0], 303)
		self.assertEqual(self.lit(self.dev), {'envoi': {'slack': {'variable': 'MON_SLACK'}}})
		self.assertFalse(os.path.exists(self.projet))

	def test_plusieurs_paires_une_ecriture_toutes_ou_aucune(self):
		ecritures = []
		vrai = os.replace
		with unittest.mock.patch('os.replace', side_effect=lambda *a: (ecritures.append(a), vrai(*a))):
			code, _ = self.post('/pratiques/set', cle=['tests', 'agents.max'], valeur=['"tdd"', '3'])
		self.assertEqual((code, [a[1] for a in ecritures if 'pratiques' in a[1]]), (303, [self.projet]))
		self.assertEqual(self.lit(self.projet), {'tests': 'tdd', 'agents': {'max': 3}})
		code, msg = self.post('/pratiques/set', cle=['verification', 'agents.max'], valeur=['differente', '40'])
		self.assertEqual(code, 400)
		self.assertIn(self.sch['cles']['agents.max']['nom'], msg)
		self.assertEqual(self.lit(self.projet), {'tests': 'tdd', 'agents': {'max': 3}})  # aucune

	def test_portees_melangees_refusees(self):
		code, _ = self.post('/pratiques/set', cle=['tests', 'envoi.slack.variable'], valeur=['tdd', 'X'])
		self.assertEqual(code, 400)
		self.assertFalse(os.path.exists(self.projet) or os.path.exists(self.dev))

	def test_unset(self):
		self.ecrit(self.projet, {'agents': {'max': 2}, 'tests': 'tdd'})
		self.assertEqual(self.post('/pratiques/unset', cle='agents.max')[0], 303)
		self.assertEqual(self.lit(self.projet), {'tests': 'tdd'})

	def test_preset_avec_et_sans_remplacer(self):
		self.ecrit(self.projet, {'agents': {'max': 2}})
		self.assertEqual(self.post('/pratiques/preset', nom='pr-tdd')[0], 303)
		self.assertEqual(self.lit(self.projet), {'agents': {'max': 2}, 'preset': 'pr-tdd'})
		self.assertEqual(self.post('/pratiques/preset', nom='neutre', remplacer='1')[0], 303)
		self.assertEqual(self.lit(self.projet), {'preset': 'neutre'})

	def test_remplacer_repare_un_fichier_illisible(self):
		self.ecrit(self.projet, '{')
		self.assertEqual(self.post('/pratiques/preset', nom='neutre', remplacer='1')[0], 303)
		self.assertEqual(self.lit(self.projet), {'preset': 'neutre'})

	def test_refus_400_et_phrase(self):
		for route, form in (('/pratiques/set', {'cle': 'tests', 'valeur': 'tdd-strict'}),
		                    ('/pratiques/set', {'cle': 'inconnue', 'valeur': '1'}),
		                    ('/pratiques/set', {}),
		                    ('/pratiques/unset', {'cle': 'inconnue'}),
		                    ('/pratiques/preset', {'nom': 'inconnu'})):
			with self.subTest(route=route, form=form):
				code, msg = self.post(route, **form)
				self.assertEqual(code, 400)
				self.assertTrue(msg)
				self.assertNotIn(self.tmp, msg)
				self.assertNotRegex(msg, r'\b(tests|inconnue?)\b')
		self.assertFalse(os.path.exists(self.projet))
		_, msg = self.post('/pratiques/set', cle='tests', valeur='tdd-strict')
		self.assertIn(self.sch['cles']['tests']['nom'], msg)

	def test_cli_preset_remplacer(self):
		self.ecrit(self.projet, {'agents': {'max': 2}})
		self.assertEqual(self.agence('pratiques', 'preset', 'pr-tdd', '--remplacer')[0], 0)
		self.assertEqual(self.lit(self.projet), {'preset': 'pr-tdd'})


if __name__ == '__main__':
	unittest.main()
