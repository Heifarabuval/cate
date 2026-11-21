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
import test_lancer  # noqa: E402  (module seul : ses classes ne tournent pas deux fois)

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


def fiches(*specs):
	"""Fiches de test : (fichiers, priorite, creee[, dependances]) ; ids F1, F2... dans l'ordre."""
	b = backlog.vide()
	for i, s in enumerate(specs):
		fichiers, prio, creee = s[:3]
		f = backlog.ajouter(b, f't{i + 1}', creee, fichiers=fichiers, priorite=prio)
		f['dependances'] = list(s[3]) if len(s) > 3 else []
	return b['fiches']


def jours(n):
	return f'2026-11-{20 - n:02d}T10:00:00+00:00' if n < 20 else None


class Detections(unittest.TestCase):
	"""Lot 2 (T020 à T024) : chevauchement, vagues, dépendances, plafond, péremption, consommé, brief, sans appel externe."""

	def test_chevauche(self):
		f = lambda *p: {'fichiers': list(p)}  # noqa: E731
		self.assertTrue(backlog.chevauche(f('src/a.ts'), f('src/a.ts')))
		self.assertTrue(backlog.chevauche(f('src/a/'), f('src/a/b.ts')))
		self.assertTrue(backlog.chevauche(f('src/a/b.ts'), f('./src/a')))
		self.assertFalse(backlog.chevauche(f('src/a'), f('src/ab.ts')))
		self.assertFalse(backlog.chevauche(f('src/a.ts'), f('src/b.ts', 'docs/')))

	def test_vagues_sc001(self):
		fs = fiches((['src/a.ts'], 'P2', T0), (['src/a.ts', 'src/c.ts'], 'P2', '2026-11-20T11:00:00+00:00'),
		            (['src/b.ts'], 'P2', '2026-11-20T12:00:00+00:00'))
		p = backlog.plan(fs, set(), place=4, maximum=4)
		self.assertEqual(p['vagues'], [['F1', 'F3'], ['F2']])
		self.assertEqual(p['part'], ['F1', 'F3'])
		self.assertEqual(p['attente'], {'F2': 'chevauche F1 sur src/a.ts'})

	def test_priorite_puis_anciennete(self):
		fs = fiches((['src/a.ts'], 'P2', T0), (['src/a.ts'], 'P1', '2026-11-20T11:00:00+00:00'))
		self.assertEqual(backlog.plan(fs, set(), 4, 4)['vagues'], [['F2'], ['F1']])
		fs = fiches((['src/a.ts'], 'P2', '2026-11-20T11:00:00+00:00'), (['src/a.ts'], 'P2', T0))
		self.assertEqual(backlog.plan(fs, set(), 4, 4)['vagues'], [['F2'], ['F1']])

	def test_dependance_dans_le_lot_vague_suivante(self):
		fs = fiches((['src/a.ts'], 'P1', T0, ['F2']), (['src/b.ts'], 'P2', T0))
		p = backlog.plan(fs, set(), 4, 4)
		self.assertEqual(p['vagues'], [['F2'], ['F1']])
		self.assertEqual(p['attente'], {'F1': 'dépendance F2'})

	def test_dependance_hors_lot(self):
		b = backlog.vide()
		for i in range(3):
			backlog.ajouter(b, f't{i}', T0, fichiers=[f'src/{i}.ts'])
		b['fiches'][1]['dependances'] = ['F1']
		b['fiches'][2]['dependances'] = ['F2']
		p = backlog.plan(b['fiches'][1:], set(), 4, 4)  # F1 hors lot, pas faite ; F3 attend F2 qui attend
		self.assertEqual((p['vagues'], p['part']), ([], []))
		self.assertEqual(p['attente'], {'F2': 'dépendance F1', 'F3': 'dépendance F2'})
		p = backlog.plan(b['fiches'][1:], {'F1'}, 4, 4)
		self.assertEqual((p['vagues'], p['attente']), ([['F2'], ['F3']], {'F3': 'dépendance F2'}))

	def test_plafond(self):
		fs = fiches(*[([f'src/{i}.ts'], 'P2', T0) for i in range(3)])
		p = backlog.plan(fs, set(), place=1, maximum=4)
		self.assertEqual(p['part'], ['F1'])
		self.assertEqual(p['attente'], {'F2': 'plafond (4)', 'F3': 'plafond (4)'})
		p = backlog.plan(fs, set(), place=0, maximum=4)
		self.assertEqual(p['part'], [])
		self.assertEqual(set(p['attente']), {'F1', 'F2', 'F3'})
		self.assertEqual(backlog.plan(fs, set(), place=-2, maximum=4)['part'], [])

	def test_perimees(self):
		fs = fiches(*[(['x'], 'P2', jours(n)) for n in (15, 13, 14, 15)])
		fs[3]['etat'] = 'prête'
		self.assertEqual([f['id'] for f in backlog.perimees(fs, T0)], ['F1'])

	def test_revue_due(self):
		self.assertFalse(backlog.revue_due(jours(6), None, T0))
		self.assertTrue(backlog.revue_due(jours(7), None, T0))
		self.assertFalse(backlog.revue_due(None, jours(6), T0))
		self.assertTrue(backlog.revue_due(None, jours(7), T0))
		self.assertFalse(backlog.revue_due(None, None, T0))

	def test_consomme(self):
		mesures = {'p1': {'inputTokens': 6000, 'outputTokens': 5000}, 'p2': {'inputTokens': 100, 'outputTokens': 'x'},
		           'p3': {'inputTokens': True}}
		self.assertEqual(backlog.consomme(mesures, ['p1', 'p2', 'absent']), 11100)
		self.assertIsNone(backlog.consomme(mesures, ['absent', 'p3']))
		self.assertIsNone(backlog.consomme(None, ['p1']))
		self.assertIsNone(backlog.consomme({}, []))
		self.assertEqual(backlog.consomme({'p': {'inputTokens': 0, 'outputTokens': 0}}, ['p']), 0)

	def test_consomme_ignore_nan_infini_et_negatif(self):
		hostile = {'p': {'inputTokens': float('nan'), 'outputTokens': -5}, 'q': {'inputTokens': float('inf')}}
		self.assertIsNone(backlog.consomme(hostile, ['p', 'q']))
		self.assertEqual(backlog.consomme({**hostile, 'r': {'outputTokens': 7}}, ['p', 'q', 'r']), 7)

	def test_chemin_vide_ne_chevauche_rien(self):
		f = lambda *p: {'fichiers': list(p)}  # noqa: E731
		for vide in ('', '  '):
			with self.subTest(chemin=repr(vide)):
				self.assertIsNone(backlog.chevauche(f(vide), f('src/a.ts')))
				self.assertIsNone(backlog.chevauche(f('src/a.ts'), f(vide, 'docs/')))
				self.assertIsNone(backlog.chevauche(f(vide), f(vide)))

	def test_id_en_double_ne_se_chevauche_pas(self):
		fs = fiches((['src/a.ts'], 'P2', T0))
		p = backlog.plan(fs + fs, set(), 4, 4)
		self.assertEqual((p['vagues'], p['part'], p['attente']), ([['F1']], ['F1'], {}))

	def test_fiche_lancee_occupe_ses_fichiers(self):
		fs = fiches((['src/a.ts'], 'P2', T0), (['src/a.ts'], 'P2', T0), (['src/b.ts'], 'P2', T0), (['src/c.ts'], 'P2', T0, ['F1']))
		p = backlog.plan(fs[1:], set(), 4, 4, occupees=fs[:1])
		self.assertEqual(p['part'], ['F3'])
		self.assertEqual(p['vagues'], [['F3'], ['F2', 'F4']])
		self.assertEqual(p['attente'], {'F2': 'chevauche F1 sur src/a.ts', 'F4': 'dépendance F1'})
		p = backlog.plan(fs[1:2], set(), 4, 4, occupees=fs[:1])
		self.assertEqual((p['part'], p['vagues']), ([], [['F2']]))

	def test_brief(self):
		d = backlog.vide_decisions()
		for o in ('JSON seulement', 'pas de base', 'jamais SQLite'):
			backlog.decision_ajouter(d, o, f'pourquoi {o}', T0)
		d['decisions'][0]['statut'] = 'active'
		b = backlog.vide()
		f = backlog.ajouter(b, 'x', T0, **COMPLETE, decisions=['D1', 'D2'])
		texte = backlog.brief(f, d['decisions'])
		cles = ['titre', 'type', 'priorite', 'preuve', 'fichiers', 'dependances', 'budgetJetons', 'vision', 'modele', 'decisions']
		lignes = texte.splitlines()
		self.assertEqual(lignes[0], 'F1 : x')
		self.assertEqual([l.split(' : ')[0] for l in lignes[1:len(cles)]], cles[1:])
		self.assertIn('D1 : JSON seulement ; pourquoi JSON seulement', texte)
		self.assertNotIn('D2', texte)
		self.assertNotIn('D3', texte)
		self.assertEqual(texte, backlog.brief(f, d['decisions']))

	def test_zero_appel_externe(self):
		def interdit(*a, **k):
			raise AssertionError('appel externe')
		fs = fiches((['src/a.ts'], 'P2', jours(15)), (['src/a.ts'], 'P1', T0))
		with unittest.mock.patch('subprocess.run', interdit), unittest.mock.patch('subprocess.Popen', interdit), \
				unittest.mock.patch('socket.socket', interdit):
			backlog.plan(fs, set(), 4, 4)
			backlog.perimees(fs, T0)
			backlog.consomme({'p': {'inputTokens': 1, 'outputTokens': 2}}, ['p'])
			backlog.revue_due(None, jours(8), T0)
			backlog.brief(fs[0], [])


