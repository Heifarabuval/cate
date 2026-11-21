#!/usr/bin/env python3
"""Spec 010, lot 6 : registre au clic (FR-008) et revue de cap (FR-009).

Une décision proposée devient une carte (question existante) ; seul un clic la pose active ou rejetée, et une
décision validée révoque les actives qu'elle invalide. Chaque semaine, une carte unique liste ce qui dérive ; chaque
fiche périmée y a Relancer et Abandonner. `cate` est simulé ; état en dossier temporaire et faux HOME."""
import os
import sys
import unittest
from datetime import datetime, timedelta
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
import backlog  # noqa: E402
from test_lancer import COMPLETE, Lancer  # noqa: E402

NOW = '2026-11-21T10:00:00+00:00'


def il_y_a(jours):
	return (datetime.fromisoformat(NOW) - timedelta(days=jours)).isoformat()


class Carte(Lancer):
	def registre(self):
		return {x['id']: x for x in backlog.charger(self.tmp)['decisions']['decisions']}

	def questions(self, ouvertes=True):
		return [q for q in self.state()['questions'] if not ouvertes or q['answer'] is None]

	def besoin(self, q):
		return agence.find(self.state(), 'needs', q['needId'])

	def repond(self, q, label):
		return agence.click(f"/ask/{q['id']}", {'choice': [str([o['label'] for o in q['options']].index(label))]})

	def tour(self):
		with mock.patch.object(agence, 'now_iso', return_value=NOW):
			self.un_tour()


class Registre(Carte):
	"""T100 : une décision n'est active, rejetée ou révoquée que sur clic."""

	def proposer(self, objet, *opts):
		code, out = self.cli('decision', 'add', objet, '--pourquoi', f'pourquoi {objet}', *opts)
		self.assertEqual(code, 0)
		return out.strip()

	def carte(self, did):
		return next(q for q in self.questions() if f'{did} ' in q['question'])

	def test_decision_add_cree_une_carte_valider_rejeter(self):
		self.assertEqual(self.proposer('JSON seulement'), 'D1')
		[q] = self.questions()
		self.assertEqual([o['label'] for o in q['options']], ['Valider', 'Rejeter'])
		self.assertIn('JSON seulement', q['question'])
		self.assertNotIn('structurante', q['question'])
		n = self.besoin(q)
		self.assertEqual((n['status'], n['owner'], n['kind']), ('open', agence.OWNER_HUMAIN, 'human'))
		self.assertEqual(self.registre()['D1']['statut'], 'proposée')

	def test_aucune_transition_sans_clic(self):
		self.proposer('JSON seulement')
		self.tour()
		self.tour()
		self.assertEqual(self.registre()['D1']['statut'], 'proposée')
		self.assertEqual(len(self.questions()), 1)
		self.assertEqual(self.cli('decision', 'list', '--active')[1], '')

	def test_valider_pose_active_et_journal_clic(self):
		self.proposer('JSON seulement')
		q = self.carte('D1')
		self.assertEqual(self.repond(q, 'Valider'), (303, '/'))
		self.assertEqual(self.registre()['D1']['statut'], 'active')
		self.assertEqual(self.questions(), [])
		n = self.besoin(q)
		self.assertEqual(n['status'], 'done')
		self.assertEqual(n['journal'][-1]['by'], 'clic')
		self.assertIn('D1', n['journal'][-1]['text'])

	def test_rejeter_pose_rejetee(self):
		self.proposer('JSON seulement')
		self.assertEqual(self.repond(self.carte('D1'), 'Rejeter'), (303, '/'))
		self.assertEqual(self.registre()['D1']['statut'], 'rejetée')
		self.assertEqual(self.questions(), [])

	def test_valider_revoque_les_actives_qu_elle_invalide(self):
		self.proposer('JSON seulement')
		self.repond(self.carte('D1'), 'Valider')
		self.proposer('SQLite pour le backlog', '--invalide', 'D1')
		q = self.carte('D2')
		self.assertIn('révoque D1', q['question'])
		self.assertEqual(self.registre()['D1']['statut'], 'active')  # proposer ne révoque rien
		self.assertEqual(self.repond(q, 'Valider'), (303, '/'))
		d = self.registre()
		self.assertEqual((d['D1']['statut'], d['D1']['revoqueePar']), ('révoquée', 'D2'))
		self.assertEqual(d['D2']['statut'], 'active')

	def test_rejeter_garde_l_active(self):
		self.proposer('JSON seulement')
		self.repond(self.carte('D1'), 'Valider')
		self.proposer('SQLite', '--invalide', 'D1')
		self.repond(self.carte('D2'), 'Rejeter')
		d = self.registre()
		self.assertEqual((d['D1']['statut'], d['D1']['revoqueePar'], d['D2']['statut']), ('active', None, 'rejetée'))

	def test_structurante_marquee_dans_la_carte(self):
		self.proposer('Un daemon par workspace', '--structurante')
		self.assertIn('structurante', self.carte('D1')['question'])

	def test_double_clic_409_rien_ne_change(self):
		self.proposer('JSON seulement')
		q = self.carte('D1')
		self.repond(q, 'Valider')
		code, _ = self.repond(q, 'Rejeter')
		self.assertEqual(code, 409)
		self.assertEqual(self.registre()['D1']['statut'], 'active')

	def test_route_directe_ferme_aussi_la_carte(self):
		self.proposer('JSON seulement')
		self.assertEqual(agence.click('/decision/D1/valider', {}), (303, '/'))
		self.assertEqual(self.registre()['D1']['statut'], 'active')
		self.assertEqual(self.questions(), [])
		self.assertEqual(agence.click('/decision/D1/rejeter', {})[0], 409)

	def test_routes_inconnues(self):
		self.proposer('JSON seulement')
		self.assertEqual(agence.click('/decision/D1/activer', {})[0], 404)
		self.assertEqual(agence.click('/decision/D9/valider', {})[0], 409)
		self.assertEqual(self.registre()['D1']['statut'], 'proposée')


