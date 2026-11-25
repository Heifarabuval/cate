#!/usr/bin/env python3
"""Spec 015, FR-020 et FR-022 à FR-024 : la détection automatique pose une carte « Ajuster le setup ? » ; seul le clic ouvre l'agent.
`cate` et `local-llm` sont simulés (FakeRun) ; faux HOME (Base)."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
import detection  # noqa: E402
import pratiques  # noqa: E402
from test_agence import Base  # noqa: E402
from test_portable import REPO  # noqa: E402

CLES = {'agents.max': 'Agents en même temps', 'verification': 'Relecture', 'livraison.mode': 'Comment le travail vous arrive'}
PHRASE = 'mets le plafond à 2'


class Regle(unittest.TestCase):
	"""decider : règle déterministe sur le texte seul ; oui, ambigu (un mot de réglage sans mot de changement) ou non."""

	def test_un_changement_de_reglage_est_un_signal(self):
		for texte in (PHRASE, 'ajoute un relecteur', 'passe à 2 agents en même temps', 'ce projet sert aussi au SEO',
		              'Désactive la relecture', 'agents.max à 3', 'baisse le PLAFOND'):
			with self.subTest(texte):
				self.assertEqual(detection.decider(texte, CLES), 'oui')

	def test_ni_reglage_ni_changement_ne_pose_rien(self):
		for texte in ('bonjour', 'merci, parfait', 'mets-moi un café', 'le plafond de verre', '', '   '):
			with self.subTest(texte):
				self.assertNotEqual(detection.decider(texte, CLES), 'oui')

	def test_un_mot_de_reglage_seul_est_ambigu(self):
		self.assertEqual(detection.decider('le plafond me gêne', CLES), 'ambigu')

	def test_un_mot_de_changement_seul_n_est_pas_un_signal(self):
		self.assertEqual(detection.decider('mets ça de côté', CLES), 'non')

	def test_la_forme_ne_compte_pas(self):
		self.assertEqual(detection.normaliser('  Mets, le PLAFOND  à 2 !  '), detection.normaliser('mets le plafond à 2'))
		self.assertEqual(detection.normaliser('Désactive'), detection.normaliser('desactive'))


class Cartes(Base):
	"""`agence setup --detecte` : une carte au plus, au clic seulement l'ouverture, aucune écriture."""

	def setUp(self):
		super().setUp()
		self.booted()
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'title': 'Agence', 'type': 'agence'}])

	def detecte(self, texte, *plus):
		return self.cli('setup', '--detecte', texte, *plus)

	def cartes(self):
		return [q for q in self.state()['questions'] if q.get('setup') == 'ajuster']

	def demarrages(self):
		return self.run.ran('cate', 'agent', 'start')

	def clic(self, qid, choix):
		return agence.click(f'/ask/{qid}', {'choice': [str(choix)]})

	def test_mets_le_plafond_a_2_pose_une_carte_avec_ses_deux_options(self):
		code, out = self.detecte(PHRASE)
		self.assertEqual(code, 0)
		(q,) = self.cartes()
		self.assertEqual([o['label'] for o in q['options']], ['Ouvrir avec la phrase', 'Ignorer'])
		self.assertIn(PHRASE, q['question'])
		self.assertEqual(q['phrase'], PHRASE)
		self.assertIn(q['id'], out)

	def test_bonjour_ne_pose_rien(self):
		self.assertEqual(self.detecte('bonjour')[0], 0)
		self.assertEqual(self.cartes(), [])

	def test_la_carte_n_ouvre_et_n_ecrit_rien(self):
		avant = self.state()['pratiques']
		self.detecte(PHRASE)
		self.assertEqual(self.demarrages(), [])
		self.assertNotIn('setup', self.state()['panels'])
		self.assertEqual(self.state()['pratiques'], avant)
		for f in (pratiques.fichier_projet(self.tmp), os.path.join(self.tmp, '.cate', 'tmp', 'agence', 'setup.json'),
		          os.path.join(self.tmp, '.cate', 'org.json')):
			self.assertFalse(os.path.exists(f), f)

	def test_deux_fois_la_meme_phrase_une_seule_carte_meme_ignoree(self):
		self.detecte(PHRASE)
		self.detecte('  Mets le PLAFOND à 2 ! ')  # même phrase, autre forme
		self.assertEqual(len(self.cartes()), 1)
		self.clic(self.cartes()[0]['id'], 1)
		self.detecte(PHRASE)
		self.assertEqual(len(self.cartes()), 1)

	def test_une_seule_carte_ouverte_a_la_fois(self):
		self.detecte(PHRASE)
		self.detecte('ajoute un relecteur')
		self.assertEqual(len(self.cartes()), 1)
		self.clic(self.cartes()[0]['id'], 1)
		self.detecte('ajoute un relecteur')
		self.assertEqual(len(self.cartes()), 2)

	def test_trois_cartes_par_heure_au_plus(self):
		for phrase in ('mets le plafond à 2', 'ajoute un relecteur', 'passe la livraison en PR', 'active la relecture'):
			self.detecte(phrase)
			ouvertes = [q for q in self.cartes() if q['answer'] is None]
			for q in ouvertes:
				self.clic(q['id'], 1)
		self.assertEqual(len(self.cartes()), 3)

	def test_ignorer_n_ouvre_rien(self):
		self.detecte(PHRASE)
		qid = self.cartes()[0]['id']
		code, _ = self.clic(qid, 1)
		self.assertEqual(code, 303)
		self.assertEqual(self.cartes()[0]['answer'], 'Ignorer')
		self.assertEqual(self.demarrages(), [])
		self.assertNotIn('setup', self.state()['panels'])

	def test_ouvrir_lance_le_setup_avec_la_phrase_et_ferme_la_carte(self):
		self.detecte(PHRASE)
		qid = self.cartes()[0]['id']
		code, _ = self.clic(qid, 0)
		self.assertEqual(code, 303)
		(cmd,) = self.demarrages()
		self.assertEqual(cmd[-2], f'/setup {PHRASE}')
		self.assertEqual(self.state()['panels']['setup'], 'p1')
		self.assertEqual(self.cartes()[0]['answer'], 'Ouvrir avec la phrase')

	def test_ouvrir_n_ecrit_aucun_reglage(self):
		self.detecte(PHRASE)
		self.clic(self.cartes()[0]['id'], 0)
		self.assertFalse(os.path.exists(pratiques.fichier_projet(self.tmp)))
		self.assertFalse(os.path.exists(os.path.join(self.tmp, '.cate', 'tmp', 'agence', 'setup.json')))

	def test_un_clic_rejoue_ou_nu_n_ouvre_rien(self):
		self.detecte(PHRASE)
		qid = self.cartes()[0]['id']
		self.clic(qid, 1)
		code, _ = agence.click(f'/setup/{qid}/ouvrir', {})  # POST nu sur une carte déjà répondue
		self.assertEqual(code, 409)
		code, _ = agence.click('/setup/q999/ouvrir', {})
		self.assertIn(code, (404, 409))
		self.assertEqual(self.demarrages(), [])

	def test_une_phrase_qui_ressemble_a_un_secret_ne_pose_rien(self):
		self.detecte('mets le plafond à 2 avec ' + 'xo' + 'xb-1234567890-abcdef')
		self.assertEqual(self.cartes(), [])