class CliDetections(Base):
	"""T026 : `agence fiche plan` et `agence fiche brief`."""

	def test_plan_json_rend_les_vagues_de_us2(self):
		for fichier in ('src/a.ts', 'src/a.ts', 'src/b.ts'):
			self.agence('fiche', 'add', 'x', '--fichier', fichier, '--priorite', 'P2')
		code, out, err = self.agence('fiche', 'plan', 'F1', 'F2', 'F3', '--json')
		self.assertEqual(code, 0, err)
		p = json.loads(out)
		self.assertEqual((p['vagues'], p['attente']), ([['F1', 'F3'], ['F2']], {'F2': 'chevauche F1 sur src/a.ts'}))
		code, out, _ = self.agence('fiche', 'plan', 'F1', 'F2', 'F3')
		self.assertIn('vague 1 : F1, F3', out)
		self.assertIn('F2 attend : chevauche F1 sur src/a.ts', out)
		self.assertEqual(self.agence('fiche', 'plan', 'F9')[0], 1)

	def test_plan_place_lue_dans_l_etat(self):
		for i in range(3):
			self.agence('fiche', 'add', 'x', '--fichier', f'src/{i}.ts')
		with agence.tx() as st:
			st['agentsActive'], st['agentsWaiting'] = 2, 1
		p = json.loads(self.agence('fiche', 'plan', 'F1', 'F2', 'F3', '--json')[1])
		maxi = agence.plafond(agence.load())
		self.assertEqual(p['part'], ['F1', 'F2', 'F3'][:maxi - 3])
		self.assertEqual(p['attente'].get('F3'), f'plafond ({maxi})')

	def test_brief(self):
		self.agence('fiche', 'add', 'x', '--fichier', 'src/a.ts', '--budget-jetons', '5000')
		code, out, _ = self.agence('fiche', 'brief', 'F1')
		self.assertEqual(code, 0)
		self.assertTrue(out.startswith('F1 : x\n'))
		self.assertIn('budgetJetons : 5000', out)


