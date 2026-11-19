"""Tests du garde (FR-008, US2 scénarios 4 et 5) : la commande lue dans le
settings.json produit par `agence hooks install` est exécutée pour de vrai
(`/bin/sh -c`, comme Claude Code), en faux HOME, avec le PreToolUse sur stdin.

`send` échoue fermé : toute issue autre qu'un brouillon cliqué identique est
`ask`, y compris CLI absente, lanceur non exécutable, python3 absent ou en échec.
Une sortie vide, ou un code non nul, compte comme un échec ouvert.
"""
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
from test_agence import FakeRun  # noqa: E402
from test_hooks import AGENCE_PY, HERE, FauxHome  # noqa: E402

HOOK = os.path.join(HERE, 'agence-hook')
SLACK = 'mcp__claude_ai_Slack__slack_send_message'
GMAIL = 'mcp__claude_ai_Gmail__send_message'


class Garde(FauxHome):
	def setUp(self):
		super().setUp()
		r = self.agence('hooks', 'install')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.entrees = self.lit()['hooks']['PreToolUse']
		self.cmd = {e['matcher']: e['hooks'][0]['command'] for e in self.entrees}
		self.send_cmd = next(c for c in self.cmd.values() if 'exec "$f" send' in c)
		self.pages_cmd = self.cmd['Bash|WebFetch|Write|Edit|MultiEdit']
		self.projet = os.path.join(self.home, 'projet')
		os.makedirs(self.projet)
		self.runtime = os.path.join(self.home, '.cate', 'runtime')

	# ---- monde ----

	def installe(self, build='b1', hook=True, executable=True, cli=None):
		"""Install du runtime <build> avec agence/agence-hook (copie du lanceur) et agence.py (copie, ou texte donné)."""
		d = os.path.join(self.runtime, build, 'agence')
		os.makedirs(d, exist_ok=True)
		if hook:
			shutil.copy(HOOK, os.path.join(d, 'agence-hook'))
			os.chmod(os.path.join(d, 'agence-hook'), 0o755 if executable else 0o644)
		if cli is None:
			shutil.copy(AGENCE_PY, os.path.join(d, 'agence.py'))
		else:
			with open(os.path.join(d, 'agence.py'), 'w') as f:
				f.write(cli)
		with open(os.path.join(self.runtime, 'current'), 'w') as f:
			f.write(build + '\n')

	def orchestre(self, clic=False, cible='slack:C123', texte='Bonjour', titre=None):
		"""Projet orchestré (state.json écrit par la CLI) avec un brouillon, cliqué ou non par l'humain."""
		vieux = {k: os.environ.get(k) for k in ('AGENCE_ROOT', 'CATE_SOCKET', 'AGENCE_NOM', 'HOME')}
		os.environ.update(AGENCE_ROOT=self.projet, CATE_SOCKET='/tmp/x.sock', AGENCE_NOM='Max', HOME=self.home)
		run, agence.RUN = agence.RUN, FakeRun()
		try:
			with agence.tx() as st:
				st['port'] = 8765
				st['panels'] = {'orchestrator': 'o1', 'regisseur': 'r1'}
			argv = ['draft', 'new', '--cible', cible, '--from', 'a1'] + (['--titre', titre] if titre else []) + [texte]
			with open(os.devnull, 'w') as nul, contextlib.redirect_stdout(nul):
				self.assertEqual(agence.main(argv), 0)
			did = agence.load()['drafts'][-1]['id']
			if clic:
				with open(agence.draft_path(did)) as f:
					shown = {'h': [agence.sha(f.read().strip())]}
				agence.click(f'/draft/{did}/send', shown)
				self.assertEqual(agence.load()['drafts'][-1]['statut'], 'envoyer')
		finally:
			agence.RUN = run
			for k, v in vieux.items():
				if v is None:
					os.environ.pop(k, None)
				else:
					os.environ[k] = v

	def sans_python(self):
		"""PATH où le lanceur ne trouve aucun python3 (uname factice hors macOS, sans python3)."""
		b = os.path.join(self.home, 'bin')
		os.makedirs(b)
		for outil in ('sh', 'cat', 'dirname', 'readlink'):
			os.symlink(shutil.which(outil, path='/usr/bin:/bin'), os.path.join(b, outil))
		with open(os.path.join(b, 'uname'), 'w') as f:
			f.write('#!/bin/sh\necho Linux\n')
		os.chmod(os.path.join(b, 'uname'), 0o755)
		self.env['PATH'] = b

	# ---- exécution ----

	def hook(self, cmd, tool, ti=None, stdin=None):
		payload = stdin if stdin is not None else json.dumps(
			{'hook_event_name': 'PreToolUse', 'tool_name': tool, 'tool_input': ti or {}, 'cwd': self.projet})
		env = dict(self.env, CLAUDE_PROJECT_DIR=self.projet)
		return subprocess.run(['/bin/sh', '-c', cmd], input=payload, env=env, capture_output=True, text=True, timeout=30)

	def decision(self, r):
		"""Décision rendue ; échoue si la sortie est vide ou le code non nul (échec ouvert)."""
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertTrue(r.stdout.strip(), f'sortie vide : échec ouvert ({r.stderr})')
		out = json.loads(r.stdout)['hookSpecificOutput']
		self.assertEqual(out['hookEventName'], 'PreToolUse')
		return out['permissionDecision']

	def envoi(self, **ti):
		return self.hook(self.send_cmd, SLACK, dict({'channel_id': 'C123', 'message': 'Bonjour'}, **ti))


