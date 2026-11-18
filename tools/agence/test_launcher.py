#!/usr/bin/env python3
"""Tests du lanceur POSIX `agence` : il choisit un python3 sans jamais ouvrir
le dialogue d'installation des Command Line Tools, puis exécute exactement le
chemin qu'il a testé. Tout est simulé par un PATH jetable (uname, xcode-select,
python3 factices) et un HOME jetable."""
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER = os.path.join(HERE, 'agence')
BREW_PATHS = ('/opt/homebrew/bin/python3', '/usr/local/bin/python3')


def script(path, body):
	with open(path, 'w') as f:
		f.write('#!/bin/sh\n' + body)
	os.chmod(path, 0o755)


class LauncherTest(unittest.TestCase):
	def setUp(self):
		self.root = tempfile.mkdtemp()
		self.addCleanup(shutil.rmtree, self.root, True)
		self.bin = os.path.join(self.root, 'bin')
		self.brew = os.path.join(self.root, 'brew')
		self.install = os.path.join(self.root, 'install')
		for d in (self.bin, self.brew, self.install):
			os.makedirs(d)
		for tool in ('dirname', 'readlink'):
			os.symlink('/usr/bin/' + tool, os.path.join(self.bin, tool))
		self.log = os.path.join(self.root, 'xcode-select.log')
		# Copie du lanceur avec les chemins Homebrew redirigés vers un dossier jetable.
		with open(LAUNCHER) as f:
			text = f.read()
		for p in BREW_PATHS:
			text = text.replace(p, os.path.join(self.brew, os.path.basename(p) + p.replace('/', '_')))
		self.brew_pythons = [os.path.join(self.brew, os.path.basename(p) + p.replace('/', '_')) for p in BREW_PATHS]
		self.launcher = os.path.join(self.install, 'agence')
		script(self.launcher, text.split('\n', 1)[1])
		script(os.path.join(self.install, 'agence.py'), 'echo "agence.py: $*"\n')

	def uname(self, name):
		script(os.path.join(self.bin, 'uname'), 'echo %s\n' % name)

	def xcode_select(self, exit_code, out=''):
		script(os.path.join(self.bin, 'xcode-select'), 'echo "$*" >> %s\necho %s\nexit %d\n' % (self.log, out, exit_code))

	def fake_python(self, path):
		script(path, 'echo "python: $0 $*"\n')

	def run_launcher(self, *args):
		env = {'PATH': self.bin, 'HOME': os.path.join(self.root, 'home')}
		return subprocess.run(['/bin/sh', self.launcher, *args], env=env, capture_output=True, text=True)

	def test_macos_sans_clt_ni_homebrew_refuse_avec_le_code_2(self):
		self.uname('Darwin')
		self.xcode_select(1)
		r = self.run_launcher('--help')
		self.assertEqual(r.returncode, 2)
		self.assertEqual(r.stderr.strip(), 'agence : python3 requis (xcode-select --install)')
		self.assertEqual(r.stdout, '')
		# Seul `xcode-select -p` est appelé : jamais le shim python3, jamais xcrun.
		with open(self.log) as f:
			self.assertEqual(f.read().split('\n')[:-1], ['-p'])

	def test_macos_avec_clt_execute_le_python_des_clt(self):
		self.uname('Darwin')
		dev = os.path.join(self.root, 'clt')
		os.makedirs(os.path.join(dev, 'usr', 'bin'))
		self.fake_python(os.path.join(dev, 'usr', 'bin', 'python3'))
		self.xcode_select(0, dev)
		r = self.run_launcher('need', 'list')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(r.stdout.strip(), 'python: %s %s need list' % (
			os.path.join(dev, 'usr', 'bin', 'python3'), os.path.join(self.install, 'agence.py')))

	def test_macos_sans_clt_avec_homebrew_execute_le_chemin_teste(self):
		self.uname('Darwin')
		self.xcode_select(1)
		self.fake_python(self.brew_pythons[1])
		r = self.run_launcher('-x')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertTrue(r.stdout.startswith('python: %s ' % self.brew_pythons[1]), r.stdout)

	def test_macos_clt_sans_python_dans_le_dossier_developpeur_refuse(self):
		self.uname('Darwin')
		dev = os.path.join(self.root, 'clt')
		os.makedirs(dev)
		self.xcode_select(0, dev)
		r = self.run_launcher()
		self.assertEqual(r.returncode, 2)

	def test_lance_via_un_lien_symbolique_meme_relatif_et_en_chaine(self):
		self.uname('Linux')
		self.fake_python(os.path.join(self.bin, 'python3'))
		other = os.path.join(self.root, 'other')
		os.makedirs(other)
		first = os.path.join(other, 'first')
		os.symlink(self.launcher, first)
		second = os.path.join(self.root, 'second')
		os.symlink(os.path.relpath(first, self.root), second)  # lien relatif vers un lien
		env = {'PATH': self.bin, 'HOME': os.path.join(self.root, 'home')}
		r = subprocess.run(['/bin/sh', second, 'x'], env=env, capture_output=True, text=True)
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertTrue(r.stdout.strip().endswith(os.path.join(self.install, 'agence.py') + ' x'), r.stdout)

	def test_hors_macos_utilise_python3_du_path(self):
		self.uname('Linux')
		self.fake_python(os.path.join(self.bin, 'python3'))
		r = self.run_launcher('a', 'b')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertTrue(r.stdout.startswith('python: '), r.stdout)
		self.assertTrue(r.stdout.strip().endswith('agence.py a b'), r.stdout)
		self.assertFalse(os.path.exists(self.log))

	def test_hors_macos_sans_python3_refuse_avec_le_code_2(self):
		self.uname('Linux')
		r = self.run_launcher()
		self.assertEqual(r.returncode, 2)
		self.assertIn('python3 requis', r.stderr)


if __name__ == '__main__':
	unittest.main()