class RevueContenu(unittest.TestCase):
	"""T101 : contenu de la carte, calculé par code (backlog.revue, pure)."""

	def test_contenu(self):
		b, d = backlog.vide(), backlog.vide_decisions()
		backlog.ajouter(b, 'vieille', il_y_a(15))
		backlog.ajouter(b, 'récente', il_y_a(13))
		backlog.ajouter(b, 'hors vision', il_y_a(1), vision='couche-9')
		backlog.ajouter(b, 'dans la vision', il_y_a(1), vision='FR-003')
		for objet, jours, structurante in (('cette semaine', 2, True), ('ancienne', 8, True), ('mineure', 1, False)):
			backlog.decision_ajouter(d, objet, 'p', il_y_a(jours), structurante=structurante)
		r = backlog.revue(b, d, [{'id': 'n4', 'title': 'Gros lot'}], NOW)
		self.assertEqual([f['id'] for f in r['perimees']], ['F1'])
		self.assertEqual([n['id'] for n in r['depassements']], ['n4'])
		self.assertEqual([x['id'] for x in r['structurantes']], ['D1'])
		self.assertEqual([f['id'] for f in r['horsVision']], ['F3'])

	def test_rien_ne_derive_rien_a_lister(self):
		b = backlog.vide()
		backlog.ajouter(b, 'récente', il_y_a(1))
		self.assertIsNone(backlog.revue(b, backlog.vide_decisions(), [], NOW))


