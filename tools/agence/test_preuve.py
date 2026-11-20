#!/usr/bin/env python3
"""Preuve de fin dérivée de la politique (spec 005, lot 3) : grammaire fermée de --done-when, dérivation depuis
`preuve`, évaluation pure, fermeture du besoin sur faux `gh`. HOME et dépôt jetables (test_agence.Base).
"""
import contextlib
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
import pratiques  # noqa: E402
from test_agence import Base  # noqa: E402

VALIDES = ('pr-merged:12', 'issue-closed:3', 'ci-green:12', 'tests-local', 'report', 'draft-sent:d1')
URL = 'https://github.com/o/r/pull/12'


def pr(state, checks=None, url=URL):
	"""Nœud GraphQL d'une PR tel que gh api graphql le rend (checks : état du rollup, None : aucun)."""
	rollup = {'state': checks} if checks else None
	return {'state': state, 'url': url, 'commits': {'nodes': [{'commit': {'statusCheckRollup': rollup}}]}}


class Cli(Base):
	def need(self, *argv):
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, out = self.cli('need', *argv)
		return code, out.strip(), err.getvalue()

	def besoin(self, nid):
		return agence.find(self.state(), 'needs', nid)

	def regler(self, cle, valeur):
		pratiques.regler(self.tmp, os.environ['HOME'], cle, valeur)


class Grammaire(Cli):
	"""FR-009, SC-004 : six formes, toute autre saisie refusée (code 2) avec la liste des formes."""

	def test_six_formes_valides(self):
		for forme in VALIDES:
			with self.subTest(forme=forme):
				code, nid, _ = self.need('add', '--done-when', forme, 'T')
				self.assertEqual(code, 0)
				self.assertEqual(self.besoin(nid)['doneWhen'], forme)

	def test_combinaison_par_virgule(self):
		code, nid, _ = self.need('add', '--done-when', 'ci-green:12,pr-merged:12', 'T')
		self.assertEqual((code, self.besoin(nid)['doneWhen']), (0, 'ci-green:12,pr-merged:12'))

	def test_hors_grammaire_refuse_avec_les_formes(self):
		for forme in ("n'importe quoi", 'pr-merged:', 'pr-merged:abc', 'ci-green:', 'tests-verts', 'report,', '',
		              'pr-merged:12,', 'PR-MERGED:12', 'issue-closed:3 report'):
			with self.subTest(forme=forme):
				code, _, err = self.need('add', '--done-when', forme, 'T')
				self.assertEqual(code, 2)
				for f in ('pr-merged:N', 'issue-closed:N', 'ci-green:N', 'tests-local', 'report', 'draft-sent:ID'):
					self.assertIn(f, err)
		self.assertEqual(self.state()['needs'], [])

	def test_forme_derivee_garde_n_vide(self):
		self.assertEqual(pratiques.conditions('ci-green:,pr-merged:'), [('ci-green', ''), ('pr-merged', '')])
		with self.assertRaises(pratiques.Invalide):
			pratiques.conditions('pr-merged:', saisie=True)


class Derivation(Cli):
	def test_defaut_selon_preuve_et_mode(self):
		for preuve, mode, attendu in ((None, 'pr', 'pr-merged:'), (None, 'main', 'report'),
		                              (['ci-verte', 'pr-mergee'], 'pr', 'ci-green:,pr-merged:'),
		                              (['tests-locaux', 'rapport'], 'main', 'tests-local,report')):
			with self.subTest(preuve=preuve, mode=mode):
				self.assertEqual(pratiques.done_when_defaut({'preuve': preuve, 'livraison.mode': mode}), attendu)

	def test_tache_sans_done_when_recoit_la_forme_derivee(self):
		self.assertEqual(self.besoin(self.need('add', 'T')[1])['doneWhen'], 'pr-merged:')
		self.regler('preuve', ['ci-verte', 'pr-mergee'])
		self.assertEqual(self.besoin(self.need('add', 'T2')[1])['doneWhen'], 'ci-green:,pr-merged:')

	def test_mode_main(self):
		pratiques.regler(self.tmp, os.environ['HOME'], 'livraison.mode', 'main')
		self.assertEqual(self.besoin(self.need('add', 'T')[1])['doneWhen'], 'report')

	def test_done_when_saisi_gagne(self):
		self.regler('preuve', ['ci-verte', 'pr-mergee'])
		self.assertEqual(self.besoin(self.need('add', '--done-when', 'report', 'T')[1])['doneWhen'], 'report')

	def test_autre_kind_sans_condition(self):
		self.assertIsNone(self.besoin(self.need('add', '--kind', 'cmd', 'pnpm test')[1])['doneWhen'])


