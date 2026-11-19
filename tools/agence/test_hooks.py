"""Tests de `agence hooks install|uninstall|status` (FR-007, SC-003), en faux HOME.

La CLI tourne pour de vrai (processus) avec HOME pointé sur un dossier jetable ;
les fixtures de fixtures/settings/ sont les cas hostiles du lot 0. Le vrai
~/.claude/settings.json est seulement lu (empreinte avant et après la suite) :
la suite échoue s'il a bougé, ou si un test voit le vrai HOME.
"""
import glob
import hashlib
import json
import os
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
AGENCE_PY = os.path.join(HERE, 'agence.py')
FIXTURES = os.path.join(HERE, 'fixtures', 'settings')
VRAI_HOME = pwd.getpwuid(os.getuid()).pw_dir
VRAI_SETTINGS = os.path.join(VRAI_HOME, '.claude', 'settings.json')


def empreinte(path):
	try:
		with open(path, 'rb') as f:
			return hashlib.sha256(f.read()).hexdigest()
	except FileNotFoundError:
		return None


AVANT = empreinte(VRAI_SETTINGS)


def tearDownModule():
	assert empreinte(VRAI_SETTINGS) == AVANT, 'le vrai ~/.claude/settings.json a changé pendant la suite'


def fixture(name):
	with open(os.path.join(FIXTURES, name), 'rb') as f:
		return f.read()


def attendu():
	"""Les deux entrées agence, texte figé du contrat (contracts/hooks.md)."""
	with open(os.path.join(FIXTURES, 'settings-attendu.json')) as f:
		return json.load(f)['hooks']['PreToolUse']


class FauxHome(unittest.TestCase):
	"""HOME jetable ; échoue s'il est le vrai."""

	def setUp(self):
		self.home = os.path.realpath(tempfile.mkdtemp(prefix='agence-home-'))
		self.addCleanup(self.nettoie)
		if self.home == os.path.realpath(VRAI_HOME) or self.home.startswith(os.path.realpath(VRAI_HOME) + os.sep + '.claude'):
			self.fail(f'faux HOME attendu, reçu le vrai : {self.home}')
		self.claude = os.path.join(self.home, '.claude')
		self.settings = os.path.join(self.claude, 'settings.json')
		self.env = {'HOME': self.home, 'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
		            'GIT_CONFIG_GLOBAL': os.path.join(self.home, '.gitconfig'), 'GIT_CONFIG_NOSYSTEM': '1', 'LANG': 'C.UTF-8'}

	def nettoie(self):
		for d, _, _ in os.walk(self.home):  # rend les dossiers 0555 des tests supprimables
			os.chmod(d, 0o755)
		shutil.rmtree(self.home, ignore_errors=True)

	def agence(self, *args, stdin=None):
		self.assertNotEqual(os.path.realpath(self.env['HOME']), os.path.realpath(VRAI_HOME))
		return subprocess.run([sys.executable, AGENCE_PY, *args], env=self.env, input=stdin,
		                      capture_output=True, text=True, timeout=30)

	def refuse(self, r):
		"""Refus de la CLI (code 2, « agence : <raison> »), pas une erreur d'argparse."""
		self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
		self.assertTrue(r.stderr.startswith('agence : '), r.stderr)

	def pose(self, name, mode=None):
		os.makedirs(self.claude, exist_ok=True)
		with open(self.settings, 'wb') as f:
			f.write(fixture(name) if name.endswith('.json') else name.encode())
		if mode is not None:
			os.chmod(self.settings, mode)

	def lit(self, path=None):
		with open(path or self.settings) as f:
			return json.load(f)

	def octets(self, path=None):
		with open(path or self.settings, 'rb') as f:
			return f.read()

	def sauvegardes(self, d=None):
		return sorted(glob.glob(os.path.join(d or self.claude, 'settings.json.bak-agence-*')))


