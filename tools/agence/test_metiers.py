#!/usr/bin/env python3
"""Catalogues des métiers et des connecteurs (spec 012, lot 1, FR-001, FR-006) : schéma, aucun secret.

Lecture des catalogues livrés et de fixtures ; les cas piégés s'écrivent en dossier temporaire.
"""
import copy
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import metiers  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures', 'metiers')


def lire(nom, dossier=FIXTURES):
	with open(os.path.join(dossier, nom)) as f:
		return json.load(f)


class Catalogue(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='metiers-test-')
		self.addCleanup(shutil.rmtree, self.tmp, True)
		self.connecteurs = lire('connecteurs.json')
		self.metiers = lire('metiers.json')

	def ecrire(self):
		for nom, contenu in (('connecteurs.json', self.connecteurs), ('metiers.json', self.metiers)):
			with open(os.path.join(self.tmp, nom), 'w') as f:
				json.dump(contenu, f)

	def refus(self, fichier, ident, champ):
		self.ecrire()
		with self.assertRaises(metiers.Invalide) as ctx:
			metiers.charger(self.tmp)
		msg = str(ctx.exception)
		for mot in (fichier, ident, champ):
			self.assertIn(mot, msg)
		return msg

	def c(self, ident):
		return next(x for x in self.connecteurs if x['id'] == ident)

	def m(self, ident):
		return next(x for x in self.metiers if x['id'] == ident)

	def test_fixtures_et_livres_valides(self):
		self.assertEqual([m['id'] for m in metiers.charger(FIXTURES)['metiers']][:3], ['dev', 'data-manager', 'chef-de-projet'])
		livre = metiers.charger(HERE)
		self.assertIn('dev', [m['id'] for m in livre['metiers']])

	# ---------- T010 : schéma (FR-001) ----------

	def test_champ_manquant(self):
		for champ in ('nom', 'explique', 'acces', 'lecture', 'ecriture'):
			with self.subTest(champ=champ):
				self.setUp()
				del self.c('factice')[champ]
				self.refus('connecteurs.json', 'factice', champ)
		for champ in ('nom', 'explique', 'connecteurs', 'panneaux', 'validateur', 'recettes'):
			with self.subTest(champ=champ):
				self.setUp()
				del self.m('data-manager')[champ]
				self.refus('metiers.json', 'data-manager', champ)

	def test_serveur_exige_pour_mcp_et_variable_pour_api(self):
		del self.c('factice')['serveur']
		self.refus('connecteurs.json', 'factice', 'serveur')
		self.setUp()
		del self.c('balises-factice')['secret']
		self.refus('connecteurs.json', 'balises-factice', 'secret')
		self.setUp()
		self.c('balises-factice')['secret'] = {'variable': 'GTM FACTICE'}
		self.refus('connecteurs.json', 'balises-factice', 'secret.variable')

	def test_acces_hors_liste(self):
		self.c('factice')['acces'] = 'ftp'
		self.refus('connecteurs.json', 'factice', 'acces')

	def test_ecriture_sur_api_ou_navigateur(self):
		for ident in ('balises-factice', 'site-factice'):
			with self.subTest(ident=ident):
				self.setUp()
				self.c(ident)['ecriture'] = ['publier']
				self.refus('connecteurs.json', ident, 'ecriture')

	def test_metier_cite_un_connecteur_inconnu(self):
		self.m('data-manager')['connecteurs'].append('inconnu')
		self.refus('metiers.json', 'data-manager', 'connecteurs')

	def test_metier_sans_preuve(self):
		self.m('data-manager')['validateur'] = []
		self.refus('metiers.json', 'data-manager', 'validateur')

	def test_preuve_de_type_inconnu(self):
		self.m('data-manager')['validateur'][0]['type'] = 'photo'
		self.refus('metiers.json', 'data-manager', 'validateur.type')

	def test_id_en_double(self):
		self.connecteurs.append(copy.deepcopy(self.c('factice')))
		self.refus('connecteurs.json', 'factice', 'id')
		self.setUp()
		self.metiers.append(copy.deepcopy(self.m('chef-de-projet')))
		self.refus('metiers.json', 'chef-de-projet', 'id')

	def test_recette_incomplete(self):
		del self.m('chef-de-projet')['recettes'][0]['declencheur']
		self.refus('metiers.json', 'chef-de-projet', 'recettes.declencheur')

	def test_panneau_de_type_inconnu(self):
		self.m('data-manager')['panneaux'][0]['type'] = 'fenetre'
		self.refus('metiers.json', 'data-manager', 'panneaux.type')

	def test_dev_seul_sans_preuve(self):
		"""dev garde la preuve de 005 : il ne déclare aucune preuve ; tout autre métier en déclare au moins une."""
		self.m('dev')['validateur'] = [{'nom': 'x', 'type': 'fichier', 'explique': 'x'}]
		self.refus('metiers.json', 'dev', 'validateur')

	# ---------- T011 : aucun secret (FR-001, FR-006) ----------

	def test_aucun_secret_dans_aucun_champ(self):
		for valeur in ('ghp_x', 'sk-x', 'AKIAX', '-----BEGIN PRIVATE KEY-----'):
			for fichier, ident, champ, pose in (
				('connecteurs.json', 'factice', 'explique', lambda v: self.c('factice').update(explique=v)),
				('connecteurs.json', 'balises-factice', 'secret.variable',
				 lambda v: self.c('balises-factice').update(secret={'variable': 'X', 'fichier': '~/' + v})),
				('metiers.json', 'data-manager', 'recettes.action',
				 lambda v: self.m('data-manager')['recettes'][0].update(action=v)),
			):
				with self.subTest(valeur=valeur, champ=champ):
					self.setUp()
					pose(valeur)
					msg = self.refus(fichier, ident, champ.split('.')[0])
					self.assertNotIn(valeur, msg)
					self.assertIn('secret', msg)

	def test_catalogues_livres_sans_secret(self):
		for nom in ('connecteurs.json', 'metiers.json'):
			with open(os.path.join(HERE, nom)) as f:
				self.assertIsNone(metiers.SECRET_RE.search(f.read()), nom)