class EnvoiSansCli(Garde):
	def test_current_absent_ask(self):
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_current_vers_un_dossier_sans_agence_hook_ask(self):
		self.installe(hook=False)
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_agence_hook_non_executable_ask(self):
		self.installe(executable=False)
		self.orchestre(clic=True)
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_python3_absent_ask(self):
		self.installe()
		self.orchestre(clic=True)
		self.sans_python()
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_cli_en_echec_ask(self):
		for cli in ('import sys\nsys.exit(3)\n', 'raise RuntimeError("cassé")\n', 'print("pas du json")\n', ''):
			with self.subTest(cli=cli):
				self.installe(cli=cli)
				self.orchestre(clic=True)
				self.assertEqual(self.decision(self.envoi()), 'ask')


class EnvoiAvecCli(Garde):
	def setUp(self):
		super().setUp()
		self.installe()

	def test_brouillon_clique_identique_allow(self):
		self.orchestre(clic=True)
		self.assertEqual(self.decision(self.envoi()), 'allow')

	def test_une_autorisation_par_clic(self):
		self.orchestre(clic=True)
		self.assertEqual(self.decision(self.envoi()), 'allow')
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_mail_clique_identique_allow(self):
		self.orchestre(clic=True, cible='mail:dg@exemple.fr', texte='Corps', titre='Point')
		r = self.hook(self.send_cmd, GMAIL, {'to': ['dg@exemple.fr'], 'subject': 'Point', 'body': 'Corps'})
		self.assertEqual(self.decision(r), 'allow')

	def test_sans_clic_ask(self):
		self.orchestre(clic=False)
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_texte_ou_canal_different_ask(self):
		self.orchestre(clic=True)
		self.assertEqual(self.decision(self.envoi(message='Bonjour !')), 'ask')
		self.assertEqual(self.decision(self.envoi(channel_id='C999')), 'ask')

	def test_projet_non_orchestre_ask(self):
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_aucune_exception_de_canal(self):
		for canal in ('U0000000000', 'D0000000000', 'C123'):
			with self.subTest(canal=canal):
				self.assertEqual(self.decision(self.envoi(channel_id=canal)), 'ask')

	def test_stdin_illisible_ask(self):
		for stdin in ('', 'pas du json', '[]'):
			with self.subTest(stdin=stdin):
				self.assertEqual(self.decision(self.hook(self.send_cmd, SLACK, stdin=stdin)), 'ask')

	def test_suit_le_build_courant(self):
		self.installe(build='b2', cli='raise SystemExit(1)\n')  # nouveau build cassé : ask, pas l'ancien allow
		self.orchestre(clic=True)
		self.assertEqual(self.decision(self.envoi()), 'ask')
		self.installe(build='b3')
		self.assertEqual(self.decision(self.envoi()), 'allow')


