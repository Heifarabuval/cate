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
# Sortie de `claude mcp list` figée d'après une vraie sortie du 2026-11-21 (commandes remplacées, hypothèse P3) :
# « <nom>: <commande ou URL> - ✔ Connected » ou « - ! Needs authentication ».
MCP_LIST = """Checking MCP server health…

claude.ai Gmail: https://exemple.test/mcp - ✔ Connected
factice: node factice.js - ✔ Connected
plugin:outil:outil: https://exemple.test/mcp (HTTP) - ! Needs authentication
messagerie-factice: node messagerie.js - ! Needs authentication
"""
SENTINELLE = 'valeur-sentinelle'


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


class ConnecteurCheck(Base):
	"""Lot 4, T040 (FR-009) : l'accès de chaque connecteur du métier actif, lu en code ; faux `claude mcp list`."""

	def setUp(self):
		super().setUp()
		os.environ.pop('GTM_FACTICE', None)
		agence.RUN.reply(['claude', 'mcp', 'list'], MCP_LIST)

	def check(self, *argv):
		code, out, err = self.agence('connecteur', 'check', *argv)
		self.assertEqual(code, 0, err)
		return out

	def test_data_manager(self):
		self.metier()
		out = self.check()
		lignes = {l.split(' ')[0]: l for l in out.splitlines() if l.strip()}
		self.assertIn('mcp branché', lignes['factice'])
		self.assertIn('secret absent : GTM_FACTICE', lignes['balises-factice'])
		self.assertIn('navigateur, dernier recours, lecture seule', lignes['site-factice'])
		self.assertIn('écriture par carte', lignes['factice'])
		self.assertNotIn('messagerie-factice', out)  # hors du métier

	def test_mcp_absent_ou_non_connecte(self):
		self.metier('chef-de-projet', ())
		agence.RUN.reply(['claude', 'mcp', 'list'], MCP_LIST.replace('factice: node factice.js - ✔ Connected\n', ''))
		out = self.check()
		self.assertIn('mcp non connecté', next(l for l in out.splitlines() if l.startswith('messagerie-factice')))
		self.assertIn('mcp absent', next(l for l in out.splitlines() if l.startswith('tableur-factice')))

	def test_json_memes_faits(self):
		self.metier()
		faits = {c['id']: c for c in json.loads(self.check('--json'))}
		self.assertEqual(faits['factice']['acces'], 'mcp branché')
		self.assertEqual(faits['balises-factice']['secret'], {'variable': 'GTM_FACTICE', 'present': False})
		self.assertEqual((faits['factice']['lecture'], faits['factice']['ecriture']), (True, True))
		self.assertEqual(faits['site-factice']['acces'], 'navigateur, dernier recours, lecture seule')

	def test_dev_aucun_connecteur(self):
		self.assertIn('aucun connecteur', self.check())
		self.assertEqual(agence.RUN.ran('claude', 'mcp', 'list'), [])


class SecretSentinelle(Base):
	"""Lot 4, T041 (FR-006, SC-005) : la valeur d'un secret n'apparaît dans aucune sortie ni aucun fichier de l'agence."""

	def setUp(self):
		super().setUp()
		env = unittest.mock.patch.dict(os.environ, {'GTM_FACTICE': SENTINELLE})
		env.start()
		self.addCleanup(env.stop)
		agence.RUN.reply(['claude', 'mcp', 'list'], MCP_LIST)
		self.metier()

	def test_absente_partout(self):
		sorties = []
		for argv in (('connecteur', 'check'), ('connecteur', 'check', '--json'), ('pratiques', 'show'),
		             ('pratiques', 'show', '--json'), ('pratiques', 'brief')):
			code, out, err = self.agence(*argv)
			self.assertEqual(code, 0, (argv, err))
			sorties.append(out + err)
		self.assertIn('secret présent : GTM_FACTICE', sorties[0])
		self.assertTrue(json.loads(sorties[1].strip())[1]['secret']['present'])
		agence.un_tour()
		for racine, _, noms in os.walk(self.tmp):
			for n in noms:
				with open(os.path.join(racine, n), 'rb') as f:
					sorties.append(f.read().decode('utf-8', 'replace'))
		self.assertTrue(any('GTM_FACTICE' in x for x in sorties))
		self.assertFalse([x for x in sorties if SENTINELLE in x])

	def test_lecture_commune_avec_le_jeton_slack(self):
		self.assertEqual(metiers.lire_secret('GTM_FACTICE', None), SENTINELLE)
		env = os.path.join(self.tmp, 'acces.env')
		with open(env, 'w') as f:
			f.write('AUTRE=x\nJETON_FICHIER="dans-le-fichier"\n')
		self.assertEqual(metiers.lire_secret('JETON_FICHIER', env), 'dans-le-fichier')
		self.assertIsNone(metiers.lire_secret('ABSENT', env))


if __name__ == '__main__':
	unittest.main()
