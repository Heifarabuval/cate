#!/usr/bin/env python3
"""Connecteurs (spec 012) : classement d'un outil MCP (lot 2, FR-003), carte d'écriture `agence draft new --cible
outil:` (lot 2, FR-004).

Catalogues de fixture (AGENCE_CATALOGUES), faux HOME, dossier temporaire ; `cate` simulé par FakeRun.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
import metiers  # noqa: E402
import pratiques  # noqa: E402
from test_agence import FakeRun  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures', 'metiers')


class Classement(unittest.TestCase):
	"""T020 : code pur."""

	def setUp(self):
		self.cat = metiers.charger(FIXTURES)

	def classe(self, outil):
		r = metiers.classer(outil, self.cat)
		return r and (r[0]['id'], r[1], r[2])

	def test_lecture_ecriture_et_echec_ferme(self):
		self.assertEqual(self.classe('mcp__factice__lire'), ('factice', 'lire', 'lecture'))
		self.assertEqual(self.classe('mcp__factice__ecrire'), ('factice', 'ecrire', 'ecriture'))
		self.assertEqual(self.classe('mcp__factice__autre'), ('factice', 'autre', 'ecriture'))
		self.assertEqual(self.classe('mcp__tableur-factice__lire_valeurs'), ('tableur-factice', 'lire_valeurs', 'lecture'))

	def test_hors_perimetre(self):
		for outil in ('mcp__inconnu__x', 'Bash', 'mcp__factice', 'mcp__facticex__lire', 'mcp__claude_ai_Gmail__send_message'):
			with self.subTest(outil=outil):
				self.assertIsNone(metiers.classer(outil, self.cat))

	def test_serveurs_mcp(self):
		self.assertEqual(metiers.serveurs(self.cat), ['factice', 'messagerie-factice', 'tableur-factice'])
		self.assertEqual(metiers.serveurs({'connecteurs': [], 'metiers': []}), [])

	def test_canonique(self):
		self.assertEqual(metiers.canonique({'b': 1, 'a': 'é'}), '{"a":"é","b":1}')


class Base(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='connecteurs-test-')
		self.addCleanup(shutil.rmtree, self.tmp, True)
		self.home = os.path.join(self.tmp, 'home')
		self.racine = os.path.join(self.tmp, 'projet')
		os.makedirs(self.home)
		os.makedirs(self.racine)
		env = unittest.mock.patch.dict(os.environ, {
			'HOME': self.home, 'AGENCE_ROOT': self.racine, 'AGENCE_NOM': "L'humain", 'AGENCE_CATALOGUES': FIXTURES,
			'CATE_SOCKET': os.path.join(self.tmp, 'x.sock')})
		env.start()
		self.addCleanup(env.stop)
		ancien = agence.RUN
		agence.RUN = FakeRun()
		self.addCleanup(setattr, agence, 'RUN', ancien)
		with agence.tx() as st:
			st['port'] = 8765
			st['panels'] = {'orchestrator': 'o1', 'regisseur': 'r1'}

	def agence(self, *argv):
		out, err = io.StringIO(), io.StringIO()
		with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
			code = agence.main(list(argv))
		return code, out.getvalue(), err.getvalue()

	def metier(self, ident='data-manager', ecriture=('factice',)):
		pratiques.regler_plusieurs(self.racine, self.home, [('metier', ident), ('connecteurs.ecriture', list(ecriture))])


class CarteDEcriture(Base):
	"""T022 (FR-004) : refus en une phrase, code 1 ; cible valide : brouillon au texte normalisé."""

	def refus(self, cible, texte='{"a": 1}', *mots):
		code, out, err = self.agence('draft', 'new', '--cible', cible, '--from', 'a1', texte)
		self.assertEqual(code, 1, out + err)
		self.assertEqual(agence.load()['drafts'], [])
		for m in mots:
			self.assertIn(m, err)
		return err

	def test_connecteur_inconnu(self):
		self.metier()
		self.refus('outil:inconnu:ecrire', '{}', 'inconnu')

	def test_outil_de_lecture_ou_non_declare(self):
		self.metier()
		self.refus('outil:factice:lire', '{}', 'lire', 'écriture')
		self.refus('outil:factice:autre', '{}', 'autre')

	def test_ecriture_fermee(self):
		self.metier(ecriture=())
		err = self.refus('outil:factice:ecrire', '{}', 'Outil factice')
		self.assertIn(pratiques.schema()['cles']['connecteurs.ecriture']['nom'], err)

	def test_texte_non_json(self):
		self.metier()
		for texte in ('pas du json', '[1, 2]', '"texte"'):
			with self.subTest(texte=texte):
				self.refus('outil:factice:ecrire', texte, 'JSON')

	def test_cible_valide_texte_normalise(self):
		self.metier()
		code, out, err = self.agence('draft', 'new', '--cible', 'outil:factice:ecrire', '--from', 'a1',
		                             '{ "valeur": "é", "conteneur": 12 }')
		self.assertEqual(code, 0, err)
		did = out.strip()
		d = agence.load()['drafts'][-1]
		self.assertEqual((d['id'], d['cible'], d['statut']), (did, 'outil:factice:ecrire', 'à valider'))
		with open(agence.draft_path(did)) as f:
			self.assertEqual(f.read(), '{"conteneur":12,"valeur":"é"}\n')

	def test_page_montre_le_connecteur_et_les_arguments(self):
		self.metier()
		did = self.agence('draft', 'new', '--cible', 'outil:factice:ecrire', '--from', 'a1', '{"conteneur": 12}')[1].strip()
		page = agence.page_draft(agence.load(), did)
		self.assertIn('Outil factice', page)
		self.assertIn('ecrire', page)
		self.assertIn('conteneur', page)


if __name__ == '__main__':
	unittest.main()
