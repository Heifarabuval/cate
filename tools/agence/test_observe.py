#!/usr/bin/env python3
"""`agence observe list` : le journal d'observation, en lecture seule, par `cate observe list`.

La CLI `cate` est remplacée par un faux exécuteur (agence.RUN). Rien ne s'écrit : ni état, ni journal.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402

PANNEAU = '3f2a9c1e-7b4d-4e0a-9d51-0a1b2c3d4e5f'
LISTE = {
	'observations': [
		{'ts': '2026-11-19T09:00:00.000Z', 'kind': 'navigate', 'panelType': 'browser', 'ref': 'https://example.com/a'},
		{'ts': '2026-11-20T09:00:00.000Z', 'kind': 'panel.created', 'panelType': 'browser', 'ref': PANNEAU},
		{'ts': '2026-11-20T09:01:00.000Z', 'kind': 'panel.linked', 'panelType': 'browser', 'ref': PANNEAU},
	],
	'total': 3,
	'illisibles': 0,
	'jours': 14,
}
REFUS = 'observation-read-disabled: enable Observation → Read in Cate Settings → CLI'


class ObserveTest(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='agence-observe-')
		self.env = {k: os.environ.get(k) for k in ('AGENCE_ROOT', 'CATE_SOCKET')}
		os.environ['AGENCE_ROOT'] = self.tmp
		os.environ['CATE_SOCKET'] = '/tmp/x.sock'
		self.calls = []
		self.reponse = (0, json.dumps(LISTE), '')
		self.ancien = agence.RUN
		agence.RUN = self.faux

	def tearDown(self):
		agence.RUN = self.ancien
		for k, v in self.env.items():
			if v is None:
				os.environ.pop(k, None)
			else:
				os.environ[k] = v
		shutil.rmtree(self.tmp, ignore_errors=True)

	def faux(self, cmd, input=None, timeout=None):
		self.calls.append(cmd)
		return self.reponse

	def cli(self, *argv):
		out, err = io.StringIO(), io.StringIO()
		with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
			code = agence.main(list(argv))
		return code, out.getvalue(), err.getvalue()

	def test_une_ligne_par_observation_puis_le_total(self):
		code, out, _ = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		lignes = out.rstrip('\n').split('\n')
		self.assertEqual(len(lignes), 4)
		for ligne, obs in zip(lignes, LISTE['observations']):
			for champ in ('ts', 'kind', 'panelType', 'ref'):
				self.assertIn(obs[champ], ligne)
		self.assertIn('3 observations', lignes[-1])
		self.assertIn('14 jours', lignes[-1])
		self.assertEqual(self.calls, [['cate', 'observe', 'list', '--jours', '14', '--json']])

	def test_un_total_au_singulier_et_a_zero(self):
		self.reponse = (0, json.dumps({**LISTE, 'observations': LISTE['observations'][:1], 'total': 1}), '')
		self.assertIn('1 observation,', self.cli('observe', 'list')[1])
		self.reponse = (0, json.dumps({**LISTE, 'observations': [], 'total': 0}), '')
		code, out, _ = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		self.assertEqual(out.count('\n'), 1)
		self.assertIn('0 observation', out)

	def test_jours_est_passe_a_cate(self):
		self.cli('observe', 'list', '--jours', '3')
		self.assertEqual(self.calls, [['cate', 'observe', 'list', '--jours', '3', '--json']])
		self.cli('observe', 'list', '--jours', '0')
		self.assertEqual(self.calls[-1], ['cate', 'observe', 'list', '--jours', '0', '--json'])

	def test_jours_hors_des_bornes_est_refuse_sans_appeler_cate(self):
		for valeur in ('15', '-1', 'trois', '2.5', ''):
			with self.assertRaises(SystemExit) as e:
				self.cli('observe', 'list', '--jours', valeur)
			self.assertEqual(e.exception.code, 2, valeur)
		self.assertEqual(self.calls, [])

	def test_json_rend_la_reponse_de_cate(self):
		code, out, _ = self.cli('observe', 'list', '--json')
		self.assertEqual(code, 0)
		self.assertEqual(json.loads(out), LISTE)

	def test_refuse_sans_le_reglage_et_dit_lequel(self):
		self.reponse = (1, '', REFUS)
		code, out, err = self.cli('observe', 'list')
		self.assertEqual(code, 1)
		self.assertEqual(out, '')
		self.assertIn('cliObservationEnabled', err)
		self.assertIn(REFUS, err)

	def test_un_autre_refus_est_rendu_tel_quel(self):
		self.reponse = (1, '', 'cli-disabled: enable Command-line control (cate CLI) in Cate Settings → CLI')
		code, _, err = self.cli('observe', 'list')
		self.assertEqual(code, 1)
		self.assertIn('cli-disabled', err)
		self.assertNotIn('cliObservationEnabled', err)

	def test_tolere_une_entree_illisible(self):
		sale = [LISTE['observations'][0], 'pas un objet', None, {'ts': 5}, {'ts': 'x', 'kind': 'navigate'}, 3, LISTE['observations'][1]]
		self.reponse = (0, json.dumps({**LISTE, 'observations': sale, 'total': 7, 'illisibles': 1}), '')
		code, out, _ = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		lignes = out.rstrip('\n').split('\n')
		self.assertEqual(len(lignes), 3)
		self.assertIn('https://example.com/a', lignes[0])
		self.assertIn('2 observations', lignes[-1])
		# 1 ligne que le runtime n'a pas pu lire, 5 entrées de la réponse qui ne sont pas une observation.
		self.assertIn('6 lignes illisibles ignorées', lignes[-1])

	def test_une_reponse_qui_n_est_pas_un_journal_est_un_refus(self):
		for brut in ('[]', '{}', '{"observations": "oui"}', 'pas du json'):
			self.reponse = (0, brut, '')
			code, out, err = self.cli('observe', 'list')
			self.assertEqual(code, 1, brut)
			self.assertEqual(out, '', brut)
			self.assertIn('illisible', err, brut)

	def test_n_ecrit_rien(self):
		self.cli('observe', 'list')
		self.cli('observe', 'list', '--json')
		self.assertEqual(os.listdir(self.tmp), [])
		self.assertEqual(len(self.calls), 2)
		self.assertTrue(all(c[:3] == ['cate', 'observe', 'list'] for c in self.calls))

	def test_hors_d_un_terminal_cate_c_est_une_erreur_d_environnement(self):
		del os.environ['CATE_SOCKET']
		code, _, err = self.cli('observe', 'list')
		self.assertEqual(code, 2)
		self.assertIn('CATE_SOCKET', err)
		self.assertEqual(self.calls, [])


if __name__ == '__main__':
	unittest.main()
