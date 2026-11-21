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
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
import pratiques  # noqa: E402
from test_agence import FakeRun  # noqa: E402
from test_hooks import AGENCE_PY, HERE, FauxHome  # noqa: E402

HOOK = os.path.join(HERE, 'agence-hook')
SLACK = 'mcp__claude_ai_Slack__slack_send_message'
GMAIL = 'mcp__claude_ai_Gmail__send_message'
CATALOGUES = os.path.join(HERE, 'fixtures', 'metiers')
# Fichiers du runtime que la garde lit à côté de agence.py (spec 012 : politique et catalogues).
A_COTE = ('metiers.py', 'pratiques.py', 'metiers.json', 'connecteurs.json', 'declencheurs.json', 'pratiques' + '.json')


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

	def installe(self, build='b1', hook=True, executable=True, cli=None, complet=False):
		"""Install du runtime <build> avec agence/agence-hook (copie du lanceur) et agence.py (copie, ou texte donné) ;
		complet : aussi la politique et les catalogues (A_COTE)."""
		d = os.path.join(self.runtime, build, 'agence')
		os.makedirs(d, exist_ok=True)
		for nom in A_COTE if complet else ():
			shutil.copy(os.path.join(HERE, nom), os.path.join(d, nom))
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

	def orchestre(self, clic=False, cible='mail:dg@exemple.fr', texte='Bonjour', titre=None):
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
		return self.hook(self.send_cmd, GMAIL, dict({'to': ['dg@exemple.fr'], 'body': 'Bonjour'}, **ti))


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
		self.assertEqual(self.decision(self.envoi(body='Bonjour !')), 'ask')
		self.assertEqual(self.decision(self.envoi(to=['autre@exemple.fr'])), 'ask')

	def test_projet_non_orchestre_ask(self):
		self.assertEqual(self.decision(self.envoi()), 'ask')

	def test_slack_toujours_ask_meme_avec_un_brouillon_mail_clique(self):
		self.orchestre(clic=True)
		for canal in ('U0000000000', 'D0000000000', 'C123'):
			with self.subTest(canal=canal):
				self.assertEqual(self.decision(self.hook(self.send_cmd, SLACK, {'channel_id': canal, 'message': 'Bonjour'})), 'ask')

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
		self.assertEqual(self.decision(self.envoi()), 'allow')  # le brouillon mail cliqué n'a pas été consommé

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

	def test_politique_refusee_aux_agents(self):
		"""FR-005 : un agent n'écrit pas pratiques.json et ne lance ni set, ni unset, ni preset ; show, check et brief restent permis."""
		self.installe()
		self.orchestre()
		projet = os.path.join(self.projet, '.cate', 'tmp', 'agence', 'pratiques.json')
		dev = os.path.join(self.home, '.config', 'agence', 'pratiques.json')
		for f in (projet, dev):
			for tool in ('Write', 'Edit', 'MultiEdit'):
				with self.subTest(tool=tool, f=f):
					r = self.hook(self.pages_cmd, tool, {'file_path': f, 'content': '{}'})
					self.assertEqual(self.decision(r), 'deny')
					self.assertIn('pratiques', r.stdout)
		for cmd in ('agence pratiques set tests libre', 'agence pratiques unset tests', 'agence pratiques preset neutre --dev',
		            'cd /tmp && ~/.cate/runtime/b1/agence/agence pratiques set livraison.merge dehors',
		            'python3 tools/agence/agence.py pratiques set issue libre', f'echo {{}} > {projet}'):
			with self.subTest(cmd=cmd):
				self.assertEqual(self.decision(self.hook(self.pages_cmd, 'Bash', {'command': cmd})), 'deny')
		for cmd in ('agence pratiques show', 'agence pratiques show --json', 'agence pratiques check', 'agence pratiques brief',
		            f'cat {projet}'):
			with self.subTest(cmd=cmd):
				self.vide(self.hook(self.pages_cmd, 'Bash', {'command': cmd}))
		self.vide(self.hook(self.pages_cmd, 'Write', {'file_path': os.path.join(self.projet, 'pratiques.json'), 'content': '{}'}))


	def test_backlog_et_registre_refuses_aux_agents(self):
		"""Spec 010, FR-004 : backlog.json et decisions.json s'écrivent seulement par agence fiche et agence decision."""
		self.installe()
		self.orchestre()
		for nom in ('backlog.json', 'decisions.json'):
			f = os.path.join(self.projet, '.cate', 'tmp', 'agence', nom)
			for tool in ('Write', 'Edit', 'MultiEdit'):
				with self.subTest(tool=tool, f=f):
					r = self.hook(self.pages_cmd, tool, {'file_path': f, 'content': '{}'})
					self.assertEqual(self.decision(r), 'deny')
					self.assertIn('agence fiche', r.stdout)
			for cmd in (f'echo {{}} > {f}', f'echo {{}} | tee {f}', f"sed -i '' s/prête/lancée/ {f}"):
				with self.subTest(cmd=cmd):
					self.assertEqual(self.decision(self.hook(self.pages_cmd, 'Bash', {'command': cmd})), 'deny')
			self.vide(self.hook(self.pages_cmd, 'Bash', {'command': f'cat {f}'}))
		for cmd in ('agence fiche list', 'agence fiche add "x" --type idee', 'agence decision list --active'):
			with self.subTest(cmd=cmd):
				self.vide(self.hook(self.pages_cmd, 'Bash', {'command': cmd}))
		self.vide(self.hook(self.pages_cmd, 'Write', {'file_path': os.path.join(self.projet, 'backlog.json'), 'content': '{}'}))

	def test_texte_d_un_rapport_citant_un_fichier_d_etat_passe(self):
		"""Issue 170 : le texte d'un `cate agent send` qui cite un fichier d'état n'est pas une écriture ; une écriture réelle reste refusée."""
		self.installe()
		self.orchestre()
		f = os.path.join(self.projet, '.cate', 'tmp', 'agence', 'state.json')
		for nom in ('state.json', 'backlog.json', 'decisions.json', 'pratiques.json'):
			for cmd in (f'cate agent send --panel abc "agence a lu {nom} puis cp > rm sed -i"',
			            f"cate agent send --panel abc 'le hook bloque {nom} (python, tee, mv)'"):
				with self.subTest(cmd=cmd):
					self.vide(self.hook(self.pages_cmd, 'Bash', {'command': cmd}))
		for cmd in (f'cate agent send --panel abc "ok" && echo {{}} > {f}', f'cate agent send --panel abc "ok"; rm {f}'):
			with self.subTest(cmd=cmd):
				self.assertEqual(self.decision(self.hook(self.pages_cmd, 'Bash', {'command': cmd})), 'deny')

	def test_plafond_agents_refuse_aux_agents(self):
		"""`agence start --max-agents N` écrit la politique du projet : refusé comme `pratiques set`, sous les mêmes préfixes."""
		self.installe()
		self.orchestre()
		for pre in ('agence', 'python3 tools/agence/agence.py', 'cd /tmp && ~/.cate/runtime/b1/agence/agence'):
			for args in ('start --max-agents 16', 'start --max-agents=16', 'start --notify --max-agents 3', 'start --max-agents 16 --notify'):
				with self.subTest(cmd=f'{pre} {args}'):
					self.assertEqual(self.decision(self.hook(self.pages_cmd, 'Bash', {'command': f'{pre} {args}'})), 'deny')
			for args in ('start', 'start --notify'):
				with self.subTest(cmd=f'{pre} {args}'):
					self.vide(self.hook(self.pages_cmd, 'Bash', {'command': f'{pre} {args}'}))


