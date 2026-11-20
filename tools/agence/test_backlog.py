#!/usr/bin/env python3
"""Backlog de fiches et registre de décisions (spec 010, lot 1) : schéma, transitions, fichiers édités à la main,
commandes `agence fiche` et `agence decision`.

Tout tourne en faux HOME et en dossier temporaire : un test échoue s'il voit le vrai ~/.cate ou ~/.config.
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
import backlog  # noqa: E402

T0 = '2026-11-20T10:00:00+00:00'
COMPLETE = {'type': 'tache', 'preuve': 'pr-merged:', 'priorite': 'P2', 'fichiers': ['src/a.ts'], 'budgetJetons': 10000,
            'vision': 'FR-003'}


class Schema(unittest.TestCase):
	"""T001 : schéma, ids, champs exigés pour `prête`, dépendances."""

	def test_fiche_neuve(self):
		b = backlog.vide()
		f = backlog.ajouter(b, 'x', T0, type='idee')
		self.assertEqual((f['id'], f['etat'], f['titre'], f['type']), ('F1', 'discussion', 'x', 'idee'))
		self.assertEqual(set(f), set(backlog.CHAMPS_FICHE))
		self.assertEqual((f['creee'], f['maj'], f['besoin'], f['modele']), (T0, T0, None, None))
		self.assertEqual((f['fichiers'], f['dependances'], f['decisions'], f['journal']), ([], [], [], []))
		backlog.valider(b)

	def test_ids_croissants(self):
		b = backlog.vide()
		self.assertEqual([backlog.ajouter(b, t, T0)['id'] for t in 'abc'], ['F1', 'F2', 'F3'])
		self.assertEqual(b['seq'], 3)

	def test_edit_refuse_un_titre_vide(self):
		b = backlog.vide()
		backlog.ajouter(b, 'x', T0)
		for vide in ('', '   '):
			with self.subTest(titre=vide):
				with self.assertRaises(backlog.Refus):
					backlog.modifier(b, 'F1', T0, titre=vide)
				self.assertEqual(b['fiches'][0]['titre'], 'x')

	def test_prete_exige_chaque_champ_seul(self):
		vides = {'titre': '', 'type': None, 'preuve': None, 'priorite': None, 'fichiers': [], 'budgetJetons': None,
		         'vision': ''}
		for champ, vide in vides.items():
			with self.subTest(champ=champ):
				b = backlog.vide()
				f = backlog.ajouter(b, 'x', T0, **COMPLETE)
				f[champ] = vide
				self.assertEqual(backlog.manques(f), [champ])
				with self.assertRaises(backlog.Refus) as cm:
					backlog.transition(b, 'F1', 'prête', T0)
				self.assertIn(champ, str(cm.exception))
				self.assertEqual(f['etat'], 'discussion')

	def test_budget_nul_ou_negatif_refuse(self):
		for v in (0, -5):
			with self.subTest(v=v), self.assertRaises(backlog.Refus):
				backlog.ajouter(backlog.vide(), 'x', T0, budgetJetons=v)

	def test_prete_complete(self):
		b = backlog.vide()
		backlog.ajouter(b, 'x', T0, **COMPLETE)
		f = backlog.transition(b, 'F1', 'prête', '2026-11-21T10:00:00+00:00')
		self.assertEqual((f['etat'], f['maj']), ('prête', '2026-11-21T10:00:00+00:00'))
		self.assertEqual(backlog.manques(f), [])

	def test_valeurs_hors_liste_refusees(self):
		for champ, v in (('type', 'epic'), ('priorite', 'P4'), ('preuve', 'deploiement')):
			with self.subTest(champ=champ), self.assertRaises(backlog.Refus) as cm:
				backlog.ajouter(backlog.vide(), 'x', T0, **{champ: v})
			self.assertIn(champ, str(cm.exception))

	def test_dependance_inconnue_refusee(self):
		b = backlog.vide()
		with self.assertRaises(backlog.Refus) as cm:
			backlog.ajouter(b, 'x', T0, dependances=['F9'])
		self.assertIn('F9', str(cm.exception))
		self.assertEqual(b['fiches'], [])

	def test_cycle_refuse_et_nomme(self):
		b = backlog.vide()
		backlog.ajouter(b, 'a', T0)
		backlog.ajouter(b, 'b', T0, dependances=['F1'])
		with self.assertRaises(backlog.Refus) as cm:
			backlog.modifier(b, 'F1', T0, dependances=['F2'])
		self.assertIn('F1 -> F2 -> F1', str(cm.exception))
		self.assertEqual(b['fiches'][0]['dependances'], [])
		with self.assertRaises(backlog.Refus):
			backlog.modifier(b, 'F1', T0, dependances=['F1'])


class Transitions(unittest.TestCase):
	"""T002 : la CLI ne fait que discussion <-> prête ; une fiche faite ou abandonnée ne change plus."""

	def setUp(self):
		self.b = backlog.vide()
		backlog.ajouter(self.b, 'x', T0, **COMPLETE)

	def test_aller_retour(self):
		backlog.transition(self.b, 'F1', 'prête', T0)
		self.assertEqual(backlog.transition(self.b, 'F1', 'discussion', T0)['etat'], 'discussion')

	def test_etats_du_clic_refuses(self):
		for etat in ('lancée', 'faite', 'abandonnée'):
			with self.subTest(etat=etat), self.assertRaises(backlog.Refus) as cm:
				backlog.transition(self.b, 'F1', etat, T0)
			self.assertIn('par le clic seulement', str(cm.exception))
		self.assertEqual(self.b['fiches'][0]['etat'], 'discussion')

	def test_etat_inconnu_refuse(self):
		with self.assertRaises(backlog.Refus):
			backlog.transition(self.b, 'F1', 'fini', T0)

	def test_terminal_ne_change_plus(self):
		for etat in ('faite', 'abandonnée'):
			self.b['fiches'][0]['etat'] = etat
			for faire in (lambda: backlog.transition(self.b, 'F1', 'discussion', T0),
			              lambda: backlog.modifier(self.b, 'F1', T0, titre='y'),
			              lambda: backlog.noter(self.b, 'F1', 'z', T0)):
				with self.subTest(etat=etat), self.assertRaises(backlog.Refus):
					faire()
			self.assertEqual((self.b['fiches'][0]['titre'], self.b['fiches'][0]['journal']), ('x', []))

	def test_prete_ne_perd_pas_un_champ_exige(self):
		backlog.transition(self.b, 'F1', 'prête', T0)
		with self.assertRaises(backlog.Refus) as cm:
			backlog.modifier(self.b, 'F1', T0, fichiers=[])
		self.assertIn('fichiers', str(cm.exception))
		self.assertEqual(self.b['fiches'][0]['fichiers'], ['src/a.ts'])

	def test_fiche_introuvable(self):
		with self.assertRaises(backlog.Refus):
			backlog.transition(self.b, 'F7', 'prête', T0)


class Decisions(unittest.TestCase):
	"""T003 : une décision s'écrit proposée ; aucune fonction de la CLI ne pose un autre statut."""

	def test_ajout_proposee(self):
		d = backlog.vide_decisions()
		x = backlog.decision_ajouter(d, 'JSON seulement', 'pas de base à tenir', T0, alternatives=['SQLite'],
		                             invalide=['F3'], structurante=True)
		self.assertEqual(set(x), set(backlog.CHAMPS_DECISION))
		self.assertEqual((x['id'], x['statut'], x['date'], x['objet'], x['pourquoi']),
		                 ('D1', 'proposée', T0, 'JSON seulement', 'pas de base à tenir'))
		self.assertEqual((x['alternatives'], x['invalide'], x['structurante'], x['revoqueePar']), (['SQLite'], ['F3'], True, None))
		self.assertEqual(backlog.decision_ajouter(d, 'b', 'c', T0)['id'], 'D2')
		backlog.valider_decisions(d)

	def test_objet_et_pourquoi_exiges(self):
		for objet, pourquoi in (('', 'p'), ('o', ' ')):
			with self.subTest(objet=objet), self.assertRaises(backlog.Refus):
				backlog.decision_ajouter(backlog.vide_decisions(), objet, pourquoi, T0)

	def test_actives(self):
		d = backlog.vide_decisions()
		for o in 'abc':
			backlog.decision_ajouter(d, o, 'p', T0)
		d['decisions'][1]['statut'] = 'active'
		self.assertEqual([x['id'] for x in backlog.decisions_actives(d)], ['D2'])


