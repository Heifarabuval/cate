#!/usr/bin/env python3
"""Règle d'économie de skills/orchestrateur/SKILL.md (spec 011, lot 6, T062). Lecture seule."""
import os
import unittest

from test_portable import REPO

SKILL = os.path.join(REPO, 'skills', 'orchestrateur', 'SKILL.md')
AVANT_LOT6 = 17420  # octets du skill au HEAD d'avant le lot 6 de 011


class RegleEconomie(unittest.TestCase):
	def setUp(self):
		with open(SKILL, encoding='utf-8') as f:
			self.texte = f.read()

	def test_rapport_de_comparer_exige_dans_une_pr_d_economie(self):
		[ligne] = [l for l in self.texte.splitlines() if 'benchmark.py comparer' in l]
		self.assertIn('économie de jetons', ligne)
		self.assertIn('PR', ligne)
		self.assertIn('annuler', ligne)

	def test_le_skill_grossit_de_2_pour_cent_au_plus(self):
		"""Règle propre à 011, plus stricte que les 5 % de 006 FR-009 : chaque octet se relit à chaque tour."""
		self.assertLessEqual(len(self.texte.encode('utf-8')), AVANT_LOT6 * 1.02)


if __name__ == '__main__':
	unittest.main()