class PlafondAuLancement(Garde):
	"""Spec 013 lot 2 (T020, SC-002) : `cate agent start` refusé quand le dernier compte publié par le régisseur
	atteint agents.max (4 par défaut) ; une place libre ou un autre ordre : aucune décision ; état illisible : aucune
	décision, un avertissement."""

	START = ('cate agent start --title x "Lis le brief"', 'cate --json agent start x', 'cate agent --json start x',
	         'cate agent start \\\n  --title x "y"')

	def setUp(self):
		super().setUp()
		self.installe()
		self.orchestre()

	def vivants(self, active, waiting=0, maxi=4):
		"""Compte et plafond tels que le tour du régisseur les publie."""
		with agence.tx(self.projet) as st:
			st['agentsActive'], st['agentsWaiting'] = active, waiting
			st['pratiques'] = {'valeurs': {'agents.max': maxi}}

	def test_aucun_tour_encore_aucune_decision(self):
		self.assertEqual(self.bash('cate agent start x').stdout, '')

	def bash(self, cmd):
		return self.hook(self.pages_cmd, 'Bash', {'command': cmd})

	def test_plafond_atteint_deny_avec_le_compte(self):
		self.vivants(3, 1)
		for cmd in self.START:
			with self.subTest(cmd=cmd):
				r = self.bash(cmd)
				self.assertEqual(self.decision(r), 'deny')
				raison = json.loads(r.stdout)['hookSpecificOutput']['permissionDecisionReason']
				self.assertIn('4 agents vivants sur 4', raison)
				self.assertIn('dernier compte publié', raison)

	def test_place_libre_aucune_decision(self):
		self.vivants(2, 1)
		for cmd in self.START:
			with self.subTest(cmd=cmd):
				self.assertEqual((self.bash(cmd).stdout), '')

	def test_autres_ordres_cate_jamais_refuses_par_le_plafond(self):
		self.vivants(4)
		for cmd in ('cate agent list', 'cate agent send --panel o1 "x"', 'cate agent usage'):
			with self.subTest(cmd=cmd):
				self.assertEqual(self.bash(cmd).stdout, '')

	def test_etat_illisible_aucune_decision_avertissement(self):
		with open(os.path.join(self.projet, '.cate', 'tmp', 'agence', 'state.json'), 'w') as f:
			f.write('{pas du json')
		r = self.bash('cate agent start x')
		self.assertEqual(r.returncode, 0, r.stderr)
		out = json.loads(r.stdout)
		self.assertNotIn('hookSpecificOutput', out)
		self.assertIn('plafond', out['systemMessage'])
		self.assertEqual(self.bash('agence need list').stdout, '')

	def test_compte_illisible_aucune_decision_avertissement(self):
		self.vivants('beaucoup')
		out = json.loads(self.bash('cate agent start x').stdout)
		self.assertNotIn('hookSpecificOutput', out)
		self.assertIn('plafond', out['systemMessage'])