class Base(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='backlog-test-')
		self.addCleanup(shutil.rmtree, self.tmp, True)
		self.home = os.path.join(self.tmp, 'home')
		self.racine = os.path.join(self.tmp, 'projet')
		os.makedirs(self.home)
		os.makedirs(self.racine)
		env = unittest.mock.patch.dict(os.environ, {'HOME': self.home, 'AGENCE_ROOT': self.racine})
		env.start()
		self.addCleanup(env.stop)
		self.assertTrue(os.path.expanduser('~').startswith(self.tmp))
		self.fichier = os.path.join(self.racine, '.cate', 'tmp', 'agence', 'backlog.json')
		self.registre = os.path.join(self.racine, '.cate', 'tmp', 'agence', 'decisions.json')

	def agence(self, *argv):
		out, err = io.StringIO(), io.StringIO()
		with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
			code = agence.main(list(argv))
		return code, out.getvalue(), err.getvalue()

	def ecrit(self, chemin, texte):
		os.makedirs(os.path.dirname(chemin), exist_ok=True)
		with open(chemin, 'w') as f:
			f.write(texte)

	def lit(self, chemin):
		with open(chemin) as f:
			return f.read()


class FichierALaMain(Base):
	"""T004 : un fichier édité à la main et invalide bloque toute écriture (code 2), sans toucher au fichier."""

	def test_absent_backlog_vide(self):
		self.assertEqual(backlog.charger(self.racine), {'backlog': backlog.vide(), 'decisions': backlog.vide_decisions()})
		self.assertEqual(self.agence('fiche', 'list'), (0, '', ''))

	def test_invalides_refusent_toute_ecriture(self):
		fiche = {**backlog.ajouter(backlog.vide(), 'x', T0)}
		cas = {
			'json invalide': '{"seq": 1,',
			'racine liste': '[]',
			'champ racine inconnu': json.dumps({'seq': 0, 'fiches': [], 'derniereRevue': None, 'notes': 1}),
			'champ de fiche inconnu': json.dumps({'seq': 1, 'fiches': [{**fiche, 'couleur': 'bleu'}], 'derniereRevue': None}),
			'état inconnu': json.dumps({'seq': 1, 'fiches': [{**fiche, 'etat': 'finie'}], 'derniereRevue': None}),
			'type de champ': json.dumps({'seq': 1, 'fiches': [{**fiche, 'fichiers': 'src/a.ts'}], 'derniereRevue': None}),
		}
		for nom, texte in cas.items():
			with self.subTest(nom=nom):
				self.ecrit(self.fichier, texte)
				for argv in (('fiche', 'add', 'y'), ('fiche', 'list'), ('decision', 'add', 'o', '--pourquoi', 'p')):
					code, out, err = self.agence(*argv)
					self.assertEqual(code, 2, (argv, out, err))
					self.assertIn('backlog.json', err)
				self.assertEqual(self.lit(self.fichier), texte)
				self.assertFalse(os.path.exists(self.registre))

	def test_registre_invalide_refuse_aussi(self):
		self.ecrit(self.registre, json.dumps({'seq': 0, 'decisions': [{'id': 'D1'}]}))
		code, _, err = self.agence('fiche', 'add', 'y')
		self.assertEqual(code, 2)
		self.assertIn('decisions.json', err)
		self.assertFalse(os.path.exists(self.fichier))

	def test_deux_ecrivains_concurrents(self):
		env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
		procs = [subprocess.Popen([sys.executable, os.path.join(HERE, 'agence.py'), 'fiche', 'add', f't{i}'], env=env,
		                          stdout=subprocess.PIPE, stderr=subprocess.PIPE) for i in range(8)]
		ids = sorted(p.communicate()[0].decode().strip() for p in procs)
		self.assertEqual([p.returncode for p in procs], [0] * 8)
		b = json.loads(self.lit(self.fichier))
		backlog.valider(b)
		self.assertEqual((b['seq'], len(b['fiches'])), (8, 8))
		self.assertEqual(ids, sorted(f'F{i}' for i in range(1, 9)))


