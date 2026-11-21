"""Tests de benchmark.py : harnais du benchmark par rejeu d'issues fermées (spec 011, lots 2 et 3).

Lancer : python3 -m unittest tools/agence/test_benchmark.py
Tout tourne en faux HOME et en dossier temporaire : faux `gh` (fixtures/bench/bin), faux `open`,
`osascript`, `electron`, `npx`, `playwright`, `npm`, `claude` qui laissent un témoin s'ils sont
appelés ; `git` est le vrai, sur un dépôt créé dans le dossier temporaire. Rien ne touche le réseau.
"""
import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'benchmark.py')
sys.path.insert(0, HERE)
import benchmark  # noqa: E402  (appelé en processus : verrou de debut)
FIXTURE = os.path.join(HERE, 'fixtures', 'bench')
CAMPAGNE = os.path.join(FIXTURE, 'campagne')
ROOT = os.path.dirname(os.path.dirname(HERE))
ETAT_AGENCE = os.path.join('.cate', 'tmp', 'agence', 'state.json')
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
		r = self.run_('select', '--graine', '7', '--remplacer')
		self.assertEqual(r.returncode, 0, r.stderr)
		with open(os.path.join(self.specs, 'selection.json'), 'rb') as f:
			self.assertEqual(f.read(), premier)

	def test_selection_existante_jamais_ecrasee_sans_option(self):
		self.run_('select', '--graine', '7')
		with open(os.path.join(self.specs, 'selection.json'), 'rb') as f:
			premier = f.read()
		r = self.run_('select', '--graine', '8')
		self.assertEqual(r.returncode, 2)
		self.assertIn('selection.json existe', r.stderr)
		with open(os.path.join(self.specs, 'selection.json'), 'rb') as f:
			self.assertEqual(f.read(), premier)
		self.assertEqual(self.run_('select', '--graine', '8', '--remplacer').returncode, 0)
		self.assertEqual(self.selection()['graine'], 8)

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


class DepotJetable(Banc):
	"""Un vrai dépôt git jetable : PR 150 qui ferme l'issue 50, son test unitaire et un test Vitest."""

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
		self.git(self.specs, 'init', '-q')
		shutil.copy(os.path.join(CAMPAGNE, 'seuil.json'), self.specs)
		self.git(self.specs, 'add', 'seuil.json')
		self.git(self.specs, 'commit', '-qm', 'seuil')
		self.clone = os.path.join(self.racine, '50-nu')

	def appliquer_correctif(self):
		ecrire(os.path.join(self.clone, 'lib.py'), self.git(self.depot, 'show', self.head + ':lib.py') + '\n')


class Rejeu(DepotJetable):
	"""T011 à T013 et T015 : clone, dépendances, arbitre, gardes, sur un vrai dépôt git jetable."""

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

	def test_clone_sans_chemin_du_depot(self):
		"""Le fetch laisse le chemin du dépôt d'origine dans FETCH_HEAD : le clone ne doit le garder nulle part."""
		self.assertEqual(self.run_('prepare', '50', 'nu').returncode, 0)
		self.assertFalse(os.path.exists(os.path.join(self.clone, '.git', 'FETCH_HEAD')))
		r = subprocess.run(['grep', '-rlF', self.depot, os.path.join(self.clone, '.git')], capture_output=True, text=True)
		self.assertEqual(r.stdout, '')

	def test_debut_refuse_sans_seuil_commite(self):
		self.assertEqual(self.run_('prepare', '50', 'nu').returncode, 0)
		with open(os.path.join(self.specs, 'seuil.json'), 'a') as f:
			f.write('\n')
		r = self.run_('debut', '50', 'nu')
		self.assertEqual(r.returncode, 2)
		self.assertIn('seuil.json non commité', r.stderr)
		self.assertFalse(os.path.exists(os.path.join(self.racine, 'ouvert.json')))
		os.remove(os.path.join(self.specs, 'seuil.json'))
		r = self.run_('debut', '50', 'nu')
		self.assertEqual(r.returncode, 2)
		self.assertIn('seuil.json absent', r.stderr)

	def test_debut_refuse_tant_que_le_seuil_est_une_hypothese(self):
		self.assertEqual(self.run_('prepare', '50', 'nu').returncode, 0)
		shutil.copy(os.path.join(ROOT, 'specs', '011-mesure-benchmark', 'seuil.json'), self.specs)  # le seuil livré
		self.git(self.specs, 'commit', '-qam', 'seuil livré')
		r = self.run_('debut', '50', 'nu')
		self.assertEqual(r.returncode, 2, r.stderr)
		self.assertIn("hypothèse : l'humain confirme les valeurs et change la source", r.stderr)
		self.assertFalse(os.path.exists(os.path.join(self.racine, 'ouvert.json')))

	def test_ouvert_ecrit_sous_verrou(self):
		"""Deux `debut` en course : le second voit encore « rien d'ouvert » mais ne prend pas la place du premier."""
		self.assertEqual(self.run_('prepare', '50', 'nu').returncode, 0)
		self.assertEqual(self.run_('prepare', '50', 'outil').returncode, 0)
		self.assertEqual(self.run_('debut', '50', 'nu').returncode, 0)
		args = ['--racine', self.racine, '--specs', self.specs, '--depot', self.depot, 'debut', '50', 'outil']
		err = io.StringIO()
		with unittest.mock.patch.object(benchmark, 'ouvert', return_value=None), contextlib.redirect_stderr(err), \
				contextlib.redirect_stdout(io.StringIO()):
			self.assertEqual(benchmark.main(args), 2)
		self.assertIn('déjà ouvert', err.getvalue())
		with open(os.path.join(self.racine, 'ouvert.json')) as f:
			self.assertEqual(json.load(f), {'rejeu': '50-nu'})
		with open(os.path.join(self.racine, '50-outil.json')) as f:
			self.assertIsNone(json.load(f)['debut'])

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