class Interlocuteur(Garde):
	"""Spec 010, FR-002 (T042) : la garde refuse à l'interlocuteur de lancer du travail. Le panneau appelant est trouvé
	par la sonde (faux `cate` qui rend l'id de MOI au `panel title`), seulement sur une commande de la liste."""

	LANCE = ('cate agent start --title x "Lis le brief"', 'cate panel create terminal', 'cate panel link i1 o1',
	         'cate panel close o1', 'cate terminal send o1 "ls"', 'cate terminal type --panel o1 ls',
	         'cate terminal press enter', 'agence need add --kind task "x"', 'agence ask "Merger ?" --merge o/r#1',
	         'agence draft new --cible mail:a@b.fr "x"', 'python3 tools/agence/agence.py need add "x"',
	         'cate --json agent start x', 'cate agent --json start x', 'cate -h panel create terminal',
	         'agence ask "Merger ?" \\\n  --merge o/r#1', 'agence ask "Merger\nla PR ?" --merge o/r#1',
	         'cate panel unlink i1 o1', 'cate agent interrupt --panel o1', 'cate panel group create x',
	         'cate panel group add g1 o1', 'cate --json panel group list', 'cate agent send --panel o1 "fait"')

	def setUp(self):
		super().setUp()
		self.installe()
		self.orchestre()
		with agence.tx(self.projet) as st:
			st['panels']['interlocuteur'] = 'i1'
		b = os.path.join(self.home, 'fauxbin')
		os.makedirs(b)
		self.journal = os.path.join(self.home, 'cate.log')
		with open(os.path.join(b, 'cate'), 'w') as f:
			f.write('#!/bin/sh\necho "$*" >> "$CATE_JOURNAL"\n[ -n "$CATE_PANNE" ] && exit 1\ncase "$1 $2" in\n'
			        '"panel list") echo \'[{"panelId":"i1","title":"Interlocuteur"},{"panelId":"o1","title":"Orchestrateur"}]\' ;;\n'
			        '"panel title") [ "$3" = --panel ] && echo \'{}\' || echo "{\\"panelId\\":\\"$MOI\\"}" ;;\n'
			        '*) echo \'{}\' ;;\nesac\n')
		os.chmod(os.path.join(b, 'cate'), 0o755)
		self.env.update(PATH=f"{b}:{self.env['PATH']}", CATE_JOURNAL=self.journal, MOI='i1')

	def sondes(self):
		if not os.path.exists(self.journal):
			return 0
		with open(self.journal) as f:
			return sum(1 for l in f if l.startswith('panel title agence-'))

	def bash(self, cmd):
		return self.hook(self.pages_cmd, 'Bash', {'command': cmd})

	def test_interlocuteur_refuse_ce_qui_lance(self):
		for cmd in self.LANCE:
			with self.subTest(cmd=cmd):
				r = self.bash(cmd)
				self.assertEqual(self.decision(r), 'deny')
				self.assertIn("l'interlocuteur ne lance rien", r.stdout)

	def test_orchestrateur_permis(self):
		self.env['MOI'] = 'o1'
		for cmd in self.LANCE:
			with self.subTest(cmd=cmd):
				r = self.bash(cmd)
				self.assertEqual((r.returncode, r.stdout), (0, ''), r.stderr)

	def test_agent_send_passe_pour_un_agent_qui_n_est_pas_l_interlocuteur(self):
		self.env['MOI'] = 'a7'  # un agent de travail : il rend compte à l'orchestrateur
		r = self.bash('cate agent send --panel o1 "fini, 3 fichiers modifiés"')
		self.assertEqual((r.returncode, r.stdout), (0, ''), r.stderr)
		self.assertEqual(self.sondes(), 1)

	def test_aucune_sonde_hors_de_la_liste(self):
		for cmd in ('agence fiche add "x" --type idee', 'git status', 'agence decision list --active',
		            'agence ask "Choix ?" --option "a|b" --option "c|d"', 'cate agent list --json'):
			with self.subTest(cmd=cmd):
				r = self.bash(cmd)
				self.assertEqual((r.returncode, r.stdout), (0, ''), r.stderr)
		self.assertEqual(self.sondes(), 0)

	def test_une_sonde_par_commande_de_la_liste(self):
		self.bash('cate agent start x')
		self.assertEqual(self.sondes(), 1)

	def test_sonde_en_echec_laisse_passer(self):
		self.env['CATE_PANNE'] = '1'
		r = self.bash('cate agent start x')
		self.assertEqual((r.returncode, r.stdout), (0, ''), r.stderr)

	def test_sans_interlocuteur_enregistre_aucune_sonde(self):
		with agence.tx(self.projet) as st:
			del st['panels']['interlocuteur']
		self.assertEqual(self.bash('cate agent start x').stdout, '')
		self.assertEqual(self.sondes(), 0)


