#!/usr/bin/env python3
"""Spec 013, lot 7 (T070, US7, #174) : la carte « Jeter » d'un besoin. Sans clic, aucun appel à gh ni à git worktree ;
au clic, PR fermée sans merge, worktrees du besoin retirés, fiche remise en discussion, la branche reste ; PR mergée :
refus, rien jeté. `cate`, `gh` et `git` sont simulés ; état en dossier temporaire et faux HOME."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
from test_lancer import Lancer  # noqa: E402

WT = '/tmp/depot/.cate/worktrees/n1-impl'


class Jeter(Lancer):
	def setUp(self):
		super().setUp()
		self.fiches(('A', ['src/a.ts']))
		self.assertEqual(self.clic('F1'), (303, '/'))
		self.assertEqual(self.cli('need', 'pr', 'n1', '12')[0], 0)
		self.run.reply(['gh', 'repo', 'view'], 'o/r')
		self.run.reply(['git', '-C', self.tmp, 'worktree', 'list'],
		               f'worktree {self.tmp}\nHEAD a\nbranch refs/heads/main\n\nworktree {WT}\nHEAD b\nbranch refs/heads/feat/a\n')
		self.run.reply(['gh', 'pr', 'view'], {'state': 'OPEN'})
		self.run.calls.clear()

	def carte(self):
		self.assertEqual(self.cli('need', 'jeter', 'n1')[0], 0)
		return next(q for q in self.state()['questions'] if q['question'].startswith('Jeter'))

	def jetees(self):
		return self.run.ran('gh', 'pr', 'close') + [c for c in self.run.ran('git') if 'remove' in c]

	def test_carte_sans_clic_aucun_appel(self):
		q = self.carte()
		self.assertEqual([o['label'] for o in q['options']], ['Jeter', 'Garder'])
		self.assertEqual(q['clics'], ['/besoin/n1/jeter', ''])
		for mot in ('#12', 'F1', 'discussion', 'branche'):
			self.assertIn(mot, q['question'])
		self.assertEqual(self.run.ran('gh'), [])
		self.assertEqual([c for c in self.run.ran('git') if 'worktree' in c], [])
		self.assertEqual(self.backlog()['F1']['etat'], 'lancée')

	def test_clic_ferme_la_pr_retire_le_worktree_fiche_en_discussion(self):
		self.assertEqual(self.repond(self.carte(), 'Jeter'), (303, '/'))
		self.assertEqual(self.run.ran('gh', 'pr', 'close'), [['gh', 'pr', 'close', '12', '-R', 'o/r']])
		self.assertEqual([c for c in self.run.ran('git') if 'remove' in c],
		                 [['git', '-C', self.tmp, 'worktree', 'remove', '--force', WT]])
		self.assertEqual(self.run.ran('git', 'branch'), [])  # la branche reste
		f = self.backlog()['F1']
		self.assertEqual((f['etat'], f['besoin']), ('discussion', None))
		n = agence.find(self.state(), 'needs', 'n1')
		self.assertEqual(n['status'], 'dropped')
		self.assertEqual([q for q in self.state()['questions'] if q['answer'] is None], [])
		self.un_tour()
		self.assertEqual(self.backlog()['F1']['etat'], 'discussion')  # le tour ne la remet pas prête

	def test_pr_mergee_refus_rien_jete(self):
		self.run.reply(['gh', 'pr', 'view'], {'state': 'MERGED'})
		code, msg = self.repond(self.carte(), 'Jeter')
		self.assertEqual(code, 409)
		self.assertIn('mergée', msg)
		self.assertEqual(self.jetees(), [])
		self.assertEqual(self.backlog()['F1']['etat'], 'lancée')
		self.assertEqual(agence.find(self.state(), 'needs', 'n1')['status'], 'open')

	def test_garder_ferme_la_carte_sans_rien_jeter(self):
		self.assertEqual(self.repond(self.carte(), 'Garder'), (303, '/'))
		self.assertEqual(self.run.ran('gh'), [])
		self.assertEqual(self.jetees(), [])
		self.assertEqual(self.backlog()['F1']['etat'], 'lancée')

	def test_post_sans_carte_refuse(self):
		self.assertEqual(agence.click('/besoin/n1/jeter', {})[0], 409)
		self.assertEqual(self.run.ran('gh'), [])
		self.assertEqual(self.jetees(), [])

	def test_besoin_ferme_aucune_carte(self):
		self.cli('need', 'drop', 'n1')
		code, _ = self.cli('need', 'jeter', 'n1')
		self.assertEqual(code, 1)

	def repond(self, q, label):
		return agence.click(f"/ask/{q['id']}", {'choice': [str([o['label'] for o in q['options']].index(label))]})


if __name__ == '__main__':
	unittest.main()
