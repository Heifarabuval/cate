#!/usr/bin/env python3
"""`agence org` : l'orga du workspace lue de .cate/org.json, validée par le contrat src/workspace/org (org.cjs réel, bundlé ici)."""
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
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import agence  # noqa: E402

ESBUILD = os.path.join(REPO, 'node_modules', '.bin', 'esbuild')
AGENCE = os.path.join(REPO, 'src', 'workspace', 'org', 'contract', 'examples.ts')


@unittest.skipUnless(os.path.exists(ESBUILD) and shutil.which('node'), 'esbuild et node requis')
class OrgTest(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		cls.bundle = tempfile.mkdtemp(prefix='org-bundle-')
		subprocess.run([ESBUILD, os.path.join(REPO, 'src', 'cli', 'org.ts'), '--bundle', '--platform=node', '--format=cjs',
		                f'--outfile={cls.bundle}/org.cjs', '--log-level=error'], check=True, cwd=REPO)
		# L'exemple agence du contrat, écrit en JSON par le contrat lui-même.
		probe = os.path.join(cls.bundle, 'agency.ts')
		with open(probe, 'w') as f:
			f.write(f"import {{ ORG_AGENCY }} from '{AGENCE[:-3]}'\nconsole.log(JSON.stringify(ORG_AGENCY))\n")
		cls.agency = subprocess.run([ESBUILD, probe, '--bundle', '--platform=node', '--log-level=error'], check=True, cwd=REPO,
		                            capture_output=True, text=True).stdout
		cls.agency = subprocess.run(['node', '-e', cls.agency], check=True, capture_output=True, text=True).stdout

	@classmethod
	def tearDownClass(cls):
		shutil.rmtree(cls.bundle, ignore_errors=True)

	def setUp(self):
		self.racine = tempfile.mkdtemp(prefix='org-root-')
		self.addCleanup(shutil.rmtree, self.racine, ignore_errors=True)
		for patch in (unittest.mock.patch.object(agence, 'ICI', self.bundle),
		              unittest.mock.patch.dict(os.environ, {'AGENCE_ROOT': self.racine})):
			patch.start()
			self.addCleanup(patch.stop)

	def ecrire(self, texte):
		os.makedirs(os.path.join(self.racine, '.cate'))
		with open(os.path.join(self.racine, '.cate', 'org.json'), 'w') as f:
			f.write(texte)

	def org(self, *args):
		out, err = io.StringIO(), io.StringIO()
		with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
			code = agence.main(['org', *args])
		return code, out.getvalue(), err.getvalue()

	def test_sans_fichier_profil_solo(self):
		code, out, _ = self.org()
		self.assertEqual(code, 0)
		self.assertIn('solo', out)
		self.assertIn('dev : Dev', out)
		self.assertIn('fini = PR opened', out)
		self.assertIn('liens : aucun', out)

	def test_exemple_agence_rend_les_postes_et_les_liens(self):
		self.ecrire(self.agency)
		code, out, _ = self.org()
		self.assertEqual(code, 0)
		for poste in ('po', 'front', 'back', 'qa', 'gcp'):
			self.assertIn(f'  {poste} : ', out)
		self.assertIn('front -> qa, vérifié par qa ; clic après le travail', out)
		self.assertIn('po -> front ; clic avant le travail', out)
		self.assertIn('4 agent(s)', out)

	def test_fichier_invalide_refuse_avec_toutes_ses_erreurs(self):
		data = json.loads(self.agency)
		data['maxAgents'] = 0
		data['links'].append({'from': 'po', 'to': 'fantome', 'click': 'before'})
		self.ecrire(json.dumps(data))
		code, out, err = self.org()
		self.assertEqual(code, 1)
		self.assertEqual(out, '')
		self.assertIn('rien ne se lance', err)
		self.assertIn('maxAgents', err)
		self.assertIn('unknown role "fantome"', err)

	def test_json_casse_refuse_sans_retomber_en_solo(self):
		self.ecrire('{ nope')
		code, out, err = self.org()
		self.assertEqual((code, out), (1, ''))
		self.assertIn('not valid JSON', err)

	def test_json_machine(self):
		code, out, _ = self.org('--json')
		self.assertEqual(code, 0)
		self.assertEqual(json.loads(out)['source'], 'solo')


class OrgSansBundleTest(unittest.TestCase):
	def test_bundle_absent_est_une_erreur_d_environnement(self):
		with tempfile.TemporaryDirectory() as vide, unittest.mock.patch.object(agence, 'ICI', vide), \
		     contextlib.redirect_stderr(io.StringIO()):
			self.assertEqual(agence.main(['org']), 2)


if __name__ == '__main__':
	unittest.main()