class ModeleDefaut(Base):
	"""T121 (spec 010, lot 7, FR-010) : une fiche sans --modele reprend le modèle proposé par la politique, sinon null."""

	def regle(self, cle, valeur):
		import pratiques
		pratiques.regler(self.racine, self.home, cle, valeur)

	def modele(self, fid):
		return json.loads(self.agence('fiche', 'show', fid, '--json')[1])['modele']

	def test_sans_politique_aucun_modele(self):
		self.agence('decision', 'add', 'o', '--pourquoi', 'p', '--structurante')
		self.agence('fiche', 'add', 'x')
		self.agence('fiche', 'add', 'y', '--decision', 'D1')
		self.assertEqual((self.modele('F1'), self.modele('F2')), (None, None))

	def test_implementation_puis_structurant(self):
		self.regle('modele.implementation', 'sonnet')
		self.regle('modele.structurant', 'opus')
		self.agence('decision', 'add', 'o', '--pourquoi', 'p', '--structurante')
		self.agence('decision', 'add', 'o2', '--pourquoi', 'p')
		self.agence('fiche', 'add', 'simple')
		self.agence('fiche', 'add', 'structurante', '--decision', 'D2', '--decision', 'D1')
		self.agence('fiche', 'add', 'liee', '--decision', 'D2')
		self.assertEqual([self.modele(f) for f in ('F1', 'F2', 'F3')], ['sonnet', 'opus', 'sonnet'])

	def test_structurant_seul_ne_touche_que_les_structurantes(self):
		self.regle('modele.structurant', 'opus')
		self.agence('decision', 'add', 'o', '--pourquoi', 'p', '--structurante')
		self.agence('fiche', 'add', 'simple')
		self.agence('fiche', 'add', 'structurante', '--decision', 'D1')
		self.assertEqual((self.modele('F1'), self.modele('F2')), (None, 'opus'))

	def test_modele_explicite_garde(self):
		self.regle('modele.implementation', 'sonnet')
		self.agence('fiche', 'add', 'x', '--modele', 'haiku')
		self.assertEqual(self.modele('F1'), 'haiku')
		self.agence('fiche', 'edit', 'F1', '--titre', 'x2')  # une édition ne repose pas le défaut
		self.assertEqual(self.modele('F1'), 'haiku')

	def test_politique_invalide_refuse_sans_ecrire(self):
		self.ecrit(os.path.join(self.racine, '.cate', 'tmp', 'agence', 'pratiques.json'), '{')
		code, _, err = self.agence('fiche', 'add', 'x')
		self.assertEqual(code, 2)
		self.assertIn('pratiques', err)
		self.assertFalse(os.path.exists(self.fichier))


