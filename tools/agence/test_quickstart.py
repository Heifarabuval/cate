#!/usr/bin/env python3
"""Parcours d'amorçage en faux HOME (spec 002, lot 5-A, X001, T047).

Rejoue `scripts/cate-fork-install.sh` puis `cate-fork-uninstall.sh` avec la VRAIE CLI `tools/agence/agence`
(lanceur POSIX et agence.py), dans un HOME jetable. Seuls les outils du système sont simulés (git, gh, claude,
cate, launchctl, node, npm, xcode-select...) : un PATH qui ne contient que ces faux et des liens vers les
utilitaires de base, donc aucun appel réel, aucun réseau, aucun launchd, ni Cate ni Electron. Le « clone » vient
d'un dossier local. Le vrai ~/.claude/settings.json et ~/Library/LaunchAgents sont seulement lus (empreinte avant
et après la suite) : la suite échoue s'ils ont bougé, ou si un test voit le vrai HOME. Python 3.9, stdlib.
"""
import glob
import hashlib
import json
import os
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SCRIPTS = os.path.join(REPO, 'scripts')
FIXTURES = os.path.join(HERE, 'fixtures', 'settings')
VRAI_HOME = pwd.getpwuid(os.getuid()).pw_dir
VRAI_SETTINGS = os.path.join(VRAI_HOME, '.claude', 'settings.json')
VRAI_AGENTS = os.path.join(VRAI_HOME, 'Library', 'LaunchAgents')
BASE = 'sh awk sed grep cat date mkdir rmdir rm mv cp ls dirname basename head tail cut wc id chmod touch mktemp find cmp ps uname df readlink tr stat'.split()
SHA = 'a' * 40
LABEL = 'com.cate.fork-update'


def empreinte(path):
	try:
		with open(path, 'rb') as f:
			return hashlib.sha256(f.read()).hexdigest()
	except FileNotFoundError:
		return None


def agents():
	try:
		return sorted(os.listdir(VRAI_AGENTS))
	except FileNotFoundError:
		return None


AVANT = (empreinte(VRAI_SETTINGS), agents())


def tearDownModule():
	assert (empreinte(VRAI_SETTINGS), agents()) == AVANT, 'le vrai ~/.claude/settings.json ou ~/Library/LaunchAgents a changé pendant la suite'


def refuse_vrai_home(home):
	"""Un HOME qui est le vrai, ou qui contient le vrai ~/.claude, arrête le test avant toute écriture."""
	h, vrai = os.path.realpath(home), os.path.realpath(VRAI_HOME)
	if h == vrai or h.startswith(vrai + os.sep) or os.path.realpath(os.environ.get('HOME', '/nonexistent')) == h:
		raise AssertionError(f'faux HOME attendu, reçu le vrai : {home}')


def ecrit(path, texte, mode=None):
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, 'w') as f:
		f.write(texte)
	if mode:
		os.chmod(path, mode)


def lit_json(path):
	with open(path) as f:
		return json.load(f)


FAUX_GIT = r'''
echo "git $*" >> "$CALLS"
if [ "$1" = -C ]; then dir=$2; shift 2; else dir=.; fi
case $1 in
	clone) # clone -q <dépôt local> <dossier> : copie du dossier, jamais le réseau
		shift; [ "$1" = -q ] && shift
		cp -R "$1" "$2" && mkdir -p "$2/.git" && printf '%s\n' "$1" > "$2/.git/origin" ;;
	config) [ "$2 $3" = '--get remote.origin.url' ] && [ -f "$dir/.git/origin" ] && cat "$dir/.git/origin" ;;
	ls-remote) [ -d "$3" ] ;;
	fetch | checkout | clean) exit 0 ;;
	rev-parse) [ "$2" = 'FETCH_HEAD^{commit}' ] && echo ''' + SHA + r''' ;;
	show) case $2 in *:package.json) printf '{\n  "engines": {\n    "node": ">=22.16 <23"\n  }\n}\n' ;; *) exit 1 ;; esac ;;
	*) exit 1 ;;
esac
'''