class Connecteurs(Garde):
	"""Spec 012, lot 2 (FR-003, SC-001 = SC-005 de 009) : connecteur factice des fixtures, garde lancée par la vraie
	commande `send` de hooks install. Écriture : deny sauf carte cliquée, non utilisée, besoin ouvert, arguments
	identiques après sérialisation canonique ; une carte vaut un appel. Lecture ouverte : aucune décision."""

	ECRIRE, LIRE = 'mcp__factice__ecrire', 'mcp__factice__lire'
	ARGS = {'conteneur': 12, 'version': 'v3'}

	def setUp(self):
		super().setUp()
		self.installe(complet=True)
		env = unittest.mock.patch.dict(os.environ, {
			'AGENCE_ROOT': self.projet, 'CATE_SOCKET': '/tmp/x.sock', 'AGENCE_NOM': 'Max', 'HOME': self.home,
			'AGENCE_CATALOGUES': CATALOGUES})
		env.start()
		self.addCleanup(env.stop)
		self.env['AGENCE_CATALOGUES'] = CATALOGUES
		self.assertEqual(self.agence('hooks', 'install').returncode, 0)  # catalogues de fixture : entrée des serveurs déclarés
		self.entrees = self.lit()['hooks']['PreToolUse']
		self.send_cmd = next(e['hooks'][0]['command'] for e in self.entrees if e['matcher'].startswith('mcp__.*('))
		pratiques.regler_plusieurs(self.projet, self.home, [('metier', 'data-manager'), ('connecteurs.ecriture', ['factice'])])

	def carte(self, clic=True, args=None):
		self.orchestre(clic=clic, cible='outil:factice:ecrire', texte=json.dumps(args or self.ARGS))
		return agence.load()['drafts'][-1]

	def appel(self, tool=None, args=None):
		return self.hook(self.send_cmd, tool or self.ECRIRE, self.ARGS if args is None else args)

	def raison(self, r):
		return json.loads(r.stdout)['hookSpecificOutput']['permissionDecisionReason']

	def sans_decision(self, r):
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(json.loads(r.stdout), {'hookSpecificOutput': {'hookEventName': 'PreToolUse'}})

	def test_sans_carte_deny_qui_cite_la_commande(self):
		self.orchestre()  # un brouillon mail ne vaut pas carte
		r = self.appel()
		self.assertEqual(self.decision(r), 'deny')
		self.assertIn('agence draft new --cible outil:factice:ecrire', self.raison(r))

	def test_carte_non_cliquee_deny(self):
		self.carte(clic=False)
		self.assertEqual(self.decision(self.appel()), 'deny')

	def test_carte_cliquee_identique_un_seul_appel(self):
		self.carte()
		self.assertEqual(self.decision(self.appel()), 'allow')
		self.assertTrue(agence.load()['drafts'][-1]['allowed'])
		self.assertEqual(self.decision(self.appel()), 'deny')

	def test_deux_cartes_identiques_deux_appels(self):
		self.carte()
		self.carte()
		self.assertEqual([self.decision(self.appel()) for _ in range(3)], ['allow', 'allow', 'deny'])

	def test_un_caractere_de_difference_deny(self):
		self.carte()
		self.assertEqual(self.decision(self.appel(args={'conteneur': 12, 'version': 'v4'})), 'deny')
		self.assertEqual(self.decision(self.appel(args={'conteneur': '12', 'version': 'v3'})), 'deny')

	def test_ordre_des_cles_different_allow(self):
		self.carte()
		self.assertEqual(self.decision(self.appel(args={'version': 'v3', 'conteneur': 12})), 'allow')

	def test_besoin_ferme_deny(self):
		d = self.carte()
		with agence.tx() as st:
			agence.close_need(st, d['needId'], 'dropped', 'fermé')
		self.assertEqual(self.decision(self.appel()), 'deny')

	def test_ecriture_fermee_entre_le_clic_et_l_appel_deny(self):
		self.carte()
		pratiques.regler(self.projet, self.home, 'connecteurs.ecriture', [])
		self.assertEqual(self.decision(self.appel()), 'deny')

	def test_outil_non_declare_deny_meme_avec_une_carte(self):
		self.carte()
		self.assertEqual(self.decision(self.appel(tool='mcp__factice__autre')), 'deny')

	def test_lecture_ouverte_aucune_decision(self):
		self.orchestre()
		self.sans_decision(self.appel(tool=self.LIRE, args={}))

	def test_lecture_fermee_deny(self):
		self.orchestre()
		pratiques.regler(self.projet, self.home, 'connecteurs.lecture', ['balises-factice'])
		self.assertEqual(self.decision(self.appel(tool=self.LIRE, args={})), 'deny')

	def test_serveur_non_declare_aucune_decision(self):
		self.orchestre()
		self.sans_decision(self.appel(tool='mcp__inconnu__ecrire', args={}))

	def test_hors_projet_orchestre_lecture_libre_ecriture_refusee(self):
		self.sans_decision(self.appel(tool=self.LIRE, args={}))
		self.assertEqual(self.decision(self.appel()), 'deny')

	def test_matcher_des_serveurs_declares(self):
		for tool in (self.ECRIRE, self.LIRE, 'mcp__tableur-factice__ecrire_valeurs'):
			self.assertTrue(re.fullmatch(next(e['matcher'] for e in self.entrees if e['matcher'].startswith('mcp__(')), tool))

	# ---- T024 : scénarios de 009 sur fixtures ----

	def test_publication_du_data_manager_refusee_sans_carte(self):
		self.orchestre()
		r = self.appel(args={'conteneur': 12, 'action': 'publier'})
		self.assertEqual(self.decision(r), 'deny')
		self.assertTrue(os.path.isfile(os.path.join(self.projet, '.cate', 'tmp', 'agence', 'state.json')))

	def test_mail_du_chef_de_projet_inchange(self):
		pratiques.regler_plusieurs(self.projet, self.home, [('metier', 'chef-de-projet'), ('connecteurs.ecriture', [])])
		self.orchestre()
		envoi = next(e['hooks'][0]['command'] for e in self.entrees if 'Gmail' in e['matcher'])
		self.assertEqual(self.decision(self.hook(envoi, GMAIL, {'to': ['dg@exemple.fr'], 'body': 'Autre'})), 'ask')


class ModeObligatoire(Garde):
	"""`agence guard` sans --mode : refusé par argparse (code 2), aucune décision sur stdout, même pour un envoi cliqué.
	Les entrées de `agence hooks install` passent toujours send ou pages (agence-hook)."""

	def test_sans_mode_refuse(self):
		self.orchestre(clic=True)
		envoi = json.dumps({'tool_name': GMAIL, 'tool_input': {'to': ['dg@exemple.fr'], 'body': 'Bonjour'}, 'cwd': self.projet})
		for stdin in (envoi, ''):
			with self.subTest(stdin=stdin[:12]):
				r = subprocess.run([sys.executable, AGENCE_PY, 'guard'], input=stdin, env=dict(self.env, CLAUDE_PROJECT_DIR=self.projet),
				                   capture_output=True, text=True, timeout=30)
				self.assertEqual((r.returncode, r.stdout), (2, ''), r.stderr)
				self.assertIn('--mode', r.stderr)


if __name__ == '__main__':
	unittest.main()