class Comparer(DepotJetable):
	"""Lot 6 (T060, T061) : `comparer --avant --apres` rejoue en `claude -p` le sous-ensemble figé (pilotes et issue de
	comparaison), avant et après une économie de jetons, avec l'arbitre et la mesure des rejeux."""

	def setUp(self):
		super().setUp()
		os.chmod(os.path.join(FIXTURE, 'claude', 'claude'), 0o755)
		self.env['PATH'] = os.path.join(FIXTURE, 'claude') + os.pathsep + self.env['PATH']
		self.env['CLAUDE_ARGS'] = os.path.join(self.tmp, 'claude-args')
		self.refs = {}
		for nom, skill in (('bon', 'MODE=bon JETONS=900'), ('econome', 'MODE=bon JETONS=600'), ('casse', 'MODE=casse JETONS=300'),
		                   ('echec', 'MODE=echec JETONS=100')):
			ecrire(os.path.join(self.depot, 'skills', 'orchestrateur', 'SKILL.md'), skill + '\n')
			self.git(self.depot, 'add', '.')
			self.git(self.depot, 'commit', '-qm', nom)
			self.refs[nom] = self.git(self.depot, 'rev-parse', 'HEAD')
		s = self.selection()
		v = next(x for x in s['vivier'] if x['issue'] == 50)
		s['vivier'] = [dict(v, issue=i) for i in (50, 51, 52, 53)]
		s.update(pilotes=[{'issue': 50, 'premier': 'nu'}, {'issue': 51, 'premier': 'outil'}],
			campagne=[{'issue': 53, 'premier': 'nu'}], reserve=[], comparaison={'issue': 52})
		ecrire(os.path.join(self.specs, 'selection.json'), json.dumps(s))
		for i in (51, 52, 53):
			ecrire(os.path.join(self.gh, 'issue-%d.json' % i), json.dumps({'title': 'Issue %d' % i, 'body': 'f doit rendre 1.'}))

	def appels(self):
		with open(self.env['CLAUDE_ARGS']) as f:
			return [json.loads(l) for l in f]

	def rapports(self):
		d = os.path.join(self.specs, 'comparaisons')
		return [os.path.join(d, n) for n in os.listdir(d)] if os.path.isdir(d) else []

	def test_arbitre_rouge_apres_annuler_code_1(self):
		r = self.run_('comparer', '--avant', self.refs['bon'], '--apres', self.refs['casse'])
		self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
		self.assertIn('annuler', r.stdout)
		for i in ('50', '51', '52'):
			self.assertIn(i, r.stdout)
		[rapport] = self.rapports()
		with open(rapport) as f:
			self.assertIn('annuler', f.read())

	def test_tous_verts_jetons_avant_apres_rapport_code_0(self):
		r = self.run_('comparer', '--avant', self.refs['bon'], '--apres', self.refs['econome'])
		self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
		self.assertNotIn('annuler', r.stdout)
		self.assertIn('2700', r.stdout)  # 3 issues × 900 jetons avant
		self.assertIn('1800', r.stdout)  # 3 issues × 600 jetons après
		[rapport] = self.rapports()
		self.assertIn(rapport, r.stdout)
		self.assertRegex(os.path.basename(rapport), r'^\d{4}-\d\d-\d\d-%s\.md$' % self.refs['econome'][:12])
		with open(rapport) as f:
			texte = f.read()
		self.assertNotIn(self.tmp, texte)  # nombres seulement, aucun chemin (006 FR-005)

	def test_sous_ensemble_pilotes_et_comparaison_jamais_la_campagne(self):
		self.run_('comparer', '--avant', self.refs['bon'], '--apres', self.refs['econome'])
		enonces = [a[1] for a in self.appels()]
		self.assertEqual(len(enonces), 6)
		self.assertFalse(any('Issue 53' in e for e in enonces))
		self.assertEqual(sum('Issue 52' in e for e in enonces), 2)

	def test_claude_en_p_json_sans_interface(self):
		"""T061 : `-p` et `--output-format json`, aucune option qui ouvre une interface ; tearDown garde T015."""
		self.run_('comparer', '--avant', self.refs['bon'], '--apres', self.refs['econome'])
		for a in self.appels():
			self.assertEqual(a[0], '-p')
			self.assertEqual(a[2:4], ['--output-format', 'json'])
			self.assertEqual([x for x in a[4:] if x.startswith('-')], ['--permission-mode'])
			self.assertNotIn('--ide', a)

	def test_claude_en_echec_verdict_impossible(self):
		"""Relecture : un code de sortie non nul de `claude -p` ne donne jamais « garder » (arbitre vert par hasard)."""
		r = self.run_('comparer', '--avant', self.refs['bon'], '--apres', self.refs['echec'])
		self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
		self.assertNotIn('garder', r.stdout)
		self.assertIn('verdict impossible', r.stdout)
		self.assertIn('code 3', r.stdout)
		[rapport] = self.rapports()
		with open(rapport) as f:
			self.assertIn('verdict impossible', f.read())

	def test_clones_temporaires_retires_meme_en_echec(self):
		for apres in ('econome', 'echec'):
			with self.subTest(apres=apres):
				self.run_('comparer', '--avant', self.refs['bon'], '--apres', self.refs[apres])
				self.assertEqual([n for n in os.listdir(self.racine) if n.startswith('comparer-')], [])

	def test_rapport_de_meme_date_et_ref_jamais_ecrase(self):
		for _ in range(2):
			self.assertEqual(self.run_('comparer', '--avant', self.refs['bon'], '--apres', self.refs['econome']).returncode, 0)
		noms = sorted((os.path.basename(p) for p in self.rapports()), key=len)
		self.assertEqual(len(noms), 2, noms)
		self.assertEqual(noms[1], noms[0][:-3] + '-2.md')

	def test_ref_inconnue_refuse_sans_appel(self):
		r = self.run_('comparer', '--avant', 'nexistepas', '--apres', self.refs['econome'])
		self.assertEqual(r.returncode, 2)
		self.assertIn('nexistepas', r.stderr)
		self.assertFalse(os.path.exists(self.env['CLAUDE_ARGS']))