class Amorcage(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		if sys.platform != 'darwin':
			raise unittest.SkipTest('les scripts d\'amorçage sont macOS seulement')

	def setUp(self):
		self.root = os.path.realpath(tempfile.mkdtemp(prefix='agence-quickstart-'))
		self.addCleanup(shutil.rmtree, self.root, True)
		self.home = os.path.join(self.root, 'home')
		os.makedirs(self.home)
		refuse_vrai_home(self.home)
		self.fakes, self.calls = os.path.join(self.root, 'fakes'), os.path.join(self.root, 'calls.log')
		self.settings = os.path.join(self.home, '.claude', 'settings.json')
		self.build = os.path.join(self.home, '.local', 'share', 'cate-build')
		self.agence = os.path.join(self.build, 'tools', 'agence', 'agence')
		self.faux_systeme()
		self.upstream = os.path.join(self.root, 'upstream')  # le « dépôt distant » : un dossier local
		shutil.copytree(HERE, os.path.join(self.upstream, 'tools', 'agence'),
		                ignore=shutil.ignore_patterns('__pycache__', 'test_*.py', 'fixtures'))
		ecrit(os.path.join(self.upstream, 'package.json'), '{\n  "engines": {\n    "node": ">=22.16 <23"\n  }\n}\n')
		os.makedirs(os.path.join(self.home, 'Applications'))  # /Applications du faux HOME
		os.makedirs(os.path.dirname(self.settings))
		shutil.copy(os.path.join(FIXTURES, 'hooks-existants.json'), self.settings)
		self.original = self.octets()

	def faux(self, nom, corps):
		ecrit(os.path.join(self.fakes, nom), '#!/bin/sh\necho "%s $*" >> "$CALLS"\n%s\n' % (nom, corps), 0o755)

	def faux_systeme(self):
		os.makedirs(self.fakes)
		ecrit(os.path.join(self.fakes, 'git'), '#!/bin/sh\n' + FAUX_GIT, 0o755)
		for nom, corps in (('gh', 'exit 0'), ('claude', 'echo 2.0.0'), ('cate', 'exit 1'), ('launchctl', 'exit 0'), ('osascript', 'exit 0'),
		                   ('pgrep', 'exit 1'), ('codesign', 'exit 0'), ('xattr', 'exit 0'), ('ditto', 'cp -R "$1" "$2"'),
		                   ('npm', 'exit 0'),
		                   # Python des « outils développeur » : le lanceur le cherche par xcode-select -p, jamais le shim d'Apple.
		                   ('xcode-select', 'echo "%s"' % os.path.join(self.root, 'clt'))):
			self.faux(nom, corps)
		self.faux('node', 'if [ "$1" = -v ]; then echo v22.22.2; exit 0; fi\n'
		          'if [ "$1" = scripts/package.mjs ]; then mkdir -p release/mac-arm64/Cate.app/Contents; echo new > release/mac-arm64/Cate.app/Contents/id; fi')
		ecrit(os.path.join(self.root, 'clt', 'usr', 'bin', 'python3'), '#!/bin/sh\nexec "%s" "$@"\n' % sys.executable, 0o755)
		for nom in BASE:
			if not os.path.exists(os.path.join(self.fakes, nom)):
				os.symlink(shutil.which(nom), os.path.join(self.fakes, nom))

	def env(self):
		return {'HOME': self.home, 'PATH': self.fakes, 'LANG': 'C.UTF-8', 'CALLS': self.calls, 'PYTHONDONTWRITEBYTECODE': '1',
		        'CATE_FORK_REPO': self.upstream, 'CATE_APPS_DIR': os.path.join(self.home, 'Applications'),
		        'CATE_BREW_PREFIXES': os.path.join(self.root, 'brew')}

	def lance(self, cmd, *args):
		refuse_vrai_home(self.home)
		return subprocess.run(['/bin/sh', cmd, *args], env=self.env(), cwd=self.home, capture_output=True, text=True, timeout=120)

	def installe(self, *args, scripts=SCRIPTS):
		return self.lance(os.path.join(scripts, 'cate-fork-install.sh'), *args)

	def desinstalle(self, *args):
		return self.lance(os.path.join(SCRIPTS, 'cate-fork-uninstall.sh'), *args)

	def octets(self):
		with open(self.settings, 'rb') as f:
			return f.read()

	def sauvegardes(self):
		return sorted(glob.glob(self.settings + '.bak-agence-*'))

	def appels(self, outil):
		with open(self.calls) as f:
			return [l.split(' ', 1)[1].strip() for l in f if l.startswith(outil + ' ')]

	def statut(self):
		return subprocess.run(['/bin/sh', self.agence, 'hooks', 'status'], env=self.env(), cwd=self.home, capture_output=True, text=True, timeout=30)

	def verifie_gardes_branches(self, r):
		"""Cas 1 : ce que la ligne d'amorçage doit laisser après un premier passage."""
		self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
		s = self.statut()  # la vraie CLI du clone, pas un faux
		self.assertEqual((s.returncode, s.stdout.split(' ')[0]), (0, 'actif'), s.stdout + s.stderr)
		avant, apres = json.loads(self.original), lit_json(self.settings)
		pre_avant, pre_apres = avant['hooks']['PreToolUse'], apres['hooks']['PreToolUse']
		self.assertEqual(pre_apres[:len(pre_avant)], pre_avant)  # entrées d'origine intactes, dans l'ordre
		self.assertEqual(len(pre_apres) - len(pre_avant), 2)  # les deux gardes du contrat
		self.assertEqual({k: v for k, v in apres.items() if k != 'hooks'}, {k: v for k, v in avant.items() if k != 'hooks'})
		self.assertEqual({k: v for k, v in apres['hooks'].items() if k != 'PreToolUse'},
		                 {k: v for k, v in avant['hooks'].items() if k != 'PreToolUse'})
		sauvegardes = self.sauvegardes()
		self.assertEqual(len(sauvegardes), 1, sauvegardes)
		with open(sauvegardes[0], 'rb') as f:
			self.assertEqual(f.read(), self.original)
		self.assertLessEqual(len([l for l in r.stdout.splitlines() if l.startswith('Reste : ')]), 3)

	# --- cas 1 : premier passage ---
	def test_premier_passage_branche_les_gardes_et_garde_l_existant(self):
		r = self.installe()
		self.verifie_gardes_branches(r)
		self.assertEqual([l for l in r.stdout.splitlines() if l.startswith('Reste : ')], [])  # faux gh et claude : rien à faire à la main
		# Le journal du faux launchctl : l'agent du faux HOME seulement, jamais un appel hors de lui.
		lc = self.appels('launchctl')
		self.assertEqual(len(lc), 2, lc)
		self.assertTrue(lc[0].startswith('bootout ') and lc[0].endswith(LABEL), lc)
		self.assertTrue(lc[1].startswith('bootstrap ') and lc[1].endswith(os.path.join(self.home, 'Library/LaunchAgents', LABEL + '.plist')), lc)
		self.assertEqual(self.appels('cate'), [])  # l'amorçage ne lance jamais Cate

	# --- cas 2 : deuxième passage ---
	def test_deuxieme_passage_ne_change_rien(self):
		self.installe()
		premier = self.octets()
		r = self.installe()
		self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
		self.assertEqual(self.octets(), premier)
		self.assertEqual(len(self.sauvegardes()), 1)
		self.assertEqual(self.statut().stdout.split(' ')[0], 'actif')

	# --- cas 3 : --sans-gardes ---
	def test_sans_gardes_laisse_settings_octet_pour_octet(self):
		r = self.installe('--sans-gardes')
		self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
		self.assertEqual(self.octets(), self.original)
		self.assertEqual(self.sauvegardes(), [])
		self.assertEqual(self.statut().stdout.split(' ')[0], 'inactif')

	# --- cas 4 : désinstallation ---
	def test_desinstallation_gardes_purge_rend_le_json_d_origine(self):
		self.verifie_gardes_branches(self.installe())
		r = self.desinstalle('--gardes', '--purge')
		self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
		self.assertEqual(lit_json(self.settings), json.loads(self.original))  # hors ordre des clés et mise en forme (SC-003)
		self.assertFalse(os.path.exists(self.build))
		self.assertFalse(os.path.exists(os.path.join(self.home, 'Library/LaunchAgents', LABEL + '.plist')))

	# --- cas 5 : le test refuse le vrai HOME ---
	def test_refuse_le_vrai_home(self):
		for h in (VRAI_HOME, os.path.join(VRAI_HOME, 'Documents')):
			with self.assertRaises(AssertionError):
				refuse_vrai_home(h)
		refuse_vrai_home(self.home)

	# --- cas 6 : rouge d'abord ---
	def test_rouge_sans_hooks_install(self):
		"""Une copie jetable du script sans l'appel `hooks install` : les mêmes vérifications échouent."""
		copie = os.path.join(self.root, 'scripts-sans-gardes')
		shutil.copytree(SCRIPTS, copie, ignore=shutil.ignore_patterns('*.mjs', '*.md', '*.cjs', '*.js', '*.d.mts'))
		chemin = os.path.join(copie, 'cate-fork-install.sh')
		with open(chemin) as f:
			texte = f.read()
		texte, n = re.subn(r'^\s*"\$AGENCE" hooks install.*$', '\t\t\t:', texte, flags=re.M)
		self.assertEqual(n, 1, "l'appel `hooks install` n'est plus où le test l'attend : mettre à jour la copie")
		with open(chemin, 'w') as f:
			f.write(texte)
		r = self.installe(scripts=copie)
		self.assertEqual(r.returncode, 0, r.stdout + r.stderr)  # l'amorçage « réussit » sans les gardes...
		with self.assertRaises(AssertionError) as e:
			self.verifie_gardes_branches(r)  # ...et c'est le test qui le voit
		self.assertIn('inactif', str(e.exception))


if __name__ == '__main__':
	unittest.main()