class Cli(Base):
	"""T008 : `agence fiche` et `agence decision` (tests d'acceptation du lot 1)."""

	def test_add_rend_F1_en_discussion(self):
		self.assertEqual(self.agence('fiche', 'add', 'x', '--type', 'idee'), (0, 'F1\n', ''))
		f = json.loads(self.lit(self.fichier))['fiches'][0]
		self.assertEqual((f['id'], f['etat'], f['type']), ('F1', 'discussion', 'idee'))

	def test_prete_refusee_nomme_les_cinq_manques(self):
		self.agence('fiche', 'add', 'x', '--type', 'idee')
		avant = self.lit(self.fichier)
		code, _, err = self.agence('fiche', 'etat', 'F1', 'prête')
		self.assertEqual(code, 1)
		for champ in ('preuve', 'priorite', 'fichiers', 'budgetJetons', 'vision'):
			self.assertIn(champ, err)
		self.assertNotIn('titre', err)
		self.assertEqual(self.lit(self.fichier), avant)

	def test_edit_puis_prete(self):
		self.agence('fiche', 'add', 'x', '--type', 'idee')
		code, _, err = self.agence('fiche', 'edit', 'F1', '--preuve', 'pr-merged:', '--priorite', 'P1', '--fichier', 'src/a.ts',
		                           '--fichier', 'src/b/', '--budget-jetons', '20000', '--vision', 'FR-003')
		self.assertEqual(code, 0, err)
		self.assertEqual(self.agence('fiche', 'etat', 'F1', 'prête')[0], 0)
		code, out, _ = self.agence('fiche', 'show', 'F1', '--json')
		f = json.loads(out)
		self.assertEqual((f['etat'], f['fichiers'], f['budgetJetons']), ('prête', ['src/a.ts', 'src/b/'], 20000))

	def test_etat_du_clic_refuse(self):
		self.agence('fiche', 'add', 'x')
		code, _, err = self.agence('fiche', 'etat', 'F1', 'lancée')
		self.assertEqual(code, 1)
		self.assertIn('par le clic seulement', err)

	def test_list_show_note(self):
		self.agence('fiche', 'add', 'x', '--type', 'bug')
		self.agence('fiche', 'add', 'y')
		self.assertEqual(self.agence('fiche', 'note', 'F2', 'à creuser')[0], 0)
		code, out, _ = self.agence('fiche', 'list')
		self.assertEqual(code, 0)
		self.assertEqual([l.split()[0] for l in out.splitlines()], ['F1', 'F2'])
		self.assertEqual([f['id'] for f in json.loads(self.agence('fiche', 'list', '--json')[1])], ['F1', 'F2'])
		self.assertEqual(json.loads(self.agence('fiche', 'list', '--etat', 'prête', '--json')[1]), [])
		code, out, _ = self.agence('fiche', 'show', 'F2')
		self.assertIn('à creuser', out)
		self.assertEqual(json.loads(self.agence('fiche', 'show', 'F2', '--json')[1])['journal'][0]['by'], 'cli')
		self.assertEqual(self.agence('fiche', 'show', 'F9')[0], 1)

	def test_decision_add_rend_D1_proposee(self):
		code, out, err = self.agence('decision', 'add', 'JSON seulement', '--pourquoi', 'pas de base', '--alternative', 'SQLite',
		                             '--invalide', 'F2', '--structurante')
		self.assertEqual((code, out, err), (0, 'D1\n', ''))
		x = json.loads(self.agence('decision', 'show', 'D1', '--json')[1])
		self.assertEqual((x['statut'], x['alternatives'], x['invalide'], x['structurante']), ('proposée', ['SQLite'], ['F2'], True))
		self.assertEqual(json.loads(self.agence('decision', 'list', '--active', '--json')[1]), [])
		self.assertEqual([d['id'] for d in json.loads(self.agence('decision', 'list', '--json')[1])], ['D1'])
		self.assertIn('D1', self.agence('decision', 'list')[1])

	def test_aucune_commande_ne_pose_un_statut(self):
		self.agence('decision', 'add', 'o', '--pourquoi', 'p')
		for argv in (('decision', 'active', 'D1'), ('decision', 'add', 'o', '--pourquoi', 'p', '--statut', 'active')):
			with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
				agence.main(list(argv))
		self.assertEqual(json.loads(self.lit(self.registre))['decisions'][0]['statut'], 'proposée')


if __name__ == '__main__':
	unittest.main()