class SansRecettes(unittest.TestCase):
	"""Décision de l'humain (PR 186) : on attend le module des recettes ; ni porte ni résumé des fiches closes, code sans
	appelant."""

	def test_porte_et_resume_retires(self):
		import backlog
		with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
			benchmark.main(['porte', 'rapport.md'])
		self.assertFalse(hasattr(benchmark, 'porte'))
		self.assertFalse(hasattr(backlog, 'resume_closes'))


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

	def test_chemin_du_depot_cite_invalide(self):
		self.journal('git -C %s log --all' % self.depot)
		r = self.controle()
		self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
		self.assertIn('1 appel', r.stdout)

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


class Specs(Banc):
	"""Dossier de specs dans un dépôt git jetable : seuil.json commité, selection.json de la fixture de campagne."""

	def setUp(self):
		super().setUp()
		os.makedirs(self.specs)
		self.env['GIT_COMMITTER_DATE'] = '2025-12-31T00:00:00Z'  # avant le premier rejeu des fixtures
		self.git(self.specs, 'init', '-q')
		shutil.copy(os.path.join(CAMPAGNE, 'seuil.json'), self.specs)
		shutil.copy(os.path.join(CAMPAGNE, 'selection.json'), self.specs)
		self.git(self.specs, 'add', '.')
		self.git(self.specs, 'commit', '-qm', 'seuil')
		self.resultats = os.path.join(self.specs, 'resultats')

	def seuil(self, **kw):
		with open(os.path.join(CAMPAGNE, 'seuil.json')) as f:
			s = json.load(f)
		s.update(kw)
		ecrire(os.path.join(self.specs, 'seuil.json'), json.dumps(s, indent=1))

	def commit_seuil(self, **kw):
		self.seuil(**kw)
		self.git(self.specs, 'commit', '-qam', 'seuil retouché')

	def resultat(self, nom):
		with open(os.path.join(self.resultats, nom + '.json')) as f:
			return json.load(f)

	def dater_seuil(self, date):
		"""Recommite seuil.json tel quel (même empreinte) à une autre date."""
		self.git(self.specs, 'commit', '-q', '--amend', '--no-edit', '--date', date)
		subprocess.run(['git', 'commit', '-q', '--amend', '--no-edit'], cwd=self.specs, check=True,
			env=dict(self.env, GIT_COMMITTER_DATE=date), capture_output=True)