class Evaluation(unittest.TestCase):
	"""pratiques.evaluer : pure, (fait, manques)."""

	def ev(self, dw, faits=None, evidence=None):
		return pratiques.evaluer(dw, faits or {}, evidence)

	def test_six_conditions_vraies_et_fausses(self):
		cas = [
			('pr-merged:12', {'12': {'state': 'MERGED'}}, None, (True, [])),
			('pr-merged:12', {'12': {'state': 'OPEN'}}, None, (False, ['PR non mergée'])),
			('issue-closed:3', {'3': {'state': 'CLOSED'}}, None, (True, [])),
			('issue-closed:3', {'3': {'state': 'OPEN'}}, None, (False, ['issue non fermée'])),
			('ci-green:12', {'12': {'state': 'OPEN', 'checks': 'SUCCESS'}}, None, (True, [])),
			('ci-green:12', {'12': {'state': 'OPEN', 'checks': 'FAILURE'}}, None, (False, ['checks non verts'])),
			('ci-green:12', {'12': {'state': 'OPEN', 'checks': 'PENDING'}}, None, (False, ['checks non verts'])),
			('tests-local', {}, 'npm test=0', (True, [])),
			('report', {}, 'SHA abc', (True, [])),
			('draft-sent:d1', {}, 'https://slack/x', (True, [])),
		]
		for dw, faits, ev, attendu in cas:
			with self.subTest(dw=dw, faits=faits):
				self.assertEqual(self.ev(dw, faits, ev), attendu)
		for dw in ('tests-local', 'report', 'draft-sent:d1'):
			with self.subTest(dw=dw):
				fait, manques = self.ev(dw)
				self.assertFalse(fait)
				self.assertEqual(len(manques), 1)

	def test_checks_absents_inconnus_jamais_verts(self):
		for faits in ({'12': {'state': 'MERGED'}}, {'12': {'state': 'MERGED', 'checks': None}}, {}):
			with self.subTest(faits=faits):
				fait, manques = self.ev('ci-green:12', faits)
				self.assertFalse(fait)
				self.assertIn('inconnu', manques[0])
				self.assertNotIn('vert', manques[0])

	def test_combinaison_nomme_chaque_manque(self):
		self.assertEqual(self.ev('ci-green:12,pr-merged:12', {'12': {'state': 'OPEN', 'checks': 'FAILURE'}}),
		                 (False, ['checks non verts', 'PR non mergée']))

	def test_condition_sans_numero_non_rattachee(self):
		fait, manques = self.ev('pr-merged:', {'12': {'state': 'MERGED'}})
		self.assertFalse(fait)
		self.assertIn('need pr', manques[0])

	def test_machine_vraie_humaine_sans_preuve(self):
		fait, manques = self.ev('pr-merged:12,report', {'12': {'state': 'MERGED'}})
		self.assertFalse(fait)
		self.assertEqual(len(manques), 1)


