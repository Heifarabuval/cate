#!/usr/bin/env python3
"""`agence org propose` et `org save` : l'orga décrite à la parole, écrite par un agent, enregistrée au seul clic de l'humain.
Les descriptions et leurs fichiers sont des fixtures du contrat (src/workspace/org/contract/fixtures)."""
import contextlib
import io
import os
import shutil
import subprocess
import tempfile
import unittest
import unittest.mock

import agence
import test_agence

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ESBUILD = os.path.join(REPO, 'node_modules', '.bin', 'esbuild')
FIXTURES = os.path.join(REPO, 'src', 'workspace', 'org', 'contract', 'fixtures')


@unittest.skipUnless(os.path.exists(ESBUILD) and shutil.which('node'), 'esbuild et node requis')
class OrgParole(test_agence.Base):
	@classmethod
	def setUpClass(cls):
		cls.bundle = tempfile.mkdtemp(prefix='org-bundle-')
		subprocess.run([ESBUILD, os.path.join(REPO, 'src', 'cli', 'org.ts'), '--bundle', '--platform=node', '--format=cjs',
		                f'--outfile={cls.bundle}/org.cjs', '--log-level=error'], check=True, cwd=REPO)

	@classmethod
	def tearDownClass(cls):
		shutil.rmtree(cls.bundle, ignore_errors=True)

	def setUp(self):
		super().setUp()
		patch = unittest.mock.patch.object(agence, 'ICI', self.bundle)
		patch.start()
		self.addCleanup(patch.stop)
		self.booted()
		faux = agence.RUN  # org.cjs tourne pour de vrai ; cate et gh restent le faux exécuteur
		agence.RUN = lambda cmd, input=None, timeout=None: (
			agence._run(cmd, input) if cmd[1:2] and cmd[1].endswith('org.cjs') else faux(cmd, input, timeout))

	def fixture(self, nom):
		with open(os.path.join(FIXTURES, nom)) as f:
			return f.read()

	def org_json(self):
		return os.path.join(self.tmp, '.cate', 'org.json')

	def propose(self, nom):
		fichier = os.path.join(FIXTURES, nom)
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, out = self.cli('org', 'propose', fichier, '--from', 'a1')
		return code, out, err.getvalue()

	def save(self, qid):
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, out = self.cli('org', 'save', qid)
		return code, out, err.getvalue()

	def question(self):
		return self.state()['questions'][-1]

	def test_trois_descriptions_donnent_trois_fichiers_valides_enregistres_apres_le_clic(self):
		for nom, postes in (('solo', 1), ('esn', 7), ('admin', 3)):
			with self.subTest(nom):
				if os.path.exists(self.org_json()):
					os.remove(self.org_json())
				code, out, _ = self.propose(f'{nom}.json')
				self.assertEqual(code, 0)
				self.assertIn('aperçu', out)
				self.assertIn(f'{postes} poste(s)', out)
				self.assertFalse(os.path.exists(self.org_json()), 'rien n\'est écrit avant le clic')
				q = self.question()
				self.assertEqual([o['label'] for o in q['options']], ['Enregistrer', 'Refuser'])
				self.assertEqual(self.save(q['id'])[0], 1, 'sans clic, pas d\'enregistrement')
				self.assertFalse(os.path.exists(self.org_json()))
				agence.click(f"/ask/{q['id']}", {'choice': ['0']})
				code, out, _ = self.save(q['id'])
				self.assertEqual(code, 0)
				with open(self.org_json()) as f:
					self.assertEqual(f.read(), self.fixture(f'{nom}.json'))
				self.assertEqual(self.cli('org', '--json')[0], 0)

	def test_la_carte_montre_le_diff_de_l_orga_avant_le_clic(self):
		self.propose('admin.json')
		q = self.question()['question']
		self.assertIn('- Orga, poste ajouté : redacteur (Rédacteur)', q)
		self.assertIn('- Orga, poste retiré : dev', q, "l'avant est l'orga effective, solo sans fichier")
		self.assertIn('- Orga, lien ajouté : redacteur -> verificateur, vérifié par verificateur ; clic jamais', q)
		self.assertLess(q.index('- Orga, poste ajouté'), q.index('3 poste(s)'), 'le diff précède l\'aperçu')
		self.assertFalse(os.path.exists(self.org_json()))
		agence.click(f"/ask/{self.question()['id']}", {'choice': ['0']})
		self.save(self.question()['id'])
		self.propose('admin.json')
		self.assertIn("aucun écart avec l'orga actuelle", self.question()['question'], 'une orga déjà enregistrée : le diff le dit')

	def test_description_absurde_ne_produit_aucun_fichier(self):
		code, out, err = self.propose('absurde.json')
		self.assertEqual((code, out), (1, ''))
		self.assertIn('rien n\'est enregistré', err)
		self.assertIn('maxAgents', err)  # l'erreur est lisible : l'agent la corrige
		self.assertIn('"roles" needs at least one role', err)
		self.assertEqual(self.state()['questions'], [], 'pas de carte pour un fichier invalide')
		self.assertFalse(os.path.exists(self.org_json()))

	def test_refuser_n_ecrit_rien(self):
		self.propose('esn.json')
		q = self.question()
		agence.click(f"/ask/{q['id']}", {'choice': ['1']})
		code, _, err = self.save(q['id'])
		self.assertEqual(code, 1)
		self.assertIn('Refuser', err)
		self.assertFalse(os.path.exists(self.org_json()))

	def test_json_casse_refuse(self):
		fichier = os.path.join(self.tmp, 'casse.json')
		with open(fichier, 'w') as f:
			f.write('{ nope')
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, out = self.cli('org', 'propose', fichier, '--from', 'a1')
		self.assertEqual((code, out), (1, ''))
		self.assertIn('not valid JSON', err.getvalue())

	def test_question_inconnue_ou_sans_orga(self):
		self.assertEqual(self.save('q99')[0], 1)
		_, out = self.cli('ask', '--from', 'a1', '--option', 'Enregistrer|x', '--option', 'Refuser|y', 'Autre ?')
		agence.click(f'/ask/{out.strip()}', {'choice': ['0']})
		self.assertEqual(self.save(out.strip())[0], 1, 'une autre question cliquée n\'enregistre rien')
		self.assertFalse(os.path.exists(self.org_json()))


if __name__ == '__main__':
	unittest.main()