class Mesure(Specs):
	"""T020, T021, T025 : mesure d'un rejeu sur les journaux de fixtures/bench/outil et un état agence avec clics."""

	def setUp(self):
		super().setUp()
		self.clone = os.path.join(self.racine, '14-outil')
		ecrire(os.path.join(self.racine, '14-outil.json'), json.dumps({
			'issue': 14, 'bras': 'outil', 'dependances': 'aucune', 'debut': '2026-01-01T10:59:00Z',
			'finis': [{'instant': '2026-01-01T11:15:00Z', 'arbitre': 'rouge'}, {'instant': '2026-01-01T12:05:00Z', 'arbitre': 'vert'}]
		}))
		self.etat = os.path.join(self.clone, ETAT_AGENCE)
		os.makedirs(os.path.dirname(self.etat))
		shutil.copy(os.path.join(CAMPAGNE, 'agence.json'), self.etat)
		projets = os.path.join(self.home, '.claude', 'projects')
		outil = os.path.join(FIXTURE, 'outil')
		shutil.copytree(os.path.join(outil, '-Users-x-proj'), os.path.join(projets, encoder(self.clone)))
		shutil.copytree(os.path.join(outil, '-Users-x-proj--cate-worktrees-w1'),
			os.path.join(projets, encoder(self.clone) + '--cate-worktrees-w1'))

	def mesure(self, *args):
		r = self.run_('mesure', '14', 'outil', *args)
		self.assertEqual(r.returncode, 0, r.stderr)
		return r, self.resultat('14-outil')

	def usage(self, panneaux):
		p = os.path.join(self.tmp, 'usage.json')
		ecrire(p, json.dumps(panneaux))
		return p

	def test_temps_actif_plafonne(self):
		# Événements humains de la fenêtre [debut 10:59:00, dernier fini 12:05:00], délai depuis l'événement précédent :
		# debut 0 ; 11:00:00 « lance » 60 ; 11:11:00 clic n1 30 (après la notification de 11:10:30) ;
		# 11:12:00 « merci » 60 ; 11:15:00 fini 175 ; 12:00:00 « autre » 2700 → 180 ; 12:02:00 clic n2 115 ; 12:05:00 fini 180.
		# Hors compte : le brief de l'agent à 11:00:20 (machine), la note « cli » de 11:11:30, le clic de 12:30:00 (après le dernier fini).
		_, r = self.mesure()
		self.assertEqual(r['temps_actif_s'], 0 + 60 + 30 + 60 + 175 + 180 + 115 + 180)
		self.assertEqual(r['interventions'], 8)
		self.assertEqual(r['temps_mural_s'], 66 * 60)
		self.assertEqual(r['reprises'], 1)

	def test_clic_d_un_autre_besoin_compte(self):
		with open(self.etat) as f:
			st = json.load(f)
		st['needs'][1]['journal'] = []  # sans le clic de n2 à 12:02:00, le fini de 12:05:00 part de 12:00:05
		ecrire(self.etat, json.dumps(st))
		_, r = self.mesure()
		self.assertEqual(r['temps_actif_s'], 0 + 60 + 30 + 60 + 175 + 180 + 180)

	def test_plafond_lu_dans_le_seuil(self):
		self.commit_seuil(plafond_s=60)
		_, r = self.mesure()
		self.assertEqual(r['temps_actif_s'], 0 + 60 + 30 + 60 + 60 + 60 + 60 + 60)

	def test_resultat_cles_et_nombres_seulement(self):
		out, r = self.mesure()
		self.assertEqual(set(r), {
			'issue', 'bras', 'outil', 'seuil', 'debut', 'finis', 'temps_actif_s', 'temps_mural_s', 'interventions',
			'reprises', 'remarques', 'rouge_interface', 'jetons', 'jetons_regisseur', 'sessions', 'contamination', 'etat'
		})
		self.assertEqual(r['jetons'], {'entree': 23, 'cache_cree': 195, 'lus': 4850, 'sortie': 37, 'total': 5105, 'partiel': False})
		self.assertEqual(r['sessions'], {'lues': 3, 'non_lues': 0, 'non_mesurees': 0})
		with open(os.path.join(self.specs, 'seuil.json'), 'rb') as f:
			self.assertEqual(r['seuil'], hashlib.sha256(f.read()).hexdigest())
		self.assertEqual((r['etat'], r['contamination'], r['remarques'], r['rouge_interface']), ('valide', 0, None, None))
		with open(os.path.join(self.resultats, '14-outil.json')) as f:
			texte = f.read() + out.stdout + out.stderr
		for mot in ('MARQUEUR', self.tmp, 'orch', 'agent.jsonl', 'Rapport de', 'x-proj'):
			self.assertNotIn(mot, texte)

	def test_panneau_non_claude_code_partiel(self):
		_, r = self.mesure('--usage-json', self.usage([
			{'panelId': 'p1', 'agentId': 'claude-code', 'sessionIds': ['orch', 'orch2', 'agent']},
			{'panelId': 'p2', 'agentId': 'codex', 'sessionIds': ['x']}
		]))
		self.assertGreater(r['sessions']['non_mesurees'], 0)
		self.assertTrue(r['jetons']['partiel'])
		self.assertEqual(r['jetons_regisseur'], 0)

	def test_session_claude_code_du_regisseur_comptee(self):
		"""T025 : une session claude-code tenue par le panneau régisseur (fixture inventée) rend sa part non nulle."""
		_, r = self.mesure('--usage-json', self.usage([
			{'panelId': 'p1', 'agentId': 'claude-code', 'sessionIds': ['orch', 'agent']},
			{'panelId': 'p9', 'agentId': 'claude-code', 'sessionIds': ['orch2']}
		]))
		self.assertEqual(r['jetons_regisseur'], 4 + 40 + 400 + 5)
		self.assertEqual(r['jetons']['total'], 5105)

	def test_regisseur_non_attribue_sans_usage(self):
		_, r = self.mesure()
		self.assertIsNone(r['jetons_regisseur'])

	def test_rejeu_ouvert_inacheve(self):
		ecrire(os.path.join(self.racine, 'ouvert.json'), json.dumps({'rejeu': '14-outil'}))
		_, r = self.mesure()
		self.assertEqual(r['etat'], 'inachevé')
		self.assertIsNone(r['temps_actif_s'])

	def test_contamination_invalide(self):
		d = os.path.join(self.home, '.claude', 'projects', encoder(self.clone))
		with open(os.path.join(d, 'orch2.jsonl'), 'a') as f:
			f.write(json.dumps({'type': 'assistant', 'timestamp': '2026-01-01T12:00:06Z', 'message': {'id': 'p2', 'content': [
				{'type': 'tool_use', 'id': 'tz', 'name': 'Bash', 'input': {'command': 'gh pr view 114'}}]}}) + '\n')
		_, r = self.mesure()
		self.assertEqual((r['etat'], r['contamination']), ('invalide', 1))

	def test_sans_journal_jetons_inconnus(self):
		shutil.rmtree(os.path.join(self.home, '.claude', 'projects'))
		out, r = self.mesure()
		self.assertEqual(r['sessions']['lues'], 0)
		self.assertEqual(r['jetons'], {'entree': None, 'cache_cree': None, 'lus': None, 'sortie': None, 'total': None,
			'partiel': True})
		self.assertIn('jetons inconnus', out.stdout)

	def test_seuil_commite_apres_le_premier_rejeu_refuse(self):
		self.dater_seuil('2026-01-01T11:00:00Z')  # le rejeu a commencé à 10:59:00
		r = self.run_('mesure', '14', 'outil')
		self.assertEqual(r.returncode, 2)
		self.assertIn('seuil.json commité après le premier rejeu', r.stderr)
		self.assertFalse(os.path.exists(os.path.join(self.resultats, '14-outil.json')))

	def test_seuil_absent_refuse(self):
		os.remove(os.path.join(self.specs, 'seuil.json'))
		r = self.run_('mesure', '14', 'outil')
		self.assertEqual(r.returncode, 2)
		self.assertIn('seuil.json absent', r.stderr)