class ModeleAuLancement(test_lancer.Lancer):
	"""T121 : le besoin créé au clic porte le modèle de la fiche, ou aucun ; l'interlocuteur part avec le sien s'il est posé."""

	def test_besoin_porte_le_modele_ou_aucun(self):
		with agence.verrou():
			b = backlog.charger(self.tmp)['backlog']
			for titre, fichier, modele in (('A', 'src/a.ts', 'sonnet'), ('B', 'src/b.ts', None)):
				f = backlog.ajouter(b, titre, T0, **{**COMPLETE, 'fichiers': [fichier]}, modele=modele)
				backlog.transition(b, f['id'], 'prête', T0)
			backlog.ecrire(self.tmp, 'backlog.json', b)
		self.assertEqual(self.clic('F1,F2')[0], 303)
		needs = self.fiche_needs()
		self.assertEqual((needs['fiche:F1']['model'], needs['fiche:F2']['model']), ('sonnet', None))

	def starts(self):
		return [c for c in self.run.ran('cate', 'agent', 'start') if agence.INTER_PROMPT in c]

	def test_start_sans_reglage_aucun_model(self):
		with agence.tx() as st:
			st['panels'] = {}
		self.assertEqual(self.cli('start')[0], 0)
		self.assertEqual(len(self.starts()), 1)
		self.assertNotIn('--model', self.starts()[0])

	def test_start_passe_modele_interlocuteur(self):
		import pratiques
		pratiques.regler(self.tmp, os.environ['HOME'], 'modele.interlocuteur', 'haiku')
		pratiques.regler(self.tmp, os.environ['HOME'], 'modele.implementation', 'opus')  # un autre rôle n'y va pas
		with agence.tx() as st:
			st['panels'] = {}
		self.assertEqual(self.cli('start')[0], 0)
		c = self.starts()[0]
		self.assertEqual(c[c.index('--model') + 1], 'haiku')
		self.assertEqual(c.count('--model'), 1)