# ---------- lot 5 : métier du cobaye et skill metier (FR-010, FR-012) ----------

SKILL = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'skills', 'metier')


class Cobaye(unittest.TestCase):
	"""T051 : le media planner (hypothèse 009 Q4, research.md du lot 0), connecteurs classés au lot 0."""

	def setUp(self):
		self.cat = metiers.charger(HERE)
		self.m = metiers.metier(self.cat, 'media-planner')

	def test_metier_livre(self):
		self.assertIsNotNone(self.m)
		self.assertEqual([p['type'] for p in self.m['validateur']], ['fichier'])
		self.assertTrue(self.m['recettes'])
		self.assertTrue(self.m['panneaux'])

	def test_regies_en_lecture_seule(self):
		c = metiers.connecteur(self.cat, 'regies-dsp')
		self.assertEqual((c['acces'], c['ecriture']), ('mcp', []))
		self.assertIn('regies-dsp', self.m['connecteurs'])

	def test_outil_qui_rend_un_jeton_jamais_autorise(self):
		"""research.md, écart 1 : l'outil qui déchiffre les jetons n'est ni lecture ni écriture déclarée : la garde le
		classe écriture (échec fermé) et aucune carte ne peut le viser (draft new refuse un outil non déclaré)."""
		c, outil, sens = metiers.classer('mcp__mcp-dsp__dsp_get_token', self.cat)
		self.assertEqual((c['id'], sens), ('regies-dsp', 'ecriture'))
		self.assertNotIn(outil, c['lecture'] + c['ecriture'])


class Skill(unittest.TestCase):
	"""T050 : le skill renvoie aux commandes au lieu de recopier le catalogue."""

	def setUp(self):
		with open(os.path.join(SKILL, 'SKILL.md'), encoding='utf-8') as f:
			self.texte = f.read()

	def test_renvoie_aux_commandes(self):
		for cmd in ('agence connecteur check', 'agence pratiques show', 'outil:'):
			self.assertIn(cmd, self.texte)

	def test_ne_recopie_aucun_id_ni_variable(self):
		cat = metiers.charger(HERE)
		fixtures = metiers.charger(FIXTURES)
		ids = {c['id'] for c in cat['connecteurs'] + fixtures['connecteurs']} | {c.get('serveur') for c in cat['connecteurs']}
		variables = {c['secret']['variable'] for c in cat['connecteurs'] + fixtures['connecteurs'] if c.get('secret')}
		for mot in sorted((ids | variables) - {None}):
			self.assertNotIn(mot, self.texte)

	def test_evals(self):
		with open(os.path.join(SKILL, 'evals.json'), encoding='utf-8') as f:
			evals = json.load(f)
		self.assertEqual(evals['skill_name'], 'metier')
		self.assertGreaterEqual(len(evals['evals']), 3)
		for e in evals['evals']:
			self.assertTrue(e['prompt'] and e['expected_output'])


if __name__ == '__main__':
	unittest.main()