class Revue(Specs):
	"""T022 : diffs présentés dans un ordre tiré par la graine, sans le bras ; saisie écrite dans le bon résultat."""

	def setUp(self):
		super().setUp()
		a = os.path.join(self.racine, '50-nu')
		os.makedirs(a)
		self.git(a, 'init', '-q')
		ecrire(os.path.join(a, 'a.txt'), 'base\n')
		self.git(a, 'add', '.')
		self.git(a, 'commit', '-qm', 'base')
		base = self.git(a, 'rev-parse', 'HEAD')
		shutil.copytree(a, os.path.join(self.racine, '50-outil'))
		for bras, mot in (('nu', 'PREMIERDIFF'), ('outil', 'SECONDDIFF')):
			ecrire(os.path.join(self.racine, '50-' + bras, 'neuf.txt'), mot + '\n')
		with open(os.path.join(self.specs, 'selection.json')) as f:
			sel = json.load(f)
		sel['vivier'][1]['base'] = base
		ecrire(os.path.join(self.specs, 'selection.json'), json.dumps(sel))
		for bras in ('nu', 'outil'):
			ecrire(os.path.join(self.resultats, '50-%s.json' % bras), json.dumps(
				{'issue': 50, 'bras': bras, 'etat': 'valide', 'remarques': None, 'rouge_interface': None}))

	def test_revue_a_l_aveugle(self):
		r = subprocess.run(
			[sys.executable, '-I', SCRIPT, '--racine', self.racine, '--specs', self.specs, '--depot', self.depot, 'revue'],
			input='2\nn\n5\no\n', capture_output=True, text=True, env=self.env, cwd=self.tmp, timeout=60)
		self.assertEqual(r.returncode, 0, r.stderr)
		vus = sorted(('PREMIERDIFF', 'SECONDDIFF'), key=r.stdout.index)
		attendu = {vus[0]: (2, False), vus[1]: (5, True)}
		nu, outil = self.resultat('50-nu'), self.resultat('50-outil')
		self.assertEqual((nu['remarques'], nu['rouge_interface']), attendu['PREMIERDIFF'])
		self.assertEqual((outil['remarques'], outil['rouge_interface']), attendu['SECONDDIFF'])
		self.assertNotRegex(r.stdout, r'\b(nu|outil)\b')
		self.assertNotIn(self.racine, r.stdout)
		r2 = self.run_('revue')
		self.assertEqual(r2.returncode, 0, r2.stderr)
		self.assertIn('aucune diff à revoir', r2.stdout)


	def test_remarques_non_numeriques_refusees(self):
		for saisie in ('deux\n', '-1\n'):
			with self.subTest(saisie=saisie):
				r = subprocess.run(
					[sys.executable, '-I', SCRIPT, '--racine', self.racine, '--specs', self.specs, '--depot', self.depot, 'revue'],
					input=saisie, capture_output=True, text=True, env=self.env, cwd=self.tmp, timeout=60)
				self.assertEqual(r.returncode, 2, r.stderr)
				self.assertIn('remarques : un nombre entier attendu', r.stderr)
				self.assertNotIn('Traceback', r.stderr)
				self.assertIsNone(self.resultat('50-nu')['remarques'])
				self.assertIsNone(self.resultat('50-outil')['remarques'])


