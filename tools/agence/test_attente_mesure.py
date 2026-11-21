"""Tests de attente_mesure.py : coût en jetons de l'attente d'un orchestrateur (spec 006, lot 1).

Lancer : python3 -m unittest tools/agence/test_attente_mesure.py
Lecture seule : la fixture est copiée dans un dossier temporaire, jamais dans ~/.claude.
"""
import calendar
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'attente_mesure.py')
FIXTURE = os.path.join(HERE, 'fixtures', 'attente')
SID = 'aaaaaaaa-0000-0000-0000-000000000001'


def run(*args, stdin=None):
	return subprocess.run(
		[sys.executable, '-I', SCRIPT, *args],
		input=stdin, capture_output=True, text=True, timeout=30
	)


class AttenteMesure(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp()
		self.addCleanup(shutil.rmtree, self.tmp)
		self.dossier = os.path.join(self.tmp, 'sessions')
		os.mkdir(self.dossier)
		self.journal = os.path.join(self.dossier, SID + '.jsonl')
		shutil.copy(os.path.join(FIXTURE, 'journal.jsonl'), self.journal)

	def usage(self, *panels):
		path = os.path.join(self.tmp, 'usage.json')
		with open(path, 'w') as f:
			json.dump(list(panels), f)
		return path

	def test_a_sortie_egale_attendu(self):
		r = run(self.dossier, '--json')
		self.assertEqual(r.returncode, 0, r.stderr)
		with open(os.path.join(FIXTURE, 'attendu.json')) as f:
			self.assertEqual(json.loads(r.stdout), json.load(f))

	def test_b_aucun_texte_du_journal_en_sortie(self):
		for args in (['--json'], []):
			out = run(self.dossier, *args).stdout
			self.assertNotIn('MARQUEUR', out)
			self.assertNotIn(SID, out)
			self.assertNotIn(self.tmp, out)

	def test_c_autre_agent_non_mesure(self):
		usage = self.usage({'agentId': 'codex', 'sessionIds': [SID]})
		r = run(self.dossier, '--usage-json', usage)
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertIn('non mesuré', r.stdout)
		j = json.loads(run(self.dossier, '--usage-json', usage, '--json').stdout)
		self.assertEqual(j['sessions'], {'lues': 0, 'non_lues': 0, 'non_mesurees': 1})
		self.assertEqual(j['tours'], 0)

	def test_d_journal_absent_compte_sans_chemin(self):
		absent = 'bbbbbbbb-0000-0000-0000-000000000002'
		usage = self.usage({'agentId': 'claude-code', 'sessionIds': [SID, absent]})
		r = run(self.dossier, '--usage-json', usage, '--json')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(json.loads(r.stdout)['sessions'], {'lues': 1, 'non_lues': 1, 'non_mesurees': 0})
		self.assertNotIn(absent, r.stdout)
		self.assertNotIn(self.tmp, r.stdout)

	def test_e_deux_lancements_identiques(self):
		self.assertEqual(run(self.dossier, '--json').stdout, run(self.dossier, '--json').stdout)
		self.assertEqual(run(self.dossier).stdout, run(self.dossier).stdout)

	def test_f_chemin_hors_du_dossier_refuse(self):
		dehors = os.path.join(self.tmp, 'dehors.jsonl')
		shutil.copy(self.journal, dehors)
		os.symlink(dehors, os.path.join(self.dossier, 'lien.jsonl'))
		for sid in ('../dehors', 'lien'):
			usage = self.usage({'agentId': 'claude-code', 'sessionIds': [sid]})
			r = run(self.dossier, '--usage-json', usage)
			self.assertEqual(r.returncode, 2, sid)
			self.assertIn('refusé', r.stderr)
			self.assertNotIn(self.tmp, r.stdout + r.stderr)
		# sans liste d'ids : le lien est refusé aussi
		r = run(self.dossier)
		self.assertEqual((r.returncode, 'refusé' in r.stderr), (2, True))

	def test_g_journal_non_modifie(self):
		def empreinte():
			with open(self.journal, 'rb') as f:
				return hashlib.sha256(f.read()).hexdigest(), os.stat(self.journal).st_mtime_ns
		avant = empreinte()
		run(self.dossier, '--json')
		self.assertEqual(empreinte(), avant)

	def test_h_causes_agent_et_autre(self):
		lignes = [
			{'type': 'user', 'message': {'content': 'saisie'}},
			{'type': 'assistant', 'message': {'id': 'x1', 'content': [], 'usage': {'cache_read_input_tokens': 10}}},
			{'type': 'user', 'message': {'content': '<task-notification> <task-id>1</task-id>'}},
			{'type': 'assistant', 'message': {'id': 'x2', 'content': [], 'usage': {'cache_read_input_tokens': 20}}},
			{'type': 'user', 'message': {'content': 'Another Claude session sent a message'}},
			{'type': 'assistant', 'message': {'id': 'x3', 'content': [], 'usage': {'cache_read_input_tokens': 30}}}
		]
		with open(os.path.join(self.dossier, 'cccccccc.jsonl'), 'w') as f:
			f.write(''.join(json.dumps(x) + '\n' for x in lignes))
		os.remove(self.journal)
		j = json.loads(run(self.dossier, '--json').stdout)
		self.assertEqual(j['causes']['autre'], {'tours': 1, 'jetons_lus': 10})
		self.assertEqual(j['causes']['agent'], {'tours': 2, 'jetons_lus': 50})


# Lot 011-L1 : jetons par poste, plusieurs dossiers, interventions (fixtures fixtures/bench/)
BENCH = os.path.join(HERE, 'fixtures', 'bench')
POSTES = ('jetons_entree', 'jetons_cache_cree', 'jetons_lus', 'jetons_sortie', 'jetons_total')
NU = {'tours': 6, 'jetons_entree': 25, 'jetons_cache_cree': 185, 'jetons_lus': 7150, 'jetons_sortie': 33, 'jetons_total': 7393}
OUTIL = {'tours': 7, 'jetons_entree': 23, 'jetons_cache_cree': 195, 'jetons_lus': 4850, 'jetons_sortie': 37, 'jetons_total': 5105}
PROJ = '-Users-x-proj'


def charger():
	spec = importlib.util.spec_from_file_location('attente_mesure', SCRIPT)
	mod = importlib.util.module_from_spec(spec)
	spec.loader.exec_module(mod)
	return mod


def t(hms):
	h, m, s = (int(x) for x in hms.split(':'))
	return float(calendar.timegm((2026, 1, 1, h, m, s)))


def postes(res):
	return {k: res[k] for k in ('tours',) + POSTES}


class Bench(unittest.TestCase):
	def setUp(self):
		self.am = charger()
		self.nu = os.path.join(BENCH, 'nu')
		self.outil = [os.path.join(BENCH, 'outil', d) for d in (PROJ, PROJ + '--cate-worktrees-w1')]

	def test_i_jetons_par_poste_nu(self):
		self.assertEqual(postes(self.am.mesurer([self.nu])), NU)  # le doublon a1/a4 n'est compté qu'une fois

	def test_i_jetons_par_poste_outil(self):
		self.assertEqual(postes(self.am.mesurer(self.outil)), OUTIL)

	def test_i_cli_postes_json(self):
		r = run(self.nu, '--json', '--postes')
		self.assertEqual(r.returncode, 0, r.stderr)
		self.assertEqual(postes(json.loads(r.stdout)), NU)
		self.assertNotIn('MARQUEUR', r.stdout)

	def test_i_sortie_par_defaut_inchangee(self):
		j = json.loads(run(self.nu, '--json').stdout)
		self.assertFalse(set(POSTES[:2] + POSTES[4:]) & set(j))

	def test_j_plusieurs_dossiers_somme(self):
		a, b = (self.am.mesurer([d]) for d in self.outil)
		tous = self.am.mesurer(self.outil)
		for k in ('tours', 'jetons_entree', 'jetons_cache_cree', 'jetons_lus', 'jetons_sortie', 'jetons_total'):
			self.assertEqual(tous[k], a[k] + b[k], k)
		self.assertEqual(tous['sessions']['lues'], 3)

	def test_j_prefixe_prend_clone_et_worktrees_seulement(self):
		with tempfile.TemporaryDirectory() as base:
			for d in os.listdir(os.path.join(BENCH, 'outil')):
				shutil.copytree(os.path.join(BENCH, 'outil', d), os.path.join(base, d))
			for voisin in (PROJ + 'et', 'x' + PROJ):
				shutil.copytree(os.path.join(BENCH, 'outil', PROJ), os.path.join(base, voisin))
			pris = self.am.dossiers_du_prefixe(base, PROJ)
			self.assertEqual([os.path.basename(p) for p in pris], [PROJ, PROJ + '--cate-worktrees-w1'])
			self.assertEqual(postes(self.am.mesurer(pris)), OUTIL)
			r = run(base, '--prefixe=' + PROJ, '--json', '--postes')
			self.assertEqual((r.returncode, postes(json.loads(r.stdout))), (0, OUTIL))

	def test_k_interventions_outil(self):
		chemins = self.am.journaux(self.outil)
		self.assertEqual(self.am.interventions(chemins), [
			(t('11:00:00'), 'humain'), (t('11:00:05'), 'systeme'), (t('11:00:08'), 'systeme'),
			(t('11:00:10'), 'systeme'), (t('11:00:20'), 'humain'), (t('11:09:50'), 'systeme'),
			(t('11:09:55'), 'systeme'), (t('11:10:00'), 'machine'), (t('11:10:05'), 'systeme'),
			(t('11:10:30'), 'machine'), (t('11:12:00'), 'humain'), (t('11:12:05'), 'systeme'),
			(t('12:00:00'), 'humain'), (t('12:00:05'), 'systeme')
		])

	def test_k_rapport_d_agent_humain_sans_le_journal_de_l_agent(self):
		# la reconnaissance vient de l'autre journal : sans lui, le même message reste humain
		orch = [os.path.join(self.outil[0], 'orch.jsonl')]
		kinds = [k for _, k in self.am.interventions(orch)]
		self.assertEqual((kinds.count('machine'), kinds.count('humain')), (1, 3))  # task-notification seule

	def test_k_nu_et_aucun_texte(self):
		iv = self.am.interventions(self.am.journaux([self.nu]))
		self.assertEqual([k for _, k in iv].count('humain'), 3)
		self.assertEqual([k for _, k in iv].count('systeme'), 7)  # 6 tours, doublon exclu, + 1 tool_result
		self.assertNotIn('MARQUEUR', repr(iv))
		for inst, kind in iv:
			self.assertIsInstance(inst, float)
			self.assertIn(kind, ('humain', 'machine', 'systeme'))

	def test_l_zero_modele_ni_reseau(self):
		for mod in ('urllib.request', 'http.client', 'socket'):
			with open(SCRIPT, encoding='utf-8') as f:
				self.assertNotRegex(f.read(), r'(?m)^\s*(import|from)\s+' + re.escape(mod))
		with tempfile.TemporaryDirectory() as tmp:
			bin_ = os.path.join(tmp, 'bin')
			os.mkdir(bin_)
			temoin = os.path.join(tmp, 'temoin')
			for nom in ('claude', 'curl'):
				p = os.path.join(bin_, nom)
				with open(p, 'w') as f:
					f.write('#!/bin/sh\ntouch %s\nexit 1\n' % temoin)
				os.chmod(p, 0o755)
			env = dict(os.environ, PATH=bin_ + os.pathsep + os.environ['PATH'])
			r = subprocess.run([sys.executable, '-I', SCRIPT, self.nu, '--json', '--postes'], env=env, capture_output=True, text=True, timeout=30)
			self.assertEqual(r.returncode, 0, r.stderr)
			self.assertFalse(os.path.exists(temoin))


if __name__ == '__main__':
	unittest.main()
