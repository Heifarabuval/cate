"""Tests de benchmark.py : harnais du benchmark par rejeu d'issues fermées (spec 011, lot 2).

Lancer : python3 -m unittest tools/agence/test_benchmark.py
Tout tourne en faux HOME et en dossier temporaire : faux `gh` (fixtures/bench/bin), faux `open`,
`osascript`, `electron`, `npx`, `playwright`, `npm`, `claude` qui laissent un témoin s'ils sont
appelés ; `git` est le vrai, sur un dépôt créé dans le dossier temporaire. Rien ne touche le réseau.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'benchmark.py')
FIXTURE = os.path.join(HERE, 'fixtures', 'bench')
INTERDITS = ('open', 'osascript', 'electron', 'npx', 'playwright', 'npm', 'claude')
TEMOIN_SH = '#!/bin/sh\necho "$0 $*" >> "$TEMOIN"\nexit 1\n'
VITEST_SH = '#!/bin/sh\necho "$@" >> "$VITEST_ARGS"\nexit 0\n'


def ecrire(path, contenu, mode=None):
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, 'w') as f:
		f.write(contenu)
	if mode:
		os.chmod(path, mode)


def encoder(path):
	return re.sub(r'[^A-Za-z0-9]', '-', path)


class Banc(unittest.TestCase):
	def setUp(self):
		self.tmp = os.path.realpath(tempfile.mkdtemp())
		self.addCleanup(shutil.rmtree, self.tmp)
		self.home = os.path.join(self.tmp, 'home')
		self.racine = os.path.join(self.tmp, 'bench')
		self.specs = os.path.join(self.tmp, 'specs')
		self.gh = os.path.join(self.tmp, 'gh')
		self.temoin = os.path.join(self.tmp, 'temoin')
		bin_ = os.path.join(self.tmp, 'bin')
		for nom in INTERDITS:
			ecrire(os.path.join(bin_, nom), TEMOIN_SH, 0o755)
		os.makedirs(self.home)
		shutil.copytree(os.path.join(FIXTURE, 'gh'), self.gh)
		self.depot = self.tmp  # remplacé par un vrai dépôt dans les tests qui en ont besoin
		self.env = {
			'HOME': self.home, 'PATH': os.pathsep.join([bin_, os.path.join(FIXTURE, 'bin'), '/usr/bin', '/bin']),
			'FAUX_GH': self.gh, 'TEMOIN': self.temoin, 'VITEST_ARGS': os.path.join(self.tmp, 'vitest-args'),
			'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t',
			'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'
		}

	def tearDown(self):
		self.assertFalse(os.path.exists(self.temoin), 'exécutable interdit appelé')

	def run_(self, *args):
		return subprocess.run(
			[sys.executable, '-I', SCRIPT, '--racine', self.racine, '--specs', self.specs, '--depot', self.depot, *args],
			capture_output=True, text=True, env=self.env, cwd=self.tmp, timeout=60
		)

	def git(self, cwd, *args):
		return subprocess.run(['git', *args], cwd=cwd, env=self.env, capture_output=True, text=True, check=True).stdout.strip()

	def selection(self):
		with open(os.path.join(self.specs, 'selection.json')) as f:
			return json.load(f)

	def prs(self):
		with open(os.path.join(self.gh, 'prs.json')) as f:
			return json.load(f)

	def ecrire_prs(self, prs):
		ecrire(os.path.join(self.gh, 'prs.json'), json.dumps(prs))


class Tirage(Banc):
	"""T010 : vivier et tirage (FR-002)."""

	def test_vivier_et_tirage_reproductible(self):
		r = self.run_('select', '--graine', '7')
		self.assertEqual(r.returncode, 0, r.stderr)
		with open(os.path.join(self.specs, 'selection.json'), 'rb') as f:
			premier = f.read()
		s = self.selection()
		self.assertEqual(len(s['vivier']), 19)
		inel = {103, 107, 111, 115, 119, 123}
		self.assertFalse(inel & {v['pr'] for v in s['vivier']})
		self.assertEqual([len(s[k]) for k in ('pilotes', 'campagne', 'reserve')], [2, 10, 5])
		tires = [t['issue'] for k in ('pilotes', 'campagne', 'reserve') for t in s[k]] + [s['comparaison']['issue']]
		self.assertEqual(len(set(tires)), 18)
		self.assertTrue(set(tires) <= {v['issue'] for v in s['vivier']})
		self.assertTrue(all(t['premier'] in ('nu', 'outil') for k in ('pilotes', 'campagne', 'reserve') for t in s[k]))
		self.assertEqual(s['graine'], 7)
		r = self.run_('select', '--graine', '7')
		self.assertEqual(r.returncode, 0, r.stderr)
		with open(os.path.join(self.specs, 'selection.json'), 'rb') as f:
			self.assertEqual(f.read(), premier)

	def test_comparaison_est_la_plus_courte_hors_selection(self):
		self.run_('select', '--graine', '7')
		s = self.selection()
		tires = {t['issue'] for k in ('pilotes', 'campagne', 'reserve') for t in s[k]}
		restants = [v for v in s['vivier'] if v['issue'] not in tires]
		taille = {p['number']: sum(f['additions'] + f['deletions'] for f in p['files']) for p in self.prs()}
		attendu = min(restants, key=lambda v: (taille[v['pr']], v['issue']))['issue']
		self.assertEqual(s['comparaison']['issue'], attendu)

	def test_vivier_insuffisant_refuse(self):
		prs = self.prs()
		eligibles = [p for p in prs if p['number'] in (101, 102)]
		self.ecrire_prs([p for p in prs if p not in eligibles])
		r = self.run_('select', '--graine', '7')
		self.assertEqual(r.returncode, 2)
		self.assertIn('manque 1', r.stderr)
		self.assertFalse(os.path.exists(os.path.join(self.specs, 'selection.json')))

	def test_aucun_chemin_dans_la_selection(self):
		self.run_('select', '--graine', '7')
		with open(os.path.join(self.specs, 'selection.json')) as f:
			self.assertNotIn(self.tmp, f.read())


class Rejeu(Banc):
	"""T011 à T013 et T015 : clone, dépendances, arbitre, gardes, sur un vrai dépôt git jetable."""

	def setUp(self):
		super().setUp()
		d = self.depot = os.path.join(self.tmp, 'depot')
		os.makedirs(d)
		self.git(d, 'init', '-q')
		ecrire(os.path.join(d, 'README.md'), 'a\n')
		ecrire(os.path.join(d, '.gitignore'), 'node_modules/\n__pycache__/\n')
		self.git(d, 'add', '.')
		self.git(d, 'commit', '-qm', 'c1')
		ecrire(os.path.join(d, 'README.md'), 'b\n')
		self.git(d, 'commit', '-qam', 'c2')
		ecrire(os.path.join(d, 'lib.py'), 'def f():\n\treturn 0\n')
		ecrire(os.path.join(d, 'package-lock.json'), '{"v": 1}\n')
		self.git(d, 'add', '.')
		self.git(d, 'commit', '-qm', 'c3')
		self.base = self.git(d, 'rev-parse', 'HEAD')
		self.git(d, 'checkout', '-qb', 'pr')
		ecrire(os.path.join(d, 'lib.py'), 'def f():\n\treturn 1\n')
		ecrire(os.path.join(d, 'test_lib.py'), (
			'import unittest\nimport lib\n\n\nclass T(unittest.TestCase):\n'
			'\tdef test_f(self):\n\t\tself.assertEqual(lib.f(), 1, "SOLUTION_SECRETE")\n'
		))
		ecrire(os.path.join(d, 'a.test.ts'), '// SOLUTION_SECRETE\n')
		self.git(d, 'add', '.')
		self.git(d, 'commit', '-qm', 'c4')
		self.head = self.git(d, 'rev-parse', 'HEAD')
		self.git(d, 'checkout', '-q', '-')
		ecrire(os.path.join(d, 'README.md'), 'c\n')
		self.git(d, 'commit', '-qam', 'c5')
		ecrire(os.path.join(d, 'node_modules', 'temoin.txt'), 'x\n')
		ecrire(os.path.join(d, 'node_modules', '.bin', 'vitest'), VITEST_SH, 0o755)
		files = [{'path': p, 'additions': 1, 'deletions': 0} for p in ('lib.py', 'test_lib.py', 'a.test.ts')]
		self.ecrire_prs(self.prs() + [{
			'number': 150, 'closingIssuesReferences': [{'number': 50}], 'files': files,
			'baseRefOid': self.base, 'headRefOid': self.head
		}])
		ecrire(os.path.join(self.gh, 'issue-50.json'), json.dumps({
			'title': 'Rendre f juste', 'body': 'f doit rendre 1.', 'comments': [{'body': 'COMMENTAIRE_INTERDIT'}]
		}))
		r = self.run_('select', '--graine', '7')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.clone = os.path.join(self.racine, '50-nu')

	def appliquer_correctif(self):
		ecrire(os.path.join(self.clone, 'lib.py'), self.git(self.depot, 'show', self.head + ':lib.py') + '\n')

	def test_clone_sans_remote_ni_solution(self):
		r = self.run_('prepare', '50', 'nu')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(self.git(self.clone, 'remote'), '')
		self.assertEqual(self.git(self.clone, 'log', '--all', '--format=%H').split(), [self.base])
		self.assertEqual(self.git(self.clone, 'rev-parse', 'HEAD'), self.base)
		with self.assertRaises(subprocess.CalledProcessError):
			self.git(self.clone, 'cat-file', '-e', self.head)
		with open(os.path.join(self.racine, '50-nu.md')) as f:
			enonce = f.read()
		self.assertIn('Rendre f juste', enonce)
		self.assertIn('f doit rendre 1.', enonce)
		self.assertNotIn('COMMENTAIRE_INTERDIT', enonce)
		self.assertFalse(any(n.endswith('.md') and n != 'README.md' for n in os.listdir(self.clone)))

	def test_second_prepare_pendant_un_rejeu_ouvert_refuse(self):
		self.assertEqual(self.run_('prepare', '50', 'nu').returncode, 0)
		self.assertEqual(self.run_('debut', '50', 'nu').returncode, 0)
		r = self.run_('prepare', '50', 'outil')
		self.assertEqual(r.returncode, 2)
		self.assertIn('ouvert', r.stderr)
		self.assertFalse(os.path.exists(os.path.join(self.racine, '50-outil')))

	def test_dependances_clonees_si_lockfile_identique(self):
		r = self.run_('prepare', '50', 'nu')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertTrue(os.path.isfile(os.path.join(self.clone, 'node_modules', 'temoin.txt')))

	def test_dependances_a_installer_si_lockfile_different(self):
		ecrire(os.path.join(self.depot, 'package-lock.json'), '{"v": 2}\n')
		r = self.run_('prepare', '50', 'nu')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertIn('dépendances à installer', r.stdout)
		self.assertFalse(os.path.exists(os.path.join(self.clone, 'node_modules')))

	def test_arbitre_vert_avec_correctif_rouge_sans(self):
		self.run_('prepare', '50', 'nu')
		self.run_('debut', '50', 'nu')
		r = self.run_('fini', '50', 'nu')
		self.assertEqual(r.returncode, 1)
		self.assertIn('rouge', r.stdout)
		self.assertNotIn('SOLUTION_SECRETE', r.stdout + r.stderr)
		self.assertFalse(os.path.exists(os.path.join(self.clone, 'test_lib.py')), 'test de la PR laissé dans le clone')
		self.assertFalse(os.path.exists(os.path.join(self.clone, 'a.test.ts')))
		self.appliquer_correctif()
		r = self.run_('fini', '50', 'nu')
		self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
		self.assertIn('vert', r.stdout)
		self.assertNotIn('SOLUTION_SECRETE', r.stdout + r.stderr)
		with open(self.env['VITEST_ARGS']) as f:
			self.assertEqual(f.read().split('\n')[0], 'run a.test.ts')
		with open(os.path.join(self.racine, '50-nu.json')) as f:
			etat = json.load(f)
		self.assertRegex(etat['debut'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')
		self.assertEqual([x['arbitre'] for x in etat['finis']], ['rouge', 'vert'])
		self.assertTrue(all(re.match(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$', x['instant']) for x in etat['finis']))
		self.assertFalse(os.path.exists(os.path.join(self.racine, 'ouvert.json')))

	def test_arbitre_non_lancable_sans_vitest(self):
		self.run_('prepare', '50', 'nu')
		os.remove(os.path.join(self.clone, 'node_modules', '.bin', 'vitest'))
		self.run_('debut', '50', 'nu')
		self.appliquer_correctif()
		r = self.run_('fini', '50', 'nu')
		self.assertEqual(r.returncode, 1)
		self.assertIn('non lançable', r.stdout)

	def test_quatrieme_fini_rouge_donne_echec(self):
		self.run_('prepare', '50', 'nu')
		self.run_('debut', '50', 'nu')
		sorties = [self.run_('fini', '50', 'nu').stdout for _ in range(4)]
		self.assertTrue(all('rouge' in s for s in sorties[:3]), sorties)
		self.assertIn('échec', sorties[3])
		self.assertFalse(os.path.exists(os.path.join(self.racine, 'ouvert.json')))
		self.assertEqual(self.run_('fini', '50', 'nu').returncode, 2)

	def test_fini_sans_debut_refuse(self):
		self.run_('prepare', '50', 'nu')
		self.assertEqual(self.run_('fini', '50', 'nu').returncode, 2)

	def test_gardes_aucun_executable_interdit(self):
		"""T015 : tout le parcours du lot, tearDown vérifie qu'aucun témoin n'est écrit."""
		for args in (('prepare', '50', 'nu'), ('debut', '50', 'nu'), ('fini', '50', 'nu'), ('controle', '50', 'nu')):
			r = self.run_(*args)
			self.assertIn(r.returncode, (0, 1), r.stderr)


class Contamination(Banc):
	"""T014 : un appel d'outil qui cite le dépôt d'origine, la PR ou son sha invalide le rejeu (FR-008)."""

	def setUp(self):
		super().setUp()
		self.run_('select', '--graine', '7')
		self.v = next(v for v in self.selection()['vivier'] if v['issue'] == 2)
		self.projets = os.path.join(self.home, '.claude', 'projects')

	def journal(self, commande, dossier=''):
		lignes = [
			{'type': 'user', 'timestamp': '2026-11-20T10:00:00Z', 'message': {'role': 'user', 'content': 'exemple/depot pull 102'}},
			{'type': 'assistant', 'timestamp': '2026-11-20T10:00:05Z', 'message': {
				'id': 'm1', 'role': 'assistant', 'content': [{'type': 'tool_use', 'id': 't1', 'name': 'Bash', 'input': {'command': commande}}]
			}}
		]
		d = os.path.join(self.projets, encoder(os.path.join(self.racine, '2-outil')) + dossier)
		ecrire(os.path.join(d, 's1.jsonl'), ''.join(json.dumps(x) + '\n' for x in lignes))

	def controle(self):
		return self.run_('controle', '2', 'outil')

	def test_appels_fautifs_invalident(self):
		for cmd in ('gh repo view exemple/depot', 'curl https://github.com/x/y/pull/102',
				'gh pr view 102', 'git show %s' % self.v['head'][:7], 'git show %s' % self.v['head']):
			with self.subTest(cmd=cmd):
				shutil.rmtree(self.projets, ignore_errors=True)
				self.journal(cmd)
				r = self.controle()
				self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
				self.assertIn('invalide', r.stdout)
				self.assertIn('1 appel', r.stdout)
				self.assertNotIn(cmd, r.stdout + r.stderr)

	def test_worktree_du_clone_lu(self):
		self.journal('gh pr view 102', '--cate-worktrees-a')
		self.assertEqual(self.controle().returncode, 1)

	def test_journal_propre_valide(self):
		self.journal('git log --oneline && echo 102 && ls')
		r = self.controle()
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertIn('valide', r.stdout)
		self.assertNotIn('invalide', r.stdout)

	def test_dossier_voisin_ignore(self):
		self.journal('gh pr view 102', 'x')  # `2-outilx` : un autre clone, pas un worktree
		self.assertEqual(self.controle().returncode, 0)


class Source(unittest.TestCase):
	"""T015 : le source ne lance ni installation, ni serveur de dev, ni navigateur de test, ni app."""

	def test_source_sans_commande_interdite(self):
		with open(SCRIPT) as f:
			src = f.read()
		for mot in ('npm ci', 'npm run dev', 'playwright', 'open -a'):
			self.assertNotIn(mot, src)


if __name__ == '__main__':
	unittest.main()