class Installation(FauxHome):
	def test_json_invalide_code_2_rien_ecrit_sans_sauvegarde(self):
		self.pose('invalide.json')
		r = self.agence('hooks', 'install')
		self.refuse(r)
		self.assertEqual(self.octets(), fixture('invalide.json'))
		self.assertEqual(self.sauvegardes(), [])
		self.assertEqual(os.listdir(self.claude), ['settings.json'])

	def test_commentaires_refuses_et_le_message_le_dit(self):
		self.pose('commentaires.json')
		r = self.agence('hooks', 'install')
		self.refuse(r)
		self.assertIn('commentaire', r.stderr)
		self.assertEqual(self.octets(), fixture('commentaires.json'))
		self.assertEqual(self.sauvegardes(), [])

	def test_cle_dupliquee_refusee(self):
		self.pose('{"hooks": {}, "hooks": {"PreToolUse": []}}')
		r = self.agence('hooks', 'install')
		self.refuse(r)
		self.assertIn('hooks', r.stderr)
		self.assertEqual(self.sauvegardes(), [])

	def test_forme_inattendue_refusee(self):
		for texte in ('[]', '{"hooks": []}', '{"hooks": {"PreToolUse": {}}}', '{"hooks": {"PreToolUse": [1]}}'):
			with self.subTest(texte=texte):
				self.pose(texte)
				r = self.agence('hooks', 'install')
				self.refuse(r)
				self.assertEqual(self.octets().decode(), texte)
				self.assertEqual(self.sauvegardes(), [])

	def test_bom_utf8_accepte(self):
		self.pose('﻿{"model": "x"}')
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.lit()['hooks']['PreToolUse'], attendu())

	def test_hooks_existants_intacts_entrees_agence_ajoutees_une_fois(self):
		self.pose('hooks-existants.json')
		origine = self.lit()
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		apres = self.lit()
		pre = apres['hooks']['PreToolUse']
		self.assertEqual(pre[:len(origine['hooks']['PreToolUse'])], origine['hooks']['PreToolUse'])
		self.assertEqual(pre[len(origine['hooks']['PreToolUse']):], attendu())
		self.assertEqual({k: v for k, v in apres['hooks'].items() if k != 'PreToolUse'},
		                 {k: v for k, v in origine['hooks'].items() if k != 'PreToolUse'})
		self.assertEqual({k: v for k, v in apres.items() if k != 'hooks'}, {k: v for k, v in origine.items() if k != 'hooks'})

	def test_fichier_absent_cree_avec_les_seules_entrees_agence(self):
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.lit(), {'hooks': {'PreToolUse': attendu()}})
		self.assertEqual(self.sauvegardes(), [])
		self.assertEqual(os.listdir(self.claude), ['settings.json'])

	def test_fichier_en_lecture_seule_refuse_mode_garde(self):
		self.pose('lecture-seule.json', 0o444)
		r = self.agence('hooks', 'install')
		self.refuse(r)
		self.assertIn('inscriptible', r.stderr)
		self.assertEqual(self.octets(), fixture('lecture-seule.json'))
		self.assertEqual(stat.S_IMODE(os.stat(self.settings).st_mode), 0o444)
		self.assertEqual(self.sauvegardes(), [])

	def test_dossier_en_lecture_seule_refuse(self):
		self.pose('lecture-seule.json')
		os.chmod(self.claude, 0o555)
		r = self.agence('hooks', 'install')
		os.chmod(self.claude, 0o755)
		self.refuse(r)
		self.assertEqual(self.octets(), fixture('lecture-seule.json'))
		self.assertEqual(os.listdir(self.claude), ['settings.json'])

	def test_dossier_parent_en_lecture_seule_refuse_sans_creer(self):
		os.chmod(self.home, 0o555)
		r = self.agence('hooks', 'install')
		os.chmod(self.home, 0o755)
		self.refuse(r)
		self.assertFalse(os.path.exists(self.claude))

	def test_mode_du_fichier_conserve(self):
		self.pose('lecture-seule.json', 0o640)
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(stat.S_IMODE(os.stat(self.settings).st_mode), 0o640)
		self.assertEqual(self.lit()['hooks']['PreToolUse'][-2:], attendu())

	def test_lien_symbolique_la_cible_est_ecrite_le_lien_reste(self):
		ailleurs = os.path.join(self.home, 'config', 'claude')
		os.makedirs(ailleurs)
		cible = os.path.join(ailleurs, 'settings.json')
		with open(cible, 'wb') as f:
			f.write(fixture('lecture-seule.json'))
		os.makedirs(self.claude)
		os.symlink(os.path.relpath(cible, self.claude), self.settings)
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertTrue(os.path.islink(self.settings))
		self.assertEqual(os.path.realpath(self.settings), os.path.realpath(cible))
		self.assertEqual(self.lit(cible)['hooks']['PreToolUse'][-2:], attendu())
		self.assertEqual(os.listdir(ailleurs), ['settings.json'])  # rien d'autre dans le dossier de la cible
		self.assertEqual(len(self.sauvegardes()), 1)  # sauvegarde à côté du chemin nommé, ~/.claude
		with open(self.sauvegardes()[0], 'rb') as f:
			self.assertEqual(f.read(), fixture('lecture-seule.json'))

	def test_deux_installs_valent_un_une_seule_sauvegarde(self):
		self.pose('hooks-existants.json')
		self.assertEqual(self.agence('hooks', 'install').returncode, 0)
		une = self.octets()
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.octets(), une)
		self.assertEqual(len(self.sauvegardes()), 1)
		with open(self.sauvegardes()[0], 'rb') as f:
			self.assertEqual(f.read(), fixture('hooks-existants.json'))
		self.assertRegex(os.path.basename(self.sauvegardes()[0]), r'^settings\.json\.bak-agence-\d{8}-\d{6}$')

	def test_ancienne_entree_agence_remplacee_pas_doublee(self):
		self.pose(json.dumps({'hooks': {'PreToolUse': [
			{'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': '/vieux/agence-hook pages'}]}]}}))
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.lit()['hooks']['PreToolUse'], attendu())

	def test_ancien_matcher_d_envoi_partiel_puis_mis_a_jour_sans_doublon(self):
		"""Entrées du premier lot 3 (matcher d'envoi sans reply, forward ni schedule) : reconnues à agence-hook."""
		ancien = json.loads(json.dumps(attendu()))
		ancien[0]['matcher'] = 'mcp__.*(slack_send_message|Gmail__send_message)$'
		self.pose(json.dumps({'hooks': {'PreToolUse': [{'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': '/opt/a.sh'}]}] + ancien}}))
		r = self.agence('hooks', 'status', '--json')
		self.assertEqual((r.returncode, json.loads(r.stdout)['statut']), (1, 'partiel'))
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.lit()['hooks']['PreToolUse'][1:], attendu())
		self.assertEqual(self.lit()['hooks']['PreToolUse'][0]['hooks'][0]['command'], '/opt/a.sh')
		self.assertEqual(len(self.sauvegardes()), 1)
		r = self.agence('hooks', 'uninstall')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.lit(), {'hooks': {'PreToolUse': [{'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': '/opt/a.sh'}]}]}})

	def test_matcher_d_envoi_couvre_tous_les_envois(self):
		envoi = attendu()[0]['matcher']
		for tool in ('mcp__claude_ai_Slack__slack_send_message', 'mcp__claude_ai_Slack__slack_schedule_message',
		             'mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward'):
			self.assertRegex(tool, '^(?:' + envoi + ')$')

	def test_permissions_et_cles_inconnues_intactes(self):
		self.pose('cles-inconnues.json')
		origine = self.lit()
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		apres = self.lit()
		self.assertEqual(apres['permissions'], origine['permissions'])
		self.assertEqual({k: v for k, v in apres.items() if k != 'hooks'}, {k: v for k, v in origine.items() if k != 'hooks'})
		self.assertEqual(apres['hooks']['EvenementFutur'], origine['hooks']['EvenementFutur'])
		texte = self.octets().decode()
		self.assertIn('12345678901234567890', texte)
		self.assertIn('1.0', texte)
		self.assertIn('🙂', texte)

	def test_option_settings(self):
		autre = os.path.join(self.home, 'autre.json')
		r = self.agence('hooks', 'install', '--settings', autre)
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.lit(autre)['hooks']['PreToolUse'], attendu())
		self.assertFalse(os.path.exists(self.settings))


