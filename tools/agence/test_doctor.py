"""Tests de `agence doctor --prerequis` (FR-009, q305) : une ligne par point
(ok, manque, info) avec la commande qui règle ; code 1 si un point bloquant
manque ; rien d'écrit. `cate`, `gh` et `claude` sont simulés (agence.RUN),
le HOME et l'install du runtime sont jetables, le socket est un vrai socket
Unix. `doctor` seul et `--relance` restent ceux de la spec 001 (test_agence.py,
classe Relance).
"""
import io
import json
import os
import socket
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
import pratiques  # noqa: E402
from test_agence import Base  # noqa: E402
from test_hooks import VRAI_HOME  # noqa: E402

TOUS = ('cliEnabled', 'cliPanelReadEnabled', 'cliPanelControlEnabled', 'cliAgentReadEnabled', 'cliAgentControlEnabled',
        'cliTerminalReadEnabled', 'cliTerminalInputEnabled', 'cliSkillInstallEnabled')
BLOQUANTS = ('python3', 'terminal Cate', 'CLI livrée', 'agent start --model', 'agent usage', 'type agence',
             'réglages CLI', 'gh', 'claude', 'gardes')
# Points qui exigent un terminal Cate ou un Cate déjà démarré : `info` sous --hors-cate.
DANS_CATE = ('terminal Cate', 'CLI livrée', 'agent start --model', 'agent usage', 'type agence', 'réglages CLI', 'skill')