class Revue(Carte):
	"""T101 : une carte unique tous les 7 jours, au tour du régisseur ; T102 : Relancer, Abandonner."""

	def fiche(self, titre, jours, **champs):
		with agence.verrou():
			b = backlog.charger(self.tmp)['backlog']
			f = backlog.ajouter(b, titre, il_y_a(jours), **champs)
			backlog.ecrire(self.tmp, 'backlog.json', b)
		return f['id']

	def derniere(self, jours):
		with agence.verrou():
			b = backlog.charger(self.tmp)['backlog']
			b['derniereRevue'] = il_y_a(jours)
			backlog.ecrire(self.tmp, 'backlog.json', b)

	def revues(self, ouvertes=True):
		return [q for q in self.questions(ouvertes) if q['question'].startswith('Revue de cap')]

	def fiches(self):
		return {f['id']: f for f in backlog.charger(self.tmp)['backlog']['fiches']}

	def test_une_seule_carte_par_revue(self):
		self.fiche('vieille', 15)
		self.fiche('récente', 13)
		self.tour()
		[q] = self.revues()
		self.assertEqual([o['label'] for o in q['options']], ['Relancer F1', 'Abandonner F1', 'Vu'])
		self.assertNotIn('F2', q['question'])
		self.assertEqual(backlog.charger(self.tmp)['backlog']['derniereRevue'], NOW)
		self.assertEqual(self.besoin(q)['owner'], agence.OWNER_HUMAIN)
		self.tour()
		self.assertEqual(len(self.revues(ouvertes=False)), 1)
		self.assertEqual(self.envois(), [])  # jamais un message à l'orchestrateur

	def test_revue_faite_il_y_a_3_jours_aucune_carte(self):
		self.fiche('vieille', 15)
		self.derniere(3)
		self.tour()
		self.assertEqual(self.revues(), [])
		self.assertEqual(backlog.charger(self.tmp)['backlog']['derniereRevue'], il_y_a(3))

	def test_premiere_revue_7_jours_apres_la_premiere_fiche(self):
		self.fiche('jeune', 6, vision='couche-9')
		self.tour()
		self.assertEqual(self.revues(), [])

	def test_backlog_vide_aucune_carte(self):
		self.tour()
		self.assertEqual(self.revues(), [])
		self.assertIsNone(backlog.charger(self.tmp)['backlog']['derniereRevue'])

	def test_revue_suivante_remplace_la_carte_restee_ouverte(self):
		self.fiche('vieille', 15)
		self.tour()
		[ancienne] = self.revues()
		self.derniere(8)
		self.tour()
		[q] = self.revues()
		self.assertNotEqual(q['id'], ancienne['id'])
		self.assertEqual(self.besoin(ancienne)['status'], 'dropped')

	def test_relancer_remet_maj_a_maintenant(self):
		self.fiche('vieille', 15)
		self.tour()
		[q] = self.revues()
		with mock.patch.object(agence, 'now_iso', return_value=NOW):
			self.assertEqual(self.repond(q, 'Relancer F1'), (303, '/'))
		f = self.fiches()['F1']
		self.assertEqual((f['etat'], f['maj'], f['journal'][-1]['by']), ('discussion', NOW, 'clic'))
		self.assertEqual(self.revues(), [])  # toutes ses fiches traitées : carte close
		self.assertEqual(self.repond(q, 'Abandonner F1')[0], 409)

	def test_abandonner_passe_abandonnee_rien_supprime(self):
		self.fiche('vieille', 15)
		self.fiche('autre vieille', 20)
		self.tour()
		[q] = self.revues()
		self.assertEqual(self.repond(q, 'Abandonner F1'), (303, '/'))
		fs = self.fiches()
		self.assertEqual(sorted(fs), ['F1', 'F2'])
		self.assertEqual((fs['F1']['etat'], fs['F1']['journal'][-1]['by']), ('abandonnée', 'clic'))
		self.assertEqual(len(self.revues()), 1)  # F2 attend encore son clic
		self.assertEqual(self.repond(q, 'Relancer F1')[0], 409)
		self.assertEqual(self.repond(q, 'Vu'), (303, '/'))
		self.assertEqual(self.revues(), [])
		self.assertEqual(self.fiches()['F2']['etat'], 'discussion')

	def test_route_directe_fiche(self):
		self.fiche('vieille', 15)
		self.assertEqual(agence.click('/fiche/F1/abandonner', {}), (303, '/'))
		self.assertEqual(self.fiches()['F1']['etat'], 'abandonnée')
		self.assertEqual(agence.click('/fiche/F1/relancer', {})[0], 409)
		self.assertEqual(agence.click('/fiche/F1/supprimer', {})[0], 404)


if __name__ == '__main__':
	unittest.main()