class Departage(Base):
	"""Texte ambigu : Qwen local départage ; sans lui, pas de carte. Un texte tranché par la règle ne l'appelle pas."""

	def setUp(self):
		super().setUp()
		self.booted()

	def cartes(self):
		return [q for q in self.state()['questions'] if q.get('setup') == 'ajuster']

	def appels(self):
		return self.run.ran('local-llm')

	def test_oui_de_qwen_pose_la_carte(self):
		self.run.reply(['local-llm'], 'OUI')
		self.cli('setup', '--detecte', 'le plafond me gêne')
		self.assertEqual(len(self.appels()), 1)
		self.assertEqual(len(self.cartes()), 1)

	def test_tout_autre_resultat_ne_pose_rien(self):
		for nom, code, out in (('non', 0, 'NON'), ('vide', 0, ''), ('erreur', 1, 'OUI'), ('bavard', 0, 'Peut-être OUI')):
			with self.subTest(nom):
				self.run.reply(['local-llm'], out, code=code)
				self.cli('setup', '--detecte', f'le plafond me gêne {nom}')
		self.assertEqual(self.cartes(), [])

	def test_modele_absent_ne_pose_rien(self):
		def absent(cmd, input=None, timeout=None):
			if cmd[0] == 'local-llm':
				return 127, '', 'introuvable'  # ce que rend _run quand le binaire manque
			return self.run(cmd, input, timeout)
		agence.RUN = absent  # tearDown remet le faux de Base
		code, _ = self.cli('setup', '--detecte', 'le plafond me gêne')
		self.assertEqual(code, 0)
		self.assertEqual(self.cartes(), [])

	def test_la_regle_tranche_sans_modele(self):
		self.cli('setup', '--detecte', PHRASE)
		self.cli('setup', '--detecte', 'bonjour')
		self.assertEqual(self.appels(), [])


