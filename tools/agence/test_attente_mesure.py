"""Tests de attente_mesure.py : coût en jetons de l'attente d'un orchestrateur (spec 006, lot 1).

Lancer : python3 -m unittest tools/agence/test_attente_mesure.py
Lecture seule : la fixture est copiée dans un dossier temporaire, jamais dans ~/.claude.
"""
import hashlib
import json
import os
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


if __name__ == '__main__':
	unittest.main()
