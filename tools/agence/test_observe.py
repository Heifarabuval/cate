#!/usr/bin/env python3
"""`agence observe list` : le journal d'observation, en lecture seule, par `cate observe list`.

Par défaut la commande n'imprime que le décompte et les types d'événements : la sortie d'un terminal Cate est
enregistrée dans terminal-logs/, hors de la rétention de 14 jours et hors de « Tout effacer ». Les adresses et
les identifiants ne sortent qu'avec --refs, qui le dit.

La CLI `cate` est remplacée par un faux exécuteur (agence.RUN). Rien ne s'écrit : ni état, ni journal.
"""
import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
import unittest.mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402

PANNEAU = '3f2a9c1e-7b4d-4e0a-9d51-0a1b2c3d4e5f'
ADRESSE = 'https://example.com/commandes'
# Ce que cate observe list rend par défaut : des décomptes, aucune adresse.
RESUME = {
	'jours': 14,
	'total': 3,
	'illisibles': 0,
	'types': [
		{'kind': 'navigate', 'panelType': 'browser', 'count': 1},
		{'kind': 'panel.created', 'panelType': 'browser', 'count': 1},
		{'kind': 'panel.linked', 'panelType': 'browser', 'count': 1},
	],
}
# Ce qu'il rend avec --refs.
LISTE = {
	**RESUME,
	'observations': [
		{'ts': '2026-11-19T09:00:00.000Z', 'kind': 'navigate', 'panelType': 'browser', 'ref': ADRESSE},
		{'ts': '2026-11-20T09:00:00.000Z', 'kind': 'panel.created', 'panelType': 'browser', 'ref': PANNEAU},
		{'ts': '2026-11-20T09:01:00.000Z', 'kind': 'panel.linked', 'panelType': 'browser', 'ref': PANNEAU},
	],
}
REFUS = 'observation-read-disabled: enable Observation → Read in Cate Settings → CLI'