class Liens(unittest.TestCase):
	"""Spec 013 lot 3 (T030, SC-003) : `remplace` et `doublonDe`, identifiant inconnu, cycle, doublon refusé à `prête`."""

	def b(self, n=3):
		b = backlog.vide()
		for i in range(n):
			backlog.ajouter(b, f'f{i + 1}', T0, **COMPLETE)
		return b

	def test_fiche_neuve_porte_les_deux_listes_vides(self):
		f = backlog.ajouter(backlog.vide(), 'x', T0)
		self.assertEqual((f['remplace'], f['doublonDe']), ([], []))

	def test_doublon_ne_passe_pas_prete_et_nomme_l_origine(self):
		b = self.b(2)
		backlog.modifier(b, 'F2', T0, doublonDe=['F1'])
		with self.assertRaises(backlog.Refus) as cm:
			backlog.transition(b, 'F2', 'prête', T0)
		self.assertIn('F1', str(cm.exception))
		self.assertEqual(b['fiches'][1]['etat'], 'discussion')
		backlog.transition(b, 'F1', 'prête', T0)  # l'origine, elle, passe

	def test_remplacee_ne_passe_pas_prete(self):
		b = self.b(2)
		backlog.modifier(b, 'F2', T0, remplace=['F1'])
		with self.assertRaises(backlog.Refus) as cm:
			backlog.transition(b, 'F1', 'prête', T0)
		self.assertIn('F2', str(cm.exception))

	def test_prete_marquee_doublon_refusee_rien_ne_change(self):
		b = self.b(2)
		backlog.transition(b, 'F2', 'prête', T0)
		for champs, cible in (({'doublonDe': ['F1']}, 'F2'), ({'remplace': ['F2']}, 'F1')):
			with self.subTest(champs=champs):
				avant = json.dumps(b)
				with self.assertRaises(backlog.Refus) as cm:
					backlog.modifier(b, cible, T0, **champs)
				self.assertIn('F2', str(cm.exception))
				self.assertEqual(json.dumps(b), avant)

	def test_lancee_marquee_doublon_le_lien_s_ecrit(self):
		b = self.b(2)
		b['fiches'][1]['etat'] = 'lancée'  # posé par le clic
		backlog.modifier(b, 'F1', T0, remplace=['F2'])
		self.assertEqual(b['fiches'][0]['remplace'], ['F2'])

	def test_identifiant_inconnu_refuse_sans_ecriture(self):
		b = self.b(1)
		for champ in ('remplace', 'doublonDe'):
			with self.subTest(champ=champ):
				avant = json.dumps(b)
				with self.assertRaises(backlog.Refus) as cm:
					backlog.modifier(b, 'F1', T0, **{champ: ['F9']})
				self.assertIn('F9', str(cm.exception))
				self.assertEqual(json.dumps(b), avant)

	def test_cycle_refuse_et_nomme(self):
		for champ in ('remplace', 'doublonDe'):
			with self.subTest(champ=champ):
				b = self.b(2)
				backlog.modifier(b, 'F1', T0, **{champ: ['F2']})
				avant = json.dumps(b)
				with self.assertRaises(backlog.Refus) as cm:
					backlog.modifier(b, 'F2', T0, **{champ: ['F1']})
				self.assertIn('F1 -> F2 -> F1', str(cm.exception).replace('F2 -> F1 -> F2', 'F1 -> F2 -> F1'))
				self.assertEqual(json.dumps(b), avant)
				with self.assertRaises(backlog.Refus):
					backlog.modifier(b, 'F2', T0, **{champ: ['F2']})  # soi-même : un cycle d'un pas

	def test_fichier_a_la_main_lien_inconnu_ou_cycle_invalide(self):
		for champ in ('remplace', 'doublonDe'):
			with self.subTest(champ=champ):
				b = self.b(2)
				b['fiches'][0][champ] = ['F7']
				with self.assertRaises(backlog.Invalide):
					backlog.valider(b)
				b['fiches'][0][champ], b['fiches'][1][champ] = ['F2'], ['F1']
				with self.assertRaises(backlog.Invalide):
					backlog.valider(b)

	def test_backlog_ancien_message_nomme_les_deux_champs(self):
		b = self.b(1)
		for c in ('remplace', 'doublonDe'):
			del b['fiches'][0][c]
		with self.assertRaises(backlog.Invalide) as cm:
			backlog.valider(b)
		msg = str(cm.exception)
		self.assertIn('"remplace": []', msg)
		self.assertIn('"doublonDe": []', msg)
		self.assertIn('à la main', msg)