class Desinstallation(FauxHome):
	def aller_retour(self, texte):
		self.pose(texte)
		origine = self.lit()
		self.assertEqual(self.agence('hooks', 'install').returncode, 0)
		r = self.agence('hooks', 'uninstall')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.lit(), origine)

	def test_rend_le_json_d_origine(self):
		for name in ('hooks-existants.json', 'cles-inconnues.json', 'lecture-seule.json'):
			with self.subTest(name=name):
				self.aller_retour(name)

	def test_retire_preToolUse_et_hooks_vides(self):
		self.aller_retour('{"model": "x"}')
		self.aller_retour('{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "/opt/fin.sh"}]}]}}')

	def test_absent_ou_sans_garde_rien_ecrit(self):
		r = self.agence('hooks', 'uninstall')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertFalse(os.path.exists(self.settings))
		self.pose('hooks-existants.json')
		r = self.agence('hooks', 'uninstall')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.octets(), fixture('hooks-existants.json'))
		self.assertEqual(self.sauvegardes(), [])

	def test_json_invalide_code_2(self):
		self.pose('invalide.json')
		r = self.agence('hooks', 'uninstall')
		self.refuse(r)
		self.assertEqual(self.octets(), fixture('invalide.json'))


class Statut(FauxHome):
	def statut(self):
		r = self.agence('hooks', 'status', '--json')
		return r.returncode, json.loads(r.stdout)['statut']

	def test_actif_inactif_partiel(self):
		self.assertEqual(self.statut(), (1, 'inactif'))  # fichier absent
		self.pose('hooks-existants.json')
		self.assertEqual(self.statut(), (1, 'inactif'))
		self.agence('hooks', 'install')
		self.assertEqual(self.statut(), (0, 'actif'))
		r = self.agence('hooks', 'status')
		self.assertEqual((r.returncode, r.stdout.strip().split()[0]), (0, 'actif'))
		st = self.lit()
		st['hooks']['PreToolUse'].pop()  # garde des pages retiré à la main
		self.pose(json.dumps(st))
		self.assertEqual(self.statut(), (1, 'partiel'))
		st['hooks']['PreToolUse'][-1]['hooks'][0]['command'] = '/vieux/agence-hook send'  # commande d'une autre version
		self.pose(json.dumps(st))
		self.assertEqual(self.statut(), (1, 'partiel'))

	def test_illisible_inactif(self):
		self.pose('invalide.json')
		self.assertEqual(self.statut(), (1, 'inactif'))

	def test_status_n_ecrit_rien(self):
		self.pose('hooks-existants.json')
		self.agence('hooks', 'status')
		self.assertEqual(self.octets(), fixture('hooks-existants.json'))
		self.assertEqual(os.listdir(self.claude), ['settings.json'])


if __name__ == '__main__':
	unittest.main()