class Fermeture(Cli):
	"""US2 1 et 2 sur faux gh : le régisseur ferme sur ce que la politique dit."""

	def setUp(self):
		super().setUp()
		self.booted()
		with agence.tx() as st:
			st['ghRepo'] = 'o/r'

	def gh(self, **noeuds):
		self.run.reply(['gh', 'api', 'graphql'], {'data': {'repository': {f'n{k}': v for k, v in noeuds.items()}}})

	def un_tour(self):
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'title': 'Agence', 'type': 'agence'},
		                                           {'panelId': 'a1', 'title': 'impl', 'type': 'terminal'}])
		self.run.reply(['cate', 'agent', 'list'], [])
		agence.un_tour()

	def tache_ci_pr(self):
		self.regler('preuve', ['ci-verte', 'pr-mergee'])
		nid = self.need('add', '--panel', 'a1', 'T')[1]
		self.assertEqual(self.need('pr', nid, '12')[0], 0)
		self.assertEqual(self.besoin(nid)['doneWhen'], 'ci-green:12,pr-merged:12')
		return nid

	def test_pr_ouverte_checks_verts_reste_ouvert(self):
		nid = self.tache_ci_pr()
		self.gh(**{'12': pr('OPEN', 'SUCCESS')})
		self.un_tour()
		n = self.besoin(nid)
		self.assertEqual((n['status'], n['manques']), ('open', ['PR non mergée']))
		self.assertIn('PR non mergée', agence.need_line(self.state(), n))

	def test_pr_mergee_checks_verts_fait_avec_lien(self):
		nid = self.tache_ci_pr()
		self.gh(**{'12': pr('MERGED', 'SUCCESS')})
		self.un_tour()
		n = self.besoin(nid)
		self.assertEqual((n['status'], n['evidence']), ('done', URL))

	def test_pr_mergee_checks_rouges_sous_ci_verte_reste_ouvert(self):
		nid = self.tache_ci_pr()
		self.gh(**{'12': pr('MERGED', 'FAILURE')})
		self.un_tour()
		n = self.besoin(nid)
		self.assertEqual((n['status'], n['manques']), ('open', ['checks non verts']))
		self.assertIn('checks non verts', agence.need_line(self.state(), n))

	def test_need_pr_complete_seulement_un_besoin_connu(self):
		self.assertNotEqual(self.need('pr', 'n99', '12')[0], 0)
		nid = self.need('add', '--kind', 'cmd', 'x')[1]
		self.assertNotEqual(self.need('pr', nid, '12')[0], 0)  # pas de condition de PR à compléter

	def test_need_done_refuse_tant_qu_une_condition_machine_est_fausse(self):
		nid = self.tache_ci_pr()
		self.gh(**{'12': pr('OPEN', 'SUCCESS')})
		code, _, err = self.need('done', nid, '--evidence', 'tests verts')
		self.assertEqual(code, 1)
		self.assertIn('PR non mergée', err)
		self.assertEqual(self.besoin(nid)['status'], 'open')

	def test_condition_humaine_ferme_par_need_done_avec_preuve(self):
		nid = self.need('add', '--done-when', 'pr-merged:12,report', '--panel', 'a1', 'T')[1]
		self.gh(**{'12': pr('MERGED')})
		self.un_tour()
		self.assertEqual(self.besoin(nid)['status'], 'open')  # report attend need done --evidence
		self.assertNotEqual(self.need('done', nid)[0], 0)
		self.assertEqual(self.need('done', nid, '--evidence', 'rapport lu')[0], 0)
		self.assertEqual(self.besoin(nid)['status'], 'done')

	def test_report_et_tests_local_exigent_evidence(self):
		for dw in ('report', 'tests-local'):
			with self.subTest(dw=dw):
				nid = self.need('add', '--done-when', dw, 'T')[1]
				self.assertNotEqual(self.need('done', nid)[0], 0)
				self.assertEqual(self.need('done', nid, '--evidence', 'npm test : 0')[0], 0)

	def test_tests_local_fait_affiche_declare_non_reverifie(self):
		nid = self.need('add', '--done-when', 'tests-local', 'T')[1]
		self.need('done', nid, '--evidence', 'npm test : 0')
		self.assertIn('tests déclarés, non revérifiés', agence.need_line(self.state(), self.besoin(nid)))

	def test_ancien_besoin_evalue_comme_avant(self):
		"""Aucune migration : un doneWhen déjà écrit (forme ancienne ou texte libre) est lu tel quel."""
		with agence.tx() as st:
			ancien, _ = agence.add_need(st, 'task', 'Ancien', done_when='pr-merged:12', panels=['a1'])
			libre, _ = agence.add_need(st, 'task', 'Libre', done_when='tests verts', panels=['a1'])
		self.gh(**{'12': pr('MERGED')})
		self.un_tour()
		self.assertEqual(self.besoin(ancien['id'])['status'], 'done')
		self.assertEqual(self.besoin(libre['id'])['status'], 'open')
		self.assertEqual(self.need('done', libre['id'], '--evidence', 'ok')[0], 0)


class IssueObligatoire(Cli):
	"""US1 : issue obligatoire, une tâche porte --issue N."""

	def test_tache_sans_issue_refusee(self):
		self.regler('issue', 'obligatoire')
		code, _, err = self.need('add', 'T')
		self.assertNotEqual(code, 0)
		self.assertIn('--issue', err)
		self.assertEqual(self.state()['needs'], [])

	def test_tache_avec_issue_acceptee(self):
		self.regler('issue', 'obligatoire')
		code, nid, _ = self.need('add', '--issue', '7', 'T')
		self.assertEqual((code, self.besoin(nid)['issue']), (0, '7'))

	def test_issue_libre_sans_issue(self):
		self.assertEqual(self.need('add', 'T')[0], 0)
		self.assertEqual(self.need('add', '--kind', 'cmd', 'x')[0], 0)


if __name__ == '__main__':
	unittest.main()