class Evenements(Base):
	"""Un événement compte à sa deuxième occurrence en 24 h ; une réponse d'ask passe par la même règle."""

	def setUp(self):
		super().setUp()
		self.booted()

	def cartes(self):
		return [q for q in self.state()['questions'] if q.get('setup') == 'ajuster']

	def evenement(self, genre, texte):
		with agence.tx() as st:
			return agence.evenement(st, genre, texte)

	def test_le_premier_ne_pose_rien_le_second_pose_une_carte(self):
		self.assertIsNone(self.evenement('plafond', 'le plafond d\'agents est atteint'))
		self.assertEqual(self.cartes(), [])
		self.assertIsNotNone(self.evenement('plafond', 'le plafond d\'agents est atteint'))
		(q,) = self.cartes()
		self.assertEqual([o['label'] for o in q['options']], ['Ouvrir avec la phrase', 'Ignorer'])

	def test_deux_genres_ne_se_cumulent_pas(self):
		self.evenement('plafond', 'le plafond d\'agents est atteint')
		self.evenement('merge', 'un merge est refusé')
		self.assertEqual(self.cartes(), [])

	def test_la_meme_phrase_ne_repose_pas_de_carte(self):
		for _ in range(4):
			self.evenement('plafond', 'le plafond d\'agents est atteint')
		self.assertEqual(len(self.cartes()), 1)

	def test_le_plafond_atteint_deux_fois_au_tour_du_regisseur_pose_la_carte(self):
		def tick(n):
			rows = [{'panelId': f'a{i}', 'state': 'running', 'canReceivePrompt': True} for i in range(n)]
			with agence.tx() as st:
				agence.tick(st, {'o1'}, rows, {}, 1000.0)
		for n in (4, 4, 3):  # atteint (4 sur 4), toujours atteint : une seule occurrence
			tick(n)
		self.assertEqual(self.cartes(), [])
		tick(4)  # atteint de nouveau : deuxième occurrence
		self.assertEqual(len(self.cartes()), 1)

	def test_une_reponse_d_ask_sans_mot_de_changement_ne_pose_rien(self):
		with agence.tx() as st:
			qid = agence.poser_carte(st, 'Combien d\'agents en même temps ?', [{'label': '2', 'detail': 'a'}, {'label': '4', 'detail': 'b'}], [])
			st['questions'][-1].pop('clics')
		agence.click(f'/ask/{qid}', {'choice': ['0']})
		self.assertEqual(self.cartes(), [])

	def test_une_reponse_libre_qui_change_un_reglage_pose_une_carte(self):
		with agence.tx() as st:
			qid = agence.poser_carte(st, 'Quel plafond ?', [{'label': 'a', 'detail': 'a'}], [])
			st['questions'][-1].pop('clics')
		agence.click(f'/ask/{qid}', {'libre': [PHRASE]})
		(carte,) = self.cartes()
		self.assertEqual(carte['phrase'], PHRASE)

	def test_deux_pr_fermees_sans_merge_posent_la_carte(self):
		with agence.tx() as st:
			agence.add_need(st, 'pr', 'Une PR', ref='12', panels=['a1'])
			agence.add_need(st, 'pr', 'Une autre PR', ref='13', panels=['a2'])
		for ref in ('12', '13'):
			with agence.tx() as st:
				agence.tick(st, {'o1', 'a1', 'a2'}, [], {ref: {'state': 'CLOSED'}}, 1000.0)
		self.assertEqual(len(self.cartes()), 1)

	def test_un_merge_refuse_compte_comme_un_evenement(self):
		for _ in range(2):
			with agence.tx() as st:
				qid = agence.poser_carte(st, 'Merger la PR 12 ?', [{'label': 'Merger', 'detail': 'x'}, {'label': 'Non', 'detail': 'y'}], [])
				st['questions'][-1].pop('clics')
				st['questions'][-1]['action'] = 'merge:o/r#12'
			agence.click(f'/ask/{qid}', {'choice': ['1']})
		self.assertEqual(len(self.cartes()), 1)


if __name__ == '__main__':
	unittest.main()