class BriefPlan(unittest.TestCase):
	"""Spec 013, lot 6 (T061, US6) : le brief d'une fiche demande la validation du plan selon plan.validation ;
	structurante : seule une fiche liée à une décision structurante active."""

	def fiche(self, *decisions):
		b, d = backlog.vide(), backlog.vide_decisions()
		backlog.decision_ajouter(d, 'ordinaire', 'p', T0)
		backlog.decision_ajouter(d, 'structurante', 'p', T0, structurante=True)
		backlog.decision_ajouter(d, 'proposée', 'p', T0, structurante=True)
		backlog.decider(d, 'D1', 'valider')
		backlog.decider(d, 'D2', 'valider')
		return backlog.ajouter(b, 'x', T0, decisions=list(decisions)), d['decisions']

	def demande(self, plan, *decisions):
		f, d = self.fiche(*decisions)
		return 'valider le plan' in backlog.brief(f, d, plan)

	def test_jamais_aucun_arret(self):
		self.assertFalse(self.demande('jamais', 'D2'))
		self.assertFalse(self.demande(None, 'D2'))  # clé absente

	def test_structurante_seule_une_fiche_liee_a_une_decision_structurante_active(self):
		self.assertTrue(self.demande('structurante', 'D2'))
		self.assertFalse(self.demande('structurante', 'D1'))
		self.assertFalse(self.demande('structurante', 'D3'))  # proposée : pas encore une décision
		self.assertFalse(self.demande('structurante'))

	def test_toujours(self):
		self.assertTrue(self.demande('toujours'))

	def test_cli_lit_la_politique(self):
		tmp = tempfile.mkdtemp(prefix='brief-plan-')
		self.addCleanup(shutil.rmtree, tmp, True)
		with unittest.mock.patch.dict(os.environ, {'HOME': tmp, 'AGENCE_ROOT': tmp}), contextlib.redirect_stderr(io.StringIO()):
			with contextlib.redirect_stdout(io.StringIO()):
				agence.main(['fiche', 'add', 'x'])
			out = io.StringIO()
			with contextlib.redirect_stdout(out):
				agence.main(['fiche', 'brief', 'F1'])
			self.assertNotIn('valider le plan', out.getvalue())
			with contextlib.redirect_stdout(io.StringIO()):
				agence.main(['pratiques', 'set', 'plan.validation', 'toujours'])
			out = io.StringIO()
			with contextlib.redirect_stdout(out):
				agence.main(['fiche', 'brief', 'F1'])
			self.assertIn('valider le plan', out.getvalue())


