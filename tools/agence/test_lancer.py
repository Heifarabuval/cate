#!/usr/bin/env python3
"""Spec 010, lot 4 : clic « Lancer » (FR-003, SC-001), message unique à l'orchestrateur, suite au tour du régisseur,
budget en jetons (FR-006), vue `backlog` publiée pour le panneau agence (contrat du lot 5).

`cate` est simulé (FakeRun) ; état en dossier temporaire et faux HOME (Base de test_agence)."""
import concurrent.futures
import contextlib
import io
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
import backlog  # noqa: E402
import test_agence  # noqa: E402
from test_agence import Base  # noqa: E402
from test_portable import REPO  # noqa: E402

T0 = '2026-11-20T10:00:00+00:00'
COMPLETE = {'type': 'tache', 'preuve': 'pr-merged:', 'priorite': 'P2', 'budgetJetons': 10000, 'vision': 'FR-003'}
# Copie de src/panels/agence/contract/fixtures/vue-backlog.json (branche du lot 5) : ce test tourne sans src/.
FIXTURE = os.path.join(HERE, 'fixtures', 'vue-backlog.json')
FIXTURE_SRC = os.path.join(REPO, 'src', 'panels', 'agence', 'contract', 'fixtures', 'vue-backlog.json')
# Réponse réelle de /fiches/lancer en succès (POST JSON du panneau agence) ; session.test.ts lit la copie de src/.
REPONSE = os.path.join(HERE, 'fixtures', 'reponse-lancer.json')
REPONSE_SRC = os.path.join(REPO, 'src', 'panels', 'agence', 'contract', 'fixtures', 'reponse-lancer.json')


class Lancer(Base):
	def setUp(self):
		super().setUp()
		self.booted()  # orchestrateur o1, régisseur r1

	def fiches(self, *specs, etat='prête'):
		"""Fiches complètes (titre, fichiers), passées `etat`."""
		with agence.verrou():
			b = backlog.charger(self.tmp)['backlog']
			for titre, fichiers in specs:
				f = backlog.ajouter(b, titre, T0, **COMPLETE, fichiers=fichiers)
				if etat == 'prête':
					backlog.transition(b, f['id'], 'prête', T0)
			backlog.ecrire(self.tmp, 'backlog.json', b)

	def backlog(self):
		return {f['id']: f for f in backlog.charger(self.tmp)['backlog']['fiches']}

	def clic(self, ids):
		return agence.click('/fiches/lancer', {'ids': [ids]})

	def envois(self):
		return [c for c in self.run.ran('cate', 'agent', 'send') if c[c.index('--panel') + 1] == 'o1']

	def fiche_needs(self):
		return {n['ref']: n for n in self.state()['needs'] if (n['ref'] or '').startswith('fiche:')}

	def un_tour(self, agents=(), usage=None, live=()):
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'title': 'Agence', 'type': 'agence'}] +
		               [{'panelId': p, 'title': p, 'type': 'terminal'} for p in live])
		self.run.reply(['cate', 'agent', 'list'], list(agents))
		if usage is not None:
			self.run.reply(['cate', 'agent', 'usage'], usage)
		agence.un_tour()

	def plafond(self, vivants):
		with agence.tx() as st:
			st['agentsActive'] = vivants


