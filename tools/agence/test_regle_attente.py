#!/usr/bin/env python3
"""Règle d'attente de skills/orchestrateur/SKILL.md (spec 006, lot 3, T020). Lecture seule."""
import os
import re
import unittest

from test_portable import ADRESSE_FORK, PERSONNEL, REPO

SKILL = os.path.join(REPO, 'skills', 'orchestrateur', 'SKILL.md')
# 006 FR-009 : 105 % de 13 936 octets = 14 632. Relevé de l'ajout des lots passés avant sur ce fichier
# (spec 009 T011) : 010-L4 et 4c5b8954, 13 936 -> 15 598, soit + 1 662 ; 005-L4, 16 291 -> 16 742, soit + 451 ;
# 013-L1 (jauge de contexte), 16 742 -> 16 874, soit + 132 ; 010-L8 (lentille sur clic), 16 874 -> 17 348, soit + 474 ;
# 008-L2 (options ponctuelles, réglages du workspace), 17 348 -> 17 420, soit + 72 ; 011-L6 (règle d'économie),
# 17 420 -> 17 594, soit + 174.
PLAFOND = 14632 + 1662 + 451 + 132 + 474 + 72 + 174


class RegleAttente(unittest.TestCase):
	def setUp(self):
		with open(SKILL, encoding='utf-8') as f:
			self.texte = f.read()
		m = re.search(r'^\d+\. Suis\b.*$', self.texte, re.M)
		self.assertIsNotNone(m, 'étape « Suis » absente')
		self.suis = m.group(0)

	def test_a_plus_d_attente_a_60_s(self):
		self.assertNotRegex(self.texte, r'--wait-timeout 60000(?!0)')

	def test_b_filet_en_fond_lance_apres_un_rapport(self):
		self.assertIn('--wait-timeout 600000', self.suis)
		self.assertIn('run_in_background', self.suis)
		# Sonde T011 : lancé juste après un envoi, `cate agent wait` sort en 5 s et coûte un tour.
		self.assertIn('jamais juste après un envoi', self.suis)

	def test_c_fin_de_tour_et_rapports_par_send(self):
		self.assertIn('termine ton tour', self.suis)
		self.assertIn('cate agent send', self.suis)
		self.assertIn('cate agent list', self.suis)
		self.assertIn('cate agent read', self.suis)

	def test_d_regle_goal_sans_cause_non_reproduite(self):
		lignes = [l for l in self.texte.splitlines() if '/goal' in l]
		self.assertTrue(any('clic' in l and 'merge' in l and 'agent' in l for l in lignes), lignes)
		self.assertNotIn('chaque fin de tour redevient', self.texte)

	def test_mesure_citee(self):
		self.assertIn('attente_mesure.py', self.texte)

	def test_e_aucune_valeur_propre_a_un_dev(self):
		self.assertEqual([l for l in self.texte.splitlines() if PERSONNEL.search(ADRESSE_FORK.sub('', l))], [])
		self.assertNotRegex(self.texte, r'claude-(opus|sonnet|haiku|fable)')
		self.assertNotIn(chr(0x2014), self.texte)

	def test_f_taille(self):
		self.assertLessEqual(len(self.texte.encode('utf-8')), PLAFOND)


if __name__ == '__main__':
	unittest.main()