class Prerequis(Base):
	def setUp(self):
		super().setUp()
		self.home = os.path.join(self.tmp, 'home')
		self.assertNotEqual(os.path.realpath(self.home), os.path.realpath(VRAI_HOME))
		self.ws = os.path.join(self.tmp, 'ws')
		os.makedirs(self.ws)
		vieux = {k: os.environ.get(k) for k in ('HOME', 'CATE_HOME')}
		self.addCleanup(lambda: [os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v) for k, v in vieux.items()])
		os.environ['HOME'] = self.home
		os.environ.pop('CATE_HOME', None)
		os.environ['CATE_SOCKET'] = self.sock = os.path.join(self.ws, 'runtime.sock')
		self.monde()

	def monde(self):
		"""Tout est là : chaque test retire un point."""
		self.serveur = socket.socket(socket.AF_UNIX)
		self.serveur.bind(self.sock)
		self.serveur.listen(1)
		self.addCleanup(self.serveur.close)
		self.reglages({k: True for k in TOUS})
		install = os.path.join(self.home, '.cate', 'runtime', 'b1', 'agence')
		os.makedirs(install)
		with open(os.path.join(install, 'agence'), 'w') as f:
			f.write('#!/bin/sh\n')
		with open(os.path.join(self.home, '.cate', 'runtime', 'current'), 'w') as f:
			f.write('b1\n')
		self.run.reply(['cate', 'agent', 'start', '--help'], 'Options:\n  --model <model>  Model\n')
		self.run.reply(['cate', 'agent', 'usage', '--help'], 'Usage: cate agent usage\n')
		self.run.reply(['cate', 'panel', 'create', '--help'], '<type>  The panel type: terminal, editor, browser, agence\n')
		self.run.reply(['gh', 'auth', 'status'], 'Logged in\n')
		self.run.reply(['claude', '--version'], '2.1.0 (Claude Code)\n')
		os.makedirs(os.path.join(self.tmp, '.claude', 'skills', 'orchestrateur'))
		with open(os.path.join(self.tmp, '.claude', 'skills', 'orchestrateur', 'SKILL.md'), 'w') as f:
			f.write('---\nname: orchestrateur\n---\n')
		os.makedirs(os.path.join(self.home, '.claude'))
		with open(os.path.join(self.home, '.claude', 'settings.json'), 'w') as f:
			json.dump({'hooks': {'PreToolUse': agence.hook_entrees()}}, f)

	def reglages(self, valeurs):
		with open(os.path.join(self.ws, 'settings.json'), 'w') as f:
			json.dump(valeurs, f)

	def doctor(self, *extra):
		out = io.StringIO()
		with redirect_stdout(out):
			code = agence.main(['doctor', '--prerequis', '--json', *extra])
		return code, json.loads(out.getvalue())

	def point(self, points, nom):
		trouves = [p for p in points['points'] if p['point'] == nom]
		self.assertEqual(len(trouves), 1, f'{nom} : {points}')
		return trouves[0]

	def manque(self, nom, code=1):
		c, points = self.doctor()
		p = self.point(points, nom)
		self.assertEqual((c, p['etat']), (code, 'manque'), p)
		self.assertTrue(p['commande'], p)
		return p

	# ---- tout va bien ----

	def test_tout_ok_code_0(self):
		code, points = self.doctor()
		self.assertEqual(code, 0, points)
		for nom in BLOQUANTS + ('skill', 'nom'):
			self.assertEqual(self.point(points, nom)['etat'], 'ok', nom)
		self.assertEqual(self.point(points, 'Slack, Gmail')['etat'], 'info')
		for nom in BLOQUANTS:
			self.assertTrue(self.point(points, nom)['bloquant'], nom)

	def test_texte_une_ligne_par_point(self):
		self.run.reply(['gh', 'auth', 'status'], '', code=1, err='not logged in')
		out = io.StringIO()
		with redirect_stdout(out):
			code = agence.main(['doctor', '--prerequis'])
		lignes = out.getvalue().strip().split('\n')
		self.assertEqual(code, 1)
		self.assertEqual(len(lignes), len(self.doctor()[1]['points']))
		gh = [x for x in lignes if x.split('\t')[1:2] == ['gh']]
		self.assertEqual(len(gh), 1, lignes)
		self.assertTrue(gh[0].startswith('manque\t'), gh)
		self.assertIn('gh auth login', gh[0])
		for x in lignes:
			self.assertIn(x.split('\t')[0], ('ok', 'manque', 'info'), x)

	# ---- chaque point manquant ----

	def test_python3_trop_ancien(self):
		with mock.patch.object(agence, 'PYTHON_MIN', (99, 0)):
			p = self.manque('python3')
		self.assertIn('xcode-select --install', p['commande'])

	def test_socket_absent(self):
		self.serveur.close()
		os.remove(self.sock)
		self.manque('terminal Cate')

	def test_hors_terminal_cate(self):
		del os.environ['CATE_SOCKET']
		self.manque('terminal Cate')
		self.manque('réglages CLI')

	def test_agence_absent_de_l_install(self):
		os.remove(os.path.join(self.home, '.cate', 'runtime', 'b1', 'agence', 'agence'))
		self.assertIn('cate-fork-update', self.manque('CLI livrée')['commande'])
		os.remove(os.path.join(self.home, '.cate', 'runtime', 'current'))
		self.manque('CLI livrée')

	def test_model_absent_de_l_aide(self):
		self.run.reply(['cate', 'agent', 'start', '--help'], 'Options:\n  --effort <e>\n')
		self.manque('agent start --model')

	def test_agent_usage_en_echec(self):
		self.run.reply(['cate', 'agent', 'usage', '--help'], '', code=2, err='unknown command usage')
		self.manque('agent usage')

	def test_type_agence_absent(self):
		self.run.reply(['cate', 'panel', 'create', '--help'], '<type>  The panel type: terminal, editor\n')
		self.manque('type agence')

	def test_reglages_cli_a_false(self):
		for cle in TOUS:
			with self.subTest(cle=cle):
				self.reglages(dict({k: True for k in TOUS}, **{cle: False}))
				p = self.manque('réglages CLI')
				self.assertIn(cle, p['detail'])

	def test_reglages_par_defaut_input_terminal_coupe(self):
		self.reglages({})  # fichier sans clé : défauts de Cate, cliTerminalInputEnabled coupé (q307)
		p = self.manque('réglages CLI')
		self.assertIn('cliTerminalInputEnabled', p['detail'])
		self.assertIn('Workspace > CLI', p['commande'])
		self.assertNotIn('cliPanelReadEnabled', p['detail'])

	def test_texte_des_reglages_identique_a_settings_hint(self):
		self.reglages(dict({k: True for k in TOUS}, cliPanelReadEnabled=False))
		self.assertIn(agence.SETTINGS_HINT, self.manque('réglages CLI')['commande'])

	def test_reglages_illisibles(self):
		with open(os.path.join(self.ws, 'settings.json'), 'w') as f:
			f.write('{')
		self.manque('réglages CLI')

	def test_gh_non_connecte(self):
		self.run.reply(['gh', 'auth', 'status'], '', code=1, err='You are not logged into any GitHub hosts')
		self.assertIn('gh auth login', self.manque('gh')['commande'])

	def test_claude_absent(self):
		self.run.reply(['claude', '--version'], '', code=127, err='No such file')
		self.manque('claude')

	def test_gardes_inactifs_ou_partiels(self):
		settings = os.path.join(self.home, '.claude', 'settings.json')
		os.remove(settings)
		self.assertIn('agence hooks install', self.manque('gardes')['commande'])
		with open(settings, 'w') as f:
			json.dump({'hooks': {'PreToolUse': agence.hook_entrees()[:1]}}, f)
		self.assertIn('partiel', self.manque('gardes')['detail'])

	def test_skill_absent_non_bloquant(self):
		os.remove(os.path.join(self.tmp, '.claude', 'skills', 'orchestrateur', 'SKILL.md'))
		p = self.manque('skill', code=0)
		self.assertFalse(p['bloquant'])

	def test_nom_par_defaut_info(self):
		with mock.patch.object(agence, 'nom_source', lambda: ("L'humain", 'défaut')):
			code, points = self.doctor()
		p = self.point(points, 'nom')
		self.assertEqual((code, p['etat'], p['bloquant']), (0, 'info', False))
		self.assertIn('git config --global agence.nom', p['commande'])

	# ---- politique (spec 005, lot 2) ----

	def politique(self, contenu):
		chemin = pratiques.fichier_projet(self.tmp)
		os.makedirs(os.path.dirname(chemin), exist_ok=True)
		with open(chemin, 'w') as f:
			f.write(contenu if isinstance(contenu, str) else json.dumps(contenu))

	def test_pratiques_info_sans_fichier(self):
		code, points = self.doctor()
		p = self.point(points, 'pratiques')
		self.assertEqual((code, p['etat']), (0, 'info'))
		self.assertIn('neutre (aucun fichier)', p['detail'])
		self.assertIn('agence pratiques preset', p['commande'])

	def test_pratiques_ok_avec_un_fichier(self):
		self.politique({'preset': 'pr-tdd'})
		code, points = self.doctor()
		p = self.point(points, 'pratiques')
		self.assertEqual((code, p['etat']), (0, 'ok'))
		self.assertIn('pr-tdd (projet)', p['detail'])

	def test_pratiques_invalide_bloque_en_citant_l_erreur(self):
		self.politique({'livraison': {'methode': 'fast-forward'}})
		p = self.manque('pratiques')
		self.assertTrue(p['bloquant'])
		self.assertIn('livraison.methode', p['detail'])
		self.assertIn('agence pratiques check', p['commande'])

	def test_gh_bloquant_sous_neutre_et_pr_tdd(self):
		self.run.reply(['gh', 'auth', 'status'], '', code=1, err='not logged in')
		self.assertTrue(self.manque('gh')['bloquant'])
		self.politique({'preset': 'pr-tdd'})
		self.assertTrue(self.manque('gh')['bloquant'])

	def test_gh_info_en_mode_main_sans_besoin_de_github(self):
		self.run.reply(['gh', 'auth', 'status'], '', code=1, err='not logged in')
		self.politique({'livraison': {'mode': 'main'}})
		code, points = self.doctor()
		p = self.point(points, 'gh')
		self.assertEqual((code, p['etat'], p['bloquant']), (0, 'info', False))
		self.politique({'livraison': {'mode': 'main'}, 'issue': 'obligatoire'})
		self.assertTrue(self.manque('gh')['bloquant'])

	# ---- lecture seule, comportements gardés ----

	def test_rien_ecrit(self):
		def photo():
			return {os.path.join(d, f): os.stat(os.path.join(d, f)).st_mtime_ns
			        for d, _, fs in os.walk(self.tmp) for f in fs + ['.']}
		avant = photo()
		self.run.reply(['gh', 'auth', 'status'], '', code=1)
		self.doctor()
		self.assertEqual(photo(), avant)
		self.assertFalse(os.path.exists(os.path.join(self.tmp, '.cate')))

	def test_aucune_commande_qui_ecrit(self):
		self.doctor()
		for cmd, _ in self.run.calls:
			self.assertTrue(cmd[-1] == '--help' or cmd[:2] in (['gh', 'auth'], ['claude', '--version'], ['git', 'config'], ['git', '-C']), cmd)

	# ---- --hors-cate : lancé par l'amorçage, avant que Cate ait démarré (lot 4, T031) ----

	def hors_cate(self):
		"""Comme après la ligne d'amorçage : ni socket, ni install du runtime, ni `cate` sur le PATH."""
		del os.environ['CATE_SOCKET']
		os.remove(os.path.join(self.home, '.cate', 'runtime', 'current'))
		self.run.reply(['cate'], '', code=127, err='cate: command not found')
		return self.doctor('--hors-cate')

	def test_hors_cate_points_de_cate_en_info(self):
		code, points = self.hors_cate()
		self.assertEqual(code, 0, points)
		for nom in DANS_CATE:
			p = self.point(points, nom)
			self.assertEqual(p['etat'], 'info', p)
			self.assertIn('à vérifier dans un terminal Cate', p['detail'])
			self.assertEqual(p['commande'], 'agence doctor --prerequis')
		for nom in ('python3', 'gh', 'claude', 'gardes', 'nom'):
			self.assertEqual(self.point(points, nom)['etat'], 'ok', nom)

	def test_hors_cate_ne_lance_pas_cate(self):
		self.hors_cate()
		self.assertEqual([c for c, _ in self.run.calls if c[0] == 'cate'], [])

	def test_hors_cate_code_1_pour_un_bloquant_hors_cate(self):
		os.remove(os.path.join(self.home, '.claude', 'settings.json'))
		self.run.reply(['gh', 'auth', 'status'], '', code=1, err='not logged in')
		code, points = self.hors_cate()
		self.assertEqual(code, 1)
		manques = sorted(p['point'] for p in points['points'] if p['etat'] == 'manque')
		self.assertEqual(manques, ['gardes', 'gh'])
		self.run.reply(['claude', '--version'], '', code=127)
		self.assertEqual(self.point(self.doctor('--hors-cate')[1], 'claude')['etat'], 'manque')

	def test_hors_cate_nom_par_defaut_reste_info(self):
		with mock.patch.object(agence, 'nom_source', lambda: ("L'humain", 'défaut')):
			code, points = self.hors_cate()
		self.assertEqual((code, self.point(points, 'nom')['etat']), (0, 'info'))

	def test_hors_cate_texte(self):
		del os.environ['CATE_SOCKET']
		out = io.StringIO()
		with redirect_stdout(out):
			code = agence.main(['doctor', '--prerequis', '--hors-cate'])
		lignes = out.getvalue().strip().split('\n')
		self.assertEqual(code, 0, lignes)
		socket_ = [x for x in lignes if x.split('\t')[1:2] == ['terminal Cate']]
		self.assertEqual(socket_, ['info\tterminal Cate\tà vérifier dans un terminal Cate\t→ agence doctor --prerequis'])

	def test_hors_cate_rien_ecrit(self):
		def photo():
			return {os.path.join(d, f): os.stat(os.path.join(d, f)).st_mtime_ns
			        for d, _, fs in os.walk(self.tmp) for f in fs + ['.']}
		del os.environ['CATE_SOCKET']
		avant = photo()
		self.doctor('--hors-cate')
		self.assertEqual(photo(), avant)

	def test_doctor_seul_inchange(self):
		"""Sans --prerequis : le contrôle de relance, première ligne oui ou non (spec 001)."""
		out = io.StringIO()
		with redirect_stdout(out):
			agence.main(['doctor'])
		self.assertIn(out.getvalue().split('\n')[0].split(' ')[0], ('oui', 'non'))


if __name__ == '__main__':
	unittest.main()