class Rapport(Specs):
	"""T023 à T025 : verdict sur la fixture de campagne (10 issues × 2 bras, résultats écrits à la main), seuil, régisseur.

	Les issues 15 à 20 encadrent 11 à 14 sur chaque indicateur (3 en dessous, 3 au-dessus) : les médianes à 10 issues sont celles
	de 11 à 14, et les tests qui retouchent 11 à 14 déplacent la médiane comme sur 4 issues."""

	def setUp(self):
		super().setUp()
		shutil.copytree(os.path.join(CAMPAGNE, 'resultats'), self.resultats)

	def modifier(self, nom, **kw):
		r = self.resultat(nom)
		r.update(kw)
		ecrire(os.path.join(self.resultats, nom + '.json'), json.dumps(r))

	def rapport(self, code=0):
		r = self.run_('rapport')
		self.assertEqual(r.returncode, code, r.stdout + r.stderr)
		return r

	def test_passe_avec_les_nombres_attendus(self):
		out = self.rapport().stdout
		with open(os.path.join(self.specs, 'rapport-benchmark.md')) as f:
			self.assertEqual(f.read(), out)
		for ligne in (
			'| nu | 850 | 2100 | 9 | 1 | 6 | 90000 |',
			'| outil | 490 | 1800 | 10 | 0 | 5 | 125000 |',
			'| 12 | nu | 800 | 2400 | rouge | 1 | 1 | 200000 |',
			'Rapports médians outil / nu : temps actif 0,55 ; jetons 1,35 (partiel) ; temps mural 1,00 (rapporté, non bloquant).',
			'Issues comptées : 10 (campagne 10 sur 10, réserve 0 sur 5). Rejeux invalidés : 0. Inachevés : 0. Jetons partiels : 1.',
			'Rouge par interface : 1.',
			'Jetons du régisseur et des détections déterministes : 0.',
			'Couche 1 : passe.'
		):
			self.assertIn(ligne, out)

	def test_deux_lancements_identiques(self):
		premier = self.rapport().stdout
		with open(os.path.join(self.specs, 'rapport-benchmark.md'), 'rb') as f:
			octets = f.read()
		self.assertEqual(self.rapport().stdout, premier)
		with open(os.path.join(self.specs, 'rapport-benchmark.md'), 'rb') as f:
			self.assertEqual(f.read(), octets)

	def test_ne_passe_pas_sur_le_temps_actif(self):
		for i, ta in ((11, 800), (12, 720), (13, 510), (14, 855)):  # 0,8 0,9 0,85 0,95 : médiane 0,875
			self.modifier('%d-outil' % i, temps_actif_s=ta)
		out = self.rapport().stdout
		self.assertIn('temps actif 0,88', out)
		self.assertIn('Couche 1 : ne passe pas (temps actif).', out)

	def test_ne_passe_pas_sur_la_qualite(self):
		for i in (11, 13):
			self.modifier('%d-outil' % i, finis=[{'instant': 'x', 'arbitre': 'rouge'}, {'instant': 'y', 'arbitre': 'vert'}], reprises=1)
		self.assertIn('Couche 1 : ne passe pas (qualité).', self.rapport().stdout)

	def test_non_conclusif(self):
		for i, ta in ((11, 700), (12, 568), (13, 438), (14, 666)):  # 0,70 0,71 0,73 0,74 : médiane 0,72
			self.modifier('%d-outil' % i, temps_actif_s=ta)
		out = self.rapport().stdout
		self.assertIn('Couche 1 : non conclusif (temps actif 0,72 dans la zone 0,65 à 0,75) : rejouer les 5 issues de réserve.', out)

	def test_temps_mural_jamais_bloquant(self):
		for i in (11, 12, 13, 14):
			self.modifier('%d-outil' % i, temps_mural_s=99999)
		self.assertIn('Couche 1 : passe.', self.rapport().stdout)

	def test_jetons_au_dela_du_plafond(self):
		self.modifier('13-outil', jetons=dict(self.resultat('13-outil')['jetons'], total=500000))
		self.modifier('11-outil', jetons=dict(self.resultat('11-outil')['jetons'], total=900000))
		self.assertIn('Couche 1 : ne passe pas (jetons).', self.rapport().stdout)

	def test_rejeu_invalide_retire_l_issue(self):
		self.modifier('14-outil', etat='invalide')
		out = self.rapport(2).stdout  # verdict impossible : code 2
		self.assertIn('Issues comptées : 9 (campagne 9 sur 10, réserve 0 sur 5). Rejeux invalidés : 1.', out)
		self.assertIn('Couche 1 : verdict impossible (9 issues valides dans les deux bras, il en faut 10).', out)

	def test_une_seule_issue_valide_verdict_impossible(self):
		for i in range(12, 21):
			for b in ('nu', 'outil'):
				os.remove(os.path.join(self.resultats, '%d-%s.json' % (i, b)))
		out = self.rapport(2).stdout
		self.assertIn('Couche 1 : verdict impossible (1 issue valide dans les deux bras, il en faut 10).', out)
		self.assertNotIn('passe', out.split('## Verdict')[1])

	def test_reserve_entamee_il_faut_15_issues(self):
		for i, ta in ((11, 700), (12, 568), (13, 438), (14, 666)):  # zone non conclusive : la réserve est jouée
			self.modifier('%d-outil' % i, temps_actif_s=ta)
		for b in ('nu', 'outil'):
			r = self.resultat('15-' + b)
			r['issue'] = 21
			ecrire(os.path.join(self.resultats, '21-%s.json' % b), json.dumps(r))
		self.assertIn('Couche 1 : verdict impossible (11 issues valides dans les deux bras, il en faut 15).', self.rapport(2).stdout)

	def test_jetons_inconnus_rapportes(self):
		inconnus = {'entree': None, 'cache_cree': None, 'lus': None, 'sortie': None, 'total': None, 'partiel': True}
		self.modifier('13-nu', jetons=inconnus)
		out = self.rapport().stdout
		self.assertIn('| 13 | nu | 600 | 1200 | vert | 0 | 0 | - |', out)
		self.assertIn('Jetons partiels : 2.', out)

	def test_verdict_refuse_tant_que_le_seuil_est_une_hypothese(self):
		self.commit_seuil(source='hypothèse 011, à confirmer par l\'humain avant le premier rejeu')
		self.assertIn("hypothèse : l'humain confirme les valeurs et change la source", self.rapport(2).stderr)
		self.assertFalse(os.path.exists(os.path.join(self.specs, 'rapport-benchmark.md')))

	def test_cle_manquante_du_seuil_refus_lisible(self):
		with open(os.path.join(CAMPAGNE, 'seuil.json')) as f:
			s = json.load(f)
		del s['plafond_s'], s['source']
		ecrire(os.path.join(self.specs, 'seuil.json'), json.dumps(s))
		self.git(self.specs, 'commit', '-qam', 'seuil incomplet')
		err = self.rapport(2).stderr
		self.assertIn('seuil.json : clé manquante : plafond_s, source', err)
		self.assertNotIn('Traceback', err)

	def test_seuil_commite_apres_le_premier_rejeu_refuse(self):
		self.dater_seuil('2026-02-11T09:00:01Z')  # premier rejeu de la fixture : 2026-02-11T09:00:00Z
		self.assertIn('seuil.json commité après le premier rejeu', self.rapport(2).stderr)
		self.assertFalse(os.path.exists(os.path.join(self.specs, 'rapport-benchmark.md')))
		self.dater_seuil('2026-02-11T09:00:00Z')
		self.rapport()

	def test_part_du_regisseur_signalee(self):
		self.modifier('12-outil', jetons_regisseur=1500)
		self.assertIn('Jetons du régisseur et des détections déterministes : 1500 (attendu 0, 009 SC-006).', self.rapport().stdout)

	def test_seuil_absent_refuse(self):
		self.git(self.specs, 'rm', '-q', 'seuil.json')
		self.assertIn('seuil.json absent', self.rapport(2).stderr)

	def test_seuil_non_commite_refuse(self):
		self.seuil(temps_actif_max=0.9)
		self.assertIn('seuil.json non commité', self.rapport(2).stderr)
		self.assertFalse(os.path.exists(os.path.join(self.specs, 'rapport-benchmark.md')))

	def test_empreinte_differente_refuse(self):
		self.commit_seuil(temps_actif_max=0.9)
		self.assertIn('empreinte du seuil', self.rapport(2).stderr)


class Source(unittest.TestCase):
	"""T015 : le source ne lance ni installation, ni serveur de dev, ni navigateur de test, ni app."""

	def test_source_sans_commande_interdite(self):
		with open(SCRIPT) as f:
			src = f.read()
		for mot in ('npm ci', 'npm run dev', 'playwright', 'open -a'):
			self.assertNotIn(mot, src)


if __name__ == '__main__':
	unittest.main()