class CliLiens(Base):
	"""Spec 013 lot 3 (T032) : --remplace et --doublon-de sur add et edit ; decision show liste les fiches qui la citent."""

	def test_add_et_edit_posent_les_liens(self):
		self.agence('fiche', 'add', 'x')
		self.assertEqual(self.agence('fiche', 'add', 'y', '--doublon-de', 'F1')[0], 0)
		self.assertEqual(self.agence('fiche', 'edit', 'F2', '--remplace', 'F1', '--doublon-de', 'F1')[0], 0)
		f = json.loads(self.agence('fiche', 'show', 'F2', '--json')[1])
		self.assertEqual((f['remplace'], f['doublonDe']), (['F1'], ['F1']))
		self.assertIn('doublonDe : F1', self.agence('fiche', 'show', 'F2')[1])

	def test_lien_inconnu_code_1_rien_ecrit(self):
		self.agence('fiche', 'add', 'x')
		avant = self.lit(self.fichier)
		code, _, err = self.agence('fiche', 'edit', 'F1', '--doublon-de', 'F9')
		self.assertEqual(code, 1)
		self.assertIn('F9', err)
		self.assertEqual(self.lit(self.fichier), avant)

	def test_doublon_prete_refusee_par_la_cli(self):
		self.agence('fiche', 'add', 'x')
		self.agence('fiche', 'add', 'y', '--doublon-de', 'F1', '--type', 'tache', '--preuve', 'pr-merged:', '--priorite', 'P2',
		            '--fichier', 'src/a.ts', '--budget-jetons', '1000', '--vision', 'FR-003')
		code, _, err = self.agence('fiche', 'etat', 'F2', 'prête')
		self.assertEqual(code, 1)
		self.assertIn('F1', err)

	def test_decision_show_liste_les_fiches_qui_la_citent(self):
		self.agence('decision', 'add', 'o', '--pourquoi', 'p')
		self.agence('decision', 'add', 'o2', '--pourquoi', 'p2')
		self.agence('fiche', 'add', 'x', '--decision', 'D1')
		self.agence('fiche', 'add', 'y', '--decision', 'D2')
		self.agence('fiche', 'add', 'z', '--decision', 'D1', '--decision', 'D2')
		self.assertIn('fiches : F1, F3', self.agence('decision', 'show', 'D1')[1])
		self.assertEqual(json.loads(self.agence('decision', 'show', 'D1', '--json')[1])['fiches'], ['F1', 'F3'])
		self.assertNotIn('fiches', json.loads(self.lit(self.registre))['decisions'][0])  # calculé, jamais stocké