class Clic(Lancer):
	"""T060 : le clic crée un besoin par fiche de la vague 1, rien d'autre ; double clic : 409."""

	def test_aucun_besoin_ni_message_sans_clic(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/b.ts']))
		self.un_tour()
		self.assertEqual(self.state()['needs'], [])
		self.assertEqual(self.envois(), [])
		self.assertEqual({f['etat'] for f in self.backlog().values()}, {'prête'})

	def test_deux_chevauchent_une_part_l_autre_attend(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/a.ts']), ('C', ['src/c.ts']))
		self.assertEqual(self.clic('F1,F2,F3'), (303, '/'))
		needs = self.fiche_needs()
		self.assertEqual(sorted(needs), ['fiche:F1', 'fiche:F3'])
		b = self.backlog()
		for fid in ('F1', 'F3'):
			with self.subTest(fiche=fid):
				self.assertEqual(b[fid]['etat'], 'lancée')
				self.assertEqual(b[fid]['besoin'], needs[f'fiche:{fid}']['id'])
				self.assertEqual(b[fid]['journal'][-1]['by'], 'clic')
				n = needs[f'fiche:{fid}']
				self.assertEqual((n['kind'], n['doneWhen'], n['budgetJetons']), ('task', 'pr-merged:', 10000))
		self.assertEqual(b['F2']['etat'], 'prête')
		self.assertEqual(self.state()['backlog']['attentes'], {'F2': 'chevauche F1 sur src/a.ts'})

	def test_id_qui_n_est_pas_prete_refuse_sans_rien_creer(self):
		self.fiches(('A', ['src/a.ts']))
		self.fiches(('B', ['src/b.ts']), etat='discussion')
		for ids in ('F1,F2', 'F1,F9'):
			with self.subTest(ids=ids):
				code, msg = self.clic(ids)
				self.assertEqual(code, 409)
				self.assertIn(ids.split(',')[1], msg)
				self.assertEqual(self.state()['needs'], [])
				self.assertEqual(self.backlog()['F1']['etat'], 'prête')
		self.assertEqual(self.envois(), [])

	def test_ids_mal_formes_400(self):
		self.fiches(('A', ['src/a.ts']))
		for ids in ('', 'F1;rm', 'n1'):
			with self.subTest(ids=ids):
				self.assertEqual(self.clic(ids)[0], 400)
		self.assertEqual(self.state()['needs'], [])

	def test_double_clic_409_rien_de_cree(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/b.ts']))
		self.assertEqual(self.clic('F1,F2')[0], 303)
		self.assertEqual(self.clic('F1,F2')[0], 409)
		self.assertEqual(len(self.state()['needs']), 2)
		self.assertEqual(len(self.envois()), 1)

	def test_double_clic_sur_des_fiches_qui_attendent_409(self):
		self.fiches(('A', ['src/a.ts']))
		self.plafond(4)
		self.assertEqual(self.clic('F1')[0], 303)
		self.assertEqual(self.clic('F1')[0], 409)
		self.assertEqual(self.state()['needs'], [])

	def test_plafond_une_part_deux_attendent(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/b.ts']), ('C', ['src/c.ts']))
		self.plafond(3)
		self.assertEqual(self.clic('F1,F2,F3')[0], 303)
		self.assertEqual(sorted(self.fiche_needs()), ['fiche:F1'])
		self.assertEqual(self.state()['backlog']['attentes'], {'F2': 'plafond (4)', 'F3': 'plafond (4)'})

	def test_fiche_qui_chevauche_une_lancee_attend(self):
		self.fiches(('A', ['src/a.ts']))
		self.clic('F1')
		self.fiches(('B', ['src/a.ts']))
		self.assertEqual(self.clic('F2')[0], 303)
		self.assertEqual(sorted(self.fiche_needs()), ['fiche:F1'])
		self.assertEqual(self.state()['backlog']['attentes'], {'F2': 'chevauche F1 sur src/a.ts'})

	def test_fichier_invalide_rien_lance(self):
		self.fiches(('A', ['src/a.ts']))
		with open(backlog.chemin(self.tmp, 'backlog.json'), 'w') as f:
			f.write('{pas du json')
		code, msg = self.clic('F1')
		self.assertEqual(code, 409)
		self.assertIn('backlog.json', msg)
		self.assertEqual(self.state()['needs'], [])
		self.un_tour()
		self.assertIn('backlog.json', self.state()['backlog']['erreur'])
		self.assertEqual(self.state()['backlog']['fiches'], [])


class Message(Lancer):
	"""T061 : un seul message à l'orchestrateur, avec la vague, les attentes et leur motif, et le brief de chaque lancée."""

	def test_un_seul_message_complet(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/a.ts']), ('C', ['src/c.ts']))
		self.clic('F1,F2,F3')
		envois = self.envois()
		self.assertEqual(len(envois), 1)
		texte = envois[0][-2]
		self.assertIn('vague 1 : F1, F3', texte)
		self.assertIn('F2 (chevauche F1 sur src/a.ts)', texte)
		b = self.backlog()
		for fid in ('F1', 'F3'):
			with self.subTest(fiche=fid):
				self.assertIn(backlog.brief(b[fid], []), texte)
				self.assertIn(f"besoin {b[fid]['besoin']}", texte)
		self.assertNotIn('F2 : B', texte)  # une fiche en attente n'a pas de brief

	def test_rien_ne_part_rien_n_est_envoye(self):
		self.fiches(('A', ['src/a.ts']))
		self.plafond(4)
		self.clic('F1')
		self.assertEqual(self.envois(), [])


class Suite(Lancer):
	"""T062 : au tour, une place libre lance l'attente sans clic ; besoin done : faite ; dropped : prête."""

	def test_place_liberee_la_fiche_part_sans_clic(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/b.ts']), ('C', ['src/c.ts']))
		self.plafond(3)
		self.clic('F1,F2,F3')
		self.assertEqual(len(self.envois()), 1)
		self.un_tour(agents=[{'panelId': f'x{i}', 'state': 'running'} for i in range(2)])  # 2 vivants + F1 sans agent : 1 place
		self.assertEqual(sorted(self.fiche_needs()), ['fiche:F1', 'fiche:F2'])
		self.assertEqual(len(self.envois()), 2)
		self.assertIn('F2', self.envois()[1][-2])
		self.assertEqual(self.state()['backlog']['attentes'], {'F3': 'plafond (4)'})
		self.un_tour()
		self.assertEqual(sorted(self.fiche_needs()), ['fiche:F1', 'fiche:F2', 'fiche:F3'])
		self.assertEqual(len(self.envois()), 3)
		self.un_tour()
		self.assertEqual(len(self.envois()), 3)  # plus rien en attente : aucun message

	def test_une_pretes_non_cliquee_ne_part_jamais(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/b.ts']))
		self.clic('F1')
		self.un_tour()
		self.assertEqual(sorted(self.fiche_needs()), ['fiche:F1'])
		self.assertEqual(self.backlog()['F2']['etat'], 'prête')

	def test_besoin_done_fiche_faite(self):
		self.fiches(('A', ['src/a.ts']))
		self.clic('F1')
		with agence.tx() as st:
			agence.close_need(st, self.backlog()['F1']['besoin'], 'done', 'https://github.com/x/y/pull/1')
		self.un_tour()
		self.assertEqual(self.backlog()['F1']['etat'], 'faite')

	def test_besoin_dropped_fiche_pretes_avec_la_ligne(self):
		self.fiches(('A', ['src/a.ts']))
		self.clic('F1')
		nid = self.backlog()['F1']['besoin']
		with agence.tx() as st:
			agence.close_need(st, nid, 'dropped')
		self.un_tour()
		f = self.backlog()['F1']
		self.assertEqual((f['etat'], f['besoin']), ('prête', None))
		self.assertIn("abandon de l'exécution", f['journal'][-1]['text'])
		self.un_tour()
		self.assertEqual(len(self.fiche_needs()), 1)  # revenue prête : un nouveau clic, jamais seule

	def test_dependance_attend_sa_fiche_faite(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/b.ts']))
		with agence.verrou():
			b = backlog.charger(self.tmp)['backlog']
			backlog.modifier(b, 'F2', T0, dependances=['F1'])
			backlog.ecrire(self.tmp, 'backlog.json', b)
		self.clic('F1,F2')
		self.assertEqual(self.state()['backlog']['attentes'], {'F2': 'dépendance F1'})
		with agence.tx() as st:
			agence.close_need(st, self.backlog()['F1']['besoin'], 'done', 'x')
		self.un_tour()
		self.assertEqual(self.backlog()['F2']['etat'], 'lancée')


class Budget(Lancer):
	"""T063 : budget en jetons suivi comme le budget en dollars, sans appel cate de plus par tour."""

	def besoin(self, **k):
		with agence.tx() as st:
			return agence.add_need(st, 'task', 'Budget', panels=['a1'], **k)[0]['id']

	def test_depassement_carte_et_bloquant(self):
		nid = self.besoin(budget_jetons=10000)
		self.un_tour(agents=[{'panelId': 'a1', 'state': 'running'}], live=['a1'],
		             usage=[{'panelId': 'a1', 'inputTokens': 6000, 'outputTokens': 5000, 'costUsd': 0.1}])
		n = agence.find(self.state(), 'needs', nid)
		self.assertTrue(n['overBudget'])
		self.assertTrue(n['overBudgetJetons'])
		self.assertIn('11 000 / 10 000 jetons', agence.page_suivi(self.state()))
		self.assertEqual(agence.action_attendue(self.state(), n), 'budget dépassé')
		self.assertEqual(len([c for c in self.envois() if 'jetons' in c[-2]]), 1)

	def test_mesures_illisibles_rien_pose_consomme_inconnu(self):
		nid = self.besoin(budget_jetons=10000)
		self.un_tour(agents=[{'panelId': 'a1', 'state': 'running'}], live=['a1'], usage='pas du json')
		n = agence.find(self.state(), 'needs', nid)
		self.assertFalse(n['overBudget'])
		self.assertFalse(n.get('overBudgetJetons'))
		self.assertIn('consommé inconnu', agence.page_suivi(self.state()))

	def test_valeurs_hostiles_ignorees(self):
		nid = self.besoin(budget_jetons=10)
		self.un_tour(agents=[{'panelId': 'a1', 'state': 'running'}], live=['a1'],
		             usage=[{'panelId': 'a1', 'inputTokens': float('nan'), 'outputTokens': -50}])
		n = agence.find(self.state(), 'needs', nid)
		self.assertFalse(n['overBudget'])
		self.assertIn('consommé inconnu', agence.page_suivi(self.state()))

	def test_aucun_appel_cate_de_plus_par_tour(self):
		usage = [{'panelId': 'a1', 'inputTokens': 6000, 'outputTokens': 5000}]
		tour = lambda: self.un_tour(agents=[{'panelId': 'a1', 'state': 'running'}], live=['a1'], usage=usage)  # noqa: E731
		self.besoin()
		tour()  # le premier tour peut en faire plus (purge du journal, notifications) : la référence est le deuxième
		avant = len(self.run.calls)
		tour()
		sans = len(self.run.calls) - avant
		self.besoin(budget_jetons=100000, ref='b2')  # sous le budget : aucune notification attendue
		avant = len(self.run.calls)
		tour()
		self.assertEqual(len(self.run.calls) - avant, sans)
		self.assertEqual(len(self.run.ran('cate', 'agent', 'usage')), 3)

	def test_need_add_budget_jetons(self):
		code, out = self.cli('need', 'add', 'x', '--kind', 'cmd', '--budget-jetons', '5000')
		self.assertEqual(code, 0)
		self.assertEqual(agence.find(self.state(), 'needs', out.strip())['budgetJetons'], 5000)
		for faux in ('0', '-3', 'abc'):
			with self.subTest(valeur=faux):
				with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
					self.cli('need', 'add', 'x', '--kind', 'cmd', '--budget-jetons', faux)


class Contrat(Lancer):
	"""La vue `backlog` publiée a exactement les champs de la fixture du lot 5 ; `consomme` jamais 0 par défaut."""

	def setUp(self):
		super().setUp()
		with open(FIXTURE, encoding='utf-8') as f:
			self.attendu = json.load(f)['backlog']

	def test_copie_identique_a_la_fixture_du_panneau(self):
		if not os.path.exists(FIXTURE_SRC):
			self.skipTest('fixture du lot 5 absente de cette branche')
		with open(FIXTURE, encoding='utf-8') as a, open(FIXTURE_SRC, encoding='utf-8') as b:
			self.assertEqual(json.load(a), json.load(b))

	def test_memes_cles(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/a.ts']), ('C', ['src/c.ts']))
		self.fiches(('D', ['src/d.ts']), etat='discussion')
		self.clic('F1,F2')
		self.un_tour(usage=[])
		vue = self.state()['backlog']
		self.assertEqual(set(vue), set(self.attendu))
		for f in vue['fiches']:
			with self.subTest(fiche=f['id']):
				self.assertEqual(set(f), set(self.attendu['fiches'][0]))
		self.assertEqual(vue['erreur'], None)
		self.assertIsInstance(vue['vagues'], list)
		self.assertIsInstance(vue['attentes'], dict)

	def test_consomme_d_une_lancee_et_null_sans_mesure(self):
		self.fiches(('A', ['src/a.ts']), ('B', ['src/b.ts']))
		self.clic('F1,F2')
		with agence.tx() as st:
			st['needs'][0]['panels'] = ['a1']
		self.un_tour(agents=[{'panelId': 'a1', 'state': 'running'}], live=['a1'],
		             usage=[{'panelId': 'a1', 'inputTokens': 600, 'outputTokens': 400}])
		vue = {f['id']: f for f in self.state()['backlog']['fiches']}
		self.assertEqual(vue['F1']['consomme'], 1000)
		self.assertIsNone(vue['F2']['consomme'])
		self.assertEqual((vue['F1']['budgetJetons'], vue['F1']['priorite'], vue['F1']['titre']), (10000, 'P2', 'A'))

	def test_consomme_jamais_nan_ni_negatif(self):
		self.fiches(('A', ['src/a.ts']))
		self.clic('F1')
		with agence.tx() as st:
			st['needs'][0]['panels'] = ['a1']
		self.un_tour(agents=[{'panelId': 'a1', 'state': 'running'}], live=['a1'],
		             usage=[{'panelId': 'a1', 'inputTokens': float('nan'), 'outputTokens': -1}])
		self.assertIsNone(self.state()['backlog']['fiches'][0]['consomme'])
		with open(agence.state_file()) as f:
			self.assertNotIn('NaN', f.read())


class RouteReelle(Base):
	"""/fiches/lancer servie par un vrai `agence watch` (setUp de test_agence.Regisseur, ses méthodes empruntées sans
	hériter de ses tests) : forme de la réponse en succès, double id, deux clics concurrents."""

	TOKEN = test_agence.Regisseur.TOKEN
	def setUp(self):
		super().setUp()
		self.procs = []
		bindir = os.path.join(self.tmp, 'bin')
		os.makedirs(bindir)
		with open(os.path.join(bindir, 'cate'), 'w') as f:
			f.write('#!/bin/sh\necho "[]"\n')
		os.chmod(os.path.join(bindir, 'cate'), 0o755)
		self.port = agence.free_port()
		with agence.tx() as st:
			st['port'] = self.port
		self.env_run = {**os.environ, 'PATH': bindir + os.pathsep + os.environ['PATH']}

	def tearDown(self):
		for p in self.procs:
			if p.poll() is None:
				p.kill()
			p.wait()
			for s in (p.stdin, p.stderr):
				if s:
					s.close()
		super().tearDown()

	watch, wait_port, post, serve = (test_agence.Regisseur.watch, test_agence.Regisseur.wait_port,
	                                 test_agence.Regisseur.post, test_agence.Regisseur.serve)
	fiches = Lancer.fiches

	def lancer(self, ids):
		status, _, body = self.post(self.TOKEN, '/fiches/lancer', 'application/json', ids=ids)
		return status, json.loads(body)

	def besoins(self):
		return [n for n in agence.load()['needs'] if (n['ref'] or '').startswith('fiche:')]

	def prepare(self, *specs):
		with agence.tx() as st:
			st['panels'] = {'orchestrator': 'o1'}
		self.fiches(*specs)
		self.serve()

	def test_reponse_du_succes_egale_la_fixture(self):
		self.prepare(('A', ['src/a.ts']))
		status, body = self.lancer('F1')
		with open(REPONSE, encoding='utf-8') as f:
			self.assertEqual({'status': status, 'body': body}, json.load(f))
		self.assertEqual(len(self.besoins()), 1)

	def test_copie_identique_a_la_fixture_du_panneau(self):
		with open(REPONSE, encoding='utf-8') as a, open(REPONSE_SRC, encoding='utf-8') as b:
			self.assertEqual(json.load(a), json.load(b))

	def test_id_en_double_un_seul_besoin(self):
		self.prepare(('A', ['src/a.ts']))
		self.assertEqual(self.lancer('F1,F1')[0], 200)
		self.assertEqual([n['ref'] for n in self.besoins()], ['fiche:F1'])

	def test_deux_clics_concurrents_un_seul_lot(self):
		self.prepare(('A', ['src/a.ts']), ('B', ['src/b.ts']))
		with concurrent.futures.ThreadPoolExecutor(2) as pool:
			codes = sorted(c for c, _ in pool.map(self.lancer, ['F1,F2', 'F1,F2']))
		self.assertEqual(codes, [200, 409])
		self.assertEqual(sorted(n['ref'] for n in self.besoins()), ['fiche:F1', 'fiche:F2'])


if __name__ == '__main__':
	unittest.main()