class ObserveTest(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='agence-observe-')
		self.env = {k: os.environ.get(k) for k in ('AGENCE_ROOT', 'CATE_SOCKET')}
		os.environ['AGENCE_ROOT'] = self.tmp
		os.environ['CATE_SOCKET'] = '/tmp/x.sock'
		self.calls = []
		self.reponse = (0, json.dumps(RESUME), '')
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

	# ---------- par défaut : le décompte et les types, jamais une adresse ----------

	def test_par_defaut_le_decompte_puis_un_type_par_ligne(self):
		code, out, err = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		lignes = out.rstrip('\n').split('\n')
		self.assertEqual(len(lignes), 4)
		self.assertIn('3 observations', lignes[0])
		self.assertIn("aujourd'hui et 14 jours avant", lignes[0])
		for ligne, (kind, panneau) in zip(lignes[1:], [('navigate', 'browser'), ('panel.created', 'browser'), ('panel.linked', 'browser')]):
			self.assertRegex(ligne, r'\s*%s\s+%s\s+1\s*$' % (re.escape(kind), panneau))
		self.assertEqual(err, '')
		self.assertEqual(self.calls, [['cate', 'observe', 'list', '--jours', '14', '--json']])

	def test_par_defaut_aucune_adresse_meme_si_la_reponse_en_porte(self):
		self.reponse = (0, json.dumps(LISTE), '')
		code, out, err = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		for secret in (ADRESSE, 'example.com', PANNEAU, '2026-11-19'):
			self.assertNotIn(secret, out + err)
		self.assertEqual(self.calls[-1].count('--refs'), 0)

	def test_un_total_au_singulier_et_a_zero(self):
		self.reponse = (0, json.dumps({**RESUME, 'total': 1, 'types': RESUME['types'][:1]}), '')
		code, out, _ = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		self.assertIn('1 observation,', out.split('\n')[0])
		self.reponse = (0, json.dumps({**RESUME, 'total': 0, 'types': []}), '')
		code, out, _ = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		self.assertEqual(out.count('\n'), 1)
		self.assertIn('0 observation', out)

	def test_aujourd_hui_seulement(self):
		self.reponse = (0, json.dumps({**RESUME, 'jours': 0}), '')
		code, out, _ = self.cli('observe', 'list', '--jours', '0')
		self.assertEqual(code, 0)
		self.assertIn("3 observations, aujourd'hui\n", out)

	def test_jours_est_passe_a_cate(self):
		self.cli('observe', 'list', '--jours', '3')
		self.assertEqual(self.calls, [['cate', 'observe', 'list', '--jours', '3', '--json']])
		self.cli('observe', 'list', '--jours', '0')
		self.assertEqual(self.calls[-1], ['cate', 'observe', 'list', '--jours', '0', '--json'])

	def test_jours_hors_des_bornes_est_refuse_sans_appeler_cate(self):
		for valeur in ('15', '-1', 'trois', '2.5', '', '²'):
			with self.assertRaises(SystemExit) as e:
				self.cli('observe', 'list', '--jours', valeur)
			self.assertEqual(e.exception.code, 2, valeur)
		self.assertEqual(self.calls, [])

	def test_json_par_defaut_n_a_ni_observations_ni_avertissement(self):
		self.reponse = (0, json.dumps(LISTE), '')
		code, out, err = self.cli('observe', 'list', '--json')
		self.assertEqual(code, 0)
		self.assertEqual(json.loads(out), RESUME)
		self.assertNotIn('observations', json.loads(out))
		self.assertNotIn('example.com', out)
		self.assertEqual(err, '')

	# ---------- --refs : une ligne par observation, et l'avertissement ----------

	def test_refs_ecrit_chaque_observation_puis_le_total_et_avertit(self):
		self.reponse = (0, json.dumps(LISTE), '')
		code, out, err = self.cli('observe', 'list', '--refs')
		self.assertEqual(code, 0)
		lignes = out.rstrip('\n').split('\n')
		self.assertEqual(len(lignes), 4)
		for ligne, obs in zip(lignes, LISTE['observations']):
			for champ in ('ts', 'kind', 'panelType', 'ref'):
				self.assertIn(obs[champ], ligne)
		self.assertIn('3 observations', lignes[-1])
		self.assertIn('14 jours', lignes[-1])
		self.assertEqual(self.calls, [['cate', 'observe', 'list', '--jours', '14', '--refs', '--json']])
		self.assertIn('terminal-logs', err)
		self.assertIn('enregistre', err)
		self.assertIn('14 jours', err)
		self.assertIn('Tout effacer', err)
		self.assertNotIn(ADRESSE, err)

	def test_json_avec_refs_rend_la_reponse_de_cate_et_avertit(self):
		self.reponse = (0, json.dumps(LISTE), '')
		code, out, err = self.cli('observe', 'list', '--json', '--refs')
		self.assertEqual(code, 0)
		self.assertEqual(json.loads(out), LISTE)
		self.assertIn('terminal-logs', err)

	def test_refs_sans_observations_dans_la_reponse_est_un_refus(self):
		self.reponse = (0, json.dumps(RESUME), '')
		code, out, err = self.cli('observe', 'list', '--refs')
		self.assertEqual(code, 1)
		self.assertEqual(out, '')
		self.assertIn('illisible', err)

	# ---------- refus et réponses abîmées ----------

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

	def test_tolere_un_type_illisible(self):
		sale = [RESUME['types'][0], 'pas un objet', None, {'kind': 5}, {'kind': 'navigate'}, {'kind': 'x', 'panelType': 'y', 'count': 'trois'}, RESUME['types'][1]]
		self.reponse = (0, json.dumps({**RESUME, 'total': 7, 'illisibles': 1, 'types': sale}), '')
		code, out, _ = self.cli('observe', 'list')
		self.assertEqual(code, 0)
		lignes = out.rstrip('\n').split('\n')
		self.assertEqual(len(lignes), 3)
		self.assertIn('7 observations', lignes[0])
		# 1 ligne que le runtime n'a pas pu lire, 5 types de la réponse qui n'en sont pas.
		self.assertIn('6 lignes illisibles ignorées', lignes[0])

	def test_tolere_une_observation_illisible_avec_refs(self):
		sale = [LISTE['observations'][0], 'pas un objet', None, {'ts': 5}, {'ts': 'x', 'kind': 'navigate'}, 3, LISTE['observations'][1]]
		self.reponse = (0, json.dumps({**LISTE, 'total': 7, 'illisibles': 1, 'observations': sale}), '')
		code, out, _ = self.cli('observe', 'list', '--refs')
		self.assertEqual(code, 0)
		lignes = out.rstrip('\n').split('\n')
		self.assertEqual(len(lignes), 3)
		self.assertIn(ADRESSE, lignes[0])
		self.assertIn('2 observations', lignes[-1])
		# 1 ligne que le runtime n'a pas pu lire, 5 entrées de la réponse qui ne sont pas une observation.
		self.assertIn('6 lignes illisibles ignorées', lignes[-1])

	def test_une_reponse_qui_n_est_pas_un_journal_est_un_refus(self):
		for brut in ('[]', '{}', '{"types": "oui", "total": 1}', '{"types": [], "total": "un"}', '{"total": 1}', 'pas du json'):
			self.reponse = (0, brut, '')
			code, out, err = self.cli('observe', 'list')
			self.assertEqual(code, 1, brut)
			self.assertEqual(out, '', brut)
			self.assertIn('illisible', err, brut)

	# ---------- ni écriture, ni hors d'un terminal Cate ----------

	def test_n_ecrit_rien(self):
		self.cli('observe', 'list')
		self.cli('observe', 'list', '--json')
		self.reponse = (0, json.dumps(LISTE), '')
		self.cli('observe', 'list', '--refs')
		self.assertEqual(os.listdir(self.tmp), [])
		self.assertEqual(len(self.calls), 3)
		self.assertTrue(all(c[:3] == ['cate', 'observe', 'list'] for c in self.calls))

	def test_hors_d_un_terminal_cate_c_est_une_erreur_d_environnement(self):
		del os.environ['CATE_SOCKET']
		code, _, err = self.cli('observe', 'list')
		self.assertEqual(code, 2)
		self.assertIn('CATE_SOCKET', err)
		self.assertEqual(self.calls, [])

	# ---------- la doc de la commande le dit ----------

	def test_l_aide_dit_que_le_terminal_enregistre_la_sortie(self):
		out = io.StringIO()
		# argparse coupe les lignes à la largeur du terminal, et au tiret : on lit l'aide sur une seule ligne.
		with unittest.mock.patch.dict(os.environ, {'COLUMNS': '1000'}), contextlib.redirect_stdout(out), self.assertRaises(SystemExit) as e:
			agence.main(['observe', 'list', '--help'])
		self.assertEqual(e.exception.code, 0)
		aide = ' '.join(out.getvalue().split())
		self.assertIn('--refs', aide)
		self.assertIn('terminal-logs', aide)
		self.assertIn('décompte', aide)

	def test_le_mode_d_emploi_dit_le_defaut_et_l_avertissement(self):
		ligne = next(l for l in agence.__doc__.split('\n') if 'agence observe list' in l)
		self.assertIn('--refs', ligne)
		self.assertIn('décompte', ligne)
		self.assertIn('terminal-logs', ligne)


if __name__ == '__main__':
	unittest.main()