class Export(Base):
	"""Spec 013 lot 4 (T040, Q1 : docs/decisions.md) : `agence decision export` écrit les décisions actives, triées par
	date, avec leur pourquoi, et rien d'autre."""

	def poser_registre(self):
		d = backlog.vide_decisions()
		for objet, date in (('Markdown', '2026-11-19T10:00:00+00:00'), ('Proposée', '2026-11-18T10:00:00+00:00'),
		                    ('JSON seulement', '2026-11-12T10:00:00+00:00'), ('Rejetée', '2026-11-13T10:00:00+00:00'),
		                    ('Ancienne', '2026-11-10T10:00:00+00:00'), ('Remplaçante', '2026-11-15T10:00:00+00:00')):
			backlog.decision_ajouter(d, objet, f'parce que {objet.lower()}', date, alternatives=['SQLite'] if objet == 'Markdown' else ())
		for did in ('D1', 'D3', 'D5'):
			backlog.decider(d, did, 'valider')
		backlog.decider(d, 'D4', 'rejeter')
		d['decisions'][5]['invalide'] = ['D5']
		backlog.decider(d, 'D6', 'valider')  # révoque D5
		backlog.ecrire(self.racine, 'decisions.json', d)
		return d

	def setUp(self):
		super().setUp()
		ici = os.getcwd()
		os.chdir(self.racine)  # hors dépôt git : la cible retombe sur la racine de l'agence
		self.addCleanup(os.chdir, ici)

	def git(self, *argv, cwd):
		subprocess.run(['git', '-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', *argv], check=True, capture_output=True)

	def poser_registre_dans(self, racine):
		self.racine, avant = racine, self.racine
		try:
			return self.poser_registre()
		finally:
			self.racine = avant

	def test_depuis_un_worktree_ecrit_dans_le_worktree(self):
		principal, wt = os.path.join(self.tmp, 'principal'), os.path.join(self.tmp, 'wt')
		os.makedirs(principal)
		self.git('init', '-q', cwd=principal)
		self.git('commit', '-q', '--allow-empty', '-m', 'x', cwd=principal)
		self.git('worktree', 'add', '-q', wt, cwd=principal)
		os.environ['AGENCE_ROOT'] = principal
		self.poser_registre_dans(principal)
		os.chdir(wt)
		code, out, err = self.agence('decision', 'export')
		self.assertEqual(code, 0, err)
		self.assertEqual(os.path.realpath(out.strip()), os.path.realpath(os.path.join(wt, 'docs', 'decisions.md')))
		self.assertIn('## D3 : JSON seulement', self.lit(os.path.join(wt, 'docs', 'decisions.md')))
		self.assertFalse(os.path.exists(os.path.join(principal, 'docs')))

	def test_out_choisit_le_fichier(self):
		self.poser_registre()
		cible = os.path.join(self.tmp, 'ailleurs', 'registre.md')
		code, out, err = self.agence('decision', 'export', '--out', cible)
		self.assertEqual(code, 0, err)
		self.assertEqual(out.strip(), cible)
		self.assertIn('## D1 : Markdown', self.lit(cible))
		self.assertFalse(os.path.exists(os.path.join(self.racine, 'docs')))

	def test_ecriture_par_renommage_ancien_fichier_intact_si_echec(self):
		self.poser_registre()
		cible = os.path.join(self.racine, 'docs', 'decisions.md')
		self.ecrit(cible, 'ancien\n')
		with unittest.mock.patch.object(os, 'replace', side_effect=OSError('disque plein')):
			with self.assertRaises(OSError):
				self.agence('decision', 'export')
		self.assertEqual(self.lit(cible), 'ancien\n')
		self.assertEqual(os.listdir(os.path.dirname(cible)), ['decisions.md'])  # aucun temporaire laissé

	def test_objet_ou_pourquoi_sur_plusieurs_lignes_sans_titre_injecte(self):
		d = backlog.vide_decisions()
		backlog.decision_ajouter(d, 'objet\n# Faux titre', 'raison\n\n## D9 : injecté', T0, alternatives=['a\n# b'])
		backlog.decider(d, 'D1', 'valider')
		titres = [l for l in backlog.registre_md(d).splitlines() if l.startswith('#')]
		self.assertEqual(titres, ['# Décisions actives', '## D1 : objet # Faux titre'])

	def test_export_actives_triees_par_date_et_rien_d_autre(self):
		self.poser_registre()
		registre =self.lit(os.path.join(self.racine, '.cate', 'tmp', 'agence', 'decisions.json'))
		code, out, err = self.agence('decision', 'export')
		self.assertEqual(code, 0, err)
		cible = os.path.join(self.racine, 'docs', 'decisions.md')
		self.assertEqual(out.strip(), cible)
		texte = self.lit(cible)
		titres = [l for l in texte.splitlines() if l.startswith('## ')]
		self.assertEqual(titres, ['## D3 : JSON seulement', '## D6 : Remplaçante', '## D1 : Markdown'])
		for x in ('parce que json seulement', 'parce que markdown', '2026-11-12', 'SQLite'):
			self.assertIn(x, texte)
		for x in ('Proposée', 'Rejetée', 'Ancienne'):
			self.assertNotIn(x, texte)
		self.assertEqual(self.lit(os.path.join(self.racine, '.cate', 'tmp', 'agence', 'decisions.json')), registre)
		self.assertFalse(os.path.exists(self.fichier))  # backlog.json non créé
		self.assertEqual(os.listdir(os.path.join(self.racine, 'docs')), ['decisions.md'])

	def test_deux_exports_identiques(self):
		self.poser_registre()
		self.agence('decision', 'export')
		cible = os.path.join(self.racine, 'docs', 'decisions.md')
		premier = self.lit(cible)
		self.agence('decision', 'export')
		self.assertEqual(self.lit(cible), premier)  # aucune date d'export : le diff d'une PR de docs ne montre que les décisions

	def test_registre_vide_fichier_sans_decision(self):
		self.assertEqual(self.agence('decision', 'export')[0], 0)
		texte = self.lit(os.path.join(self.racine, 'docs', 'decisions.md'))
		self.assertNotIn('## ', texte)
		self.assertIn('Aucune décision active', texte)


if __name__ == '__main__':
	unittest.main()
