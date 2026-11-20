#!/usr/bin/env python3
"""Ce que skills/orchestrateur/SKILL.md dit de la politique de lancement (spec 010, lot 4, T064). Lecture seule."""
import os
import re
import unittest

from test_portable import ADRESSE_FORK, PERSONNEL, REPO

SKILL = os.path.join(REPO, 'skills', 'orchestrateur', 'SKILL.md')


class Lancer(unittest.TestCase):
	"""T064 : une section « Lancer » : lire le message, lancer la vague telle quelle, ne reposer aucune question
	couverte par le brief, `agence fiche brief` en cas de doute."""

	def setUp(self):
		with open(SKILL, encoding='utf-8') as f:
			texte = f.read()
		m = re.search(r'^## Lancer\b.*?(?=^## |\Z)', texte, re.M | re.S)
		self.assertIsNotNone(m, 'section « ## Lancer » absente')
		self.section = m.group(0)

	def test_dit_le_contrat(self):
		texte = self.section.lower()
		for attendu in ('lis le message', 'telle quelle', 'agence fiche brief', 'agence need panel'):
			with self.subTest(attendu=attendu):
				self.assertIn(attendu, texte)
		self.assertRegex(texte, r'ne reposes? aucune question[^.]*brief')

	def test_rien_ne_part_sans_le_clic(self):
		self.assertIn('clic', self.section)
		self.assertIn('fiche', self.section)

	def test_aucun_nom_ni_chemin_personnel_ni_tiret_long(self):
		self.assertEqual([l for l in self.section.splitlines() if PERSONNEL.search(ADRESSE_FORK.sub('', l))], [])
		self.assertNotIn(chr(0x2014), self.section)


if __name__ == '__main__':
	unittest.main()