class OutilsDEnvoi(Garde):
	"""Chaque outil qui envoie à son nom déclenche le garde d'envoi par son matcher (regex complète, comme Claude Code),
	et seul un brouillon cliqué du même outil, même cible, même texte passe."""

	ENVOIS = (SLACK, 'mcp__claude_ai_Slack__slack_schedule_message', GMAIL,
	          'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward')

	def declenchees(self, tool):
		return [e['hooks'][0]['command'] for e in self.entrees if re.fullmatch(e['matcher'], tool)]

	def test_chaque_outil_d_envoi_declenche_le_garde_d_envoi(self):
		for tool in self.ENVOIS:
			with self.subTest(tool=tool):
				self.assertEqual(self.declenchees(tool), [self.send_cmd])
		for tool in ('mcp__claude_ai_Slack__slack_send_message_draft', 'mcp__claude_ai_Gmail__create_draft', 'Bash'):
			with self.subTest(tool=tool):
				self.assertNotIn(self.send_cmd, self.declenchees(tool))

	def test_ask_meme_avec_un_brouillon_clique_pour_un_autre_outil(self):
		self.installe()
		self.orchestre(clic=True)
		self.orchestre(clic=True, cible='mail:dg@exemple.fr', texte='Corps', titre='Point')
		cas = {'mcp__claude_ai_Slack__slack_schedule_message': {'channel_id': 'C123', 'message': 'Bonjour', 'post_at': 1900000000},
		       'mcp__claude_ai_Gmail__reply': {'messageId': 'm1', 'to': ['dg@exemple.fr'], 'subject': 'Point', 'body': 'Corps'},
		       'mcp__claude_ai_Gmail__forward': {'messageId': 'm1', 'to': ['dg@exemple.fr'], 'subject': 'Point', 'body': 'Corps'}}
		for tool, ti in cas.items():
			with self.subTest(tool=tool):
				for cmd in self.declenchees(tool):
					self.assertEqual(self.decision(self.hook(cmd, tool, ti)), 'ask')
				self.assertTrue(self.declenchees(tool))
		self.assertEqual(self.decision(self.envoi()), 'allow')  # le brouillon Slack cliqué n'a pas été consommé

	def test_ask_sans_cli(self):
		for tool in self.ENVOIS:
			with self.subTest(tool=tool):
				self.assertEqual([self.decision(self.hook(c, tool, {})) for c in self.declenchees(tool)], ['ask'])


class Pages(Garde):
	def vide(self, r):
		self.assertEqual((r.returncode, r.stdout), (0, ''), r.stderr)

	def test_cli_absente_sortie_vide(self):
		self.vide(self.hook(self.pages_cmd, 'Bash', {'command': 'curl http://127.0.0.1:8765/'}))

	def test_python3_absent_sortie_vide(self):
		self.installe()
		self.orchestre()
		self.sans_python()
		self.vide(self.hook(self.pages_cmd, 'Bash', {'command': 'curl http://127.0.0.1:8765/'}))

	def test_sans_state_json_sortie_vide(self):
		self.installe()
		self.vide(self.hook(self.pages_cmd, 'Bash', {'command': 'curl http://127.0.0.1:8765/'}))
		self.assertFalse(os.path.exists(os.path.join(self.projet, '.cate')))

	def test_projet_orchestre_garde_actuel(self):
		self.installe()
		self.orchestre()
		r = self.hook(self.pages_cmd, 'Bash', {'command': 'curl -X POST http://127.0.0.1:8765/draft/d1/send'})
		self.assertEqual(self.decision(r), 'deny')
		state = os.path.join(self.projet, '.cate', 'tmp', 'agence', 'state.json')
		self.assertEqual(self.decision(self.hook(self.pages_cmd, 'Write', {'file_path': state, 'content': '{}'})), 'deny')
		self.vide(self.hook(self.pages_cmd, 'Bash', {'command': 'agence need list'}))


class GuardSansMode(Garde):
	"""`agence guard` sans --mode : comportement d'avant le lot 3 (hooks de Skills branchés dessus jusqu'au lot 5)."""

	def guard(self, tool, ti):
		payload = json.dumps({'tool_name': tool, 'tool_input': ti, 'cwd': self.projet})
		return subprocess.run([sys.executable, AGENCE_PY, 'guard'], input=payload, env=dict(self.env, CLAUDE_PROJECT_DIR=self.projet),
		                      capture_output=True, text=True, timeout=30)

	def test_envoi_sans_clic_rien(self):
		self.orchestre(clic=False)
		r = self.guard(SLACK, {'channel_id': 'C123', 'message': 'Bonjour'})
		self.assertEqual((r.returncode, r.stdout), (0, ''))

	def test_envoi_clique_allow(self):
		self.orchestre(clic=True)
		r = self.guard(SLACK, {'channel_id': 'C123', 'message': 'Bonjour'})
		self.assertEqual(json.loads(r.stdout)['hookSpecificOutput']['permissionDecision'], 'allow')

	def test_stdin_illisible_rien(self):
		r = subprocess.run([sys.executable, AGENCE_PY, 'guard'], input='x', env=self.env, capture_output=True, text=True, timeout=30)
		self.assertEqual((r.returncode, r.stdout), (0, ''))


if __name__ == '__main__':
	unittest.main()
