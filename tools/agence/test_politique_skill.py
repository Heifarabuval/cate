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


class Politique(unittest.TestCase):
	"""Spec 005, lot 4, T060 : le skill lit la politique (agence pratiques) au lieu de réécrire un flux en dur."""

	def setUp(self):
		with open(SKILL, encoding='utf-8') as f:
			self.texte = f.read()

	def test_a_cite_show_et_brief(self):
		self.assertIn('agence pratiques show', self.texte)
		self.assertIn('agence pratiques brief', self.texte)

	def test_b_aucun_flux_personnel(self):
		for chaine in ('Hermes', 'Sonnet', '--rebase', 'un vérificateur différent par implémenteur'):
			with self.subTest(chaine=chaine):
				self.assertNotIn(chaine, self.texte)

	def test_c_condition_de_fin_renvoie_a_la_politique(self):
		lignes = [l for l in self.texte.splitlines() if 'ondition de fin' in l and '--done-when' in l]
		self.assertTrue(lignes, 'ligne de la condition de fin absente')
		for l in lignes:
			self.assertIn('agence pratiques show', l)
		self.assertNotRegex(self.texte, r'(pr-merged|issue-closed|ci-green):N')

	def test_c_need_pr_rattache_la_pr(self):
		self.assertRegex(self.texte, r'agence need pr <besoin> <N>')

	def test_c_phrases_conditionnelles(self):
		for cle in ('livraison.mode', 'livraison.merge', 'verification', 'agents.max'):
			with self.subTest(cle=cle):
				self.assertIn(f'`{cle}`', self.texte)

	def test_d_invariants_gardes(self):
		self.assertIn('Jamais de merge, push sur `main`, force-push', self.texte)
		self.assertIn('jamais deux implémenteurs sur le même fichier', self.texte)


if __name__ == '__main__':
	unittest.main()
