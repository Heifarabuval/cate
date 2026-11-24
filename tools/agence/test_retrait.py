#!/usr/bin/env python3
"""Retrait du codé en dur (spec 005, lot 2) : la méthode de merge, `ask --merge`, le jeton Slack et le plafond
d'agents suivent la politique (pratiques.py). `gh` et Slack sont simulés ; HOME et dépôt sont jetables (test_agence.Base).
"""
import contextlib
import glob
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
import pratiques  # noqa: E402
from test_agence import Base  # noqa: E402

PR = 'o/r#4'
JETON = 'xoxp-jeton-secret-42'


class Politique(Base):
	def regler(self, cle, valeur, dev=False):
		pratiques.regler(self.tmp, os.environ['HOME'], cle, valeur, dev)

	def preset(self, nom):
		pratiques.poser_preset(self.tmp, os.environ['HOME'], nom)

	def casser(self):
		"""Fichier du projet illisible : la politique publie une erreur."""
		chemin = pratiques.fichier_projet(self.tmp)
		os.makedirs(os.path.dirname(chemin), exist_ok=True)
		with open(chemin, 'w') as f:
			f.write('{pas du json')

	def ask(self, *extra):
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, out = self.cli('ask', '--from', 'o1', *extra, 'PR #4 prête ?')
		return code, out.strip(), err.getvalue()

	def variable(self, cle, valeur):
		vieux = os.environ.get(cle)
		self.addCleanup(lambda: os.environ.pop(cle, None) if vieux is None else os.environ.__setitem__(cle, vieux))
		os.environ[cle] = valeur


class MethodeDeMerge(Politique):
	"""Audit C : la méthode passée à gh pr merge et le libellé de Merger viennent de livraison.methode."""

	def test_options_portent_la_methode(self):
		for m in ('squash', 'rebase', 'merge'):
			self.assertEqual(agence.merge_options(m)[0], {'label': f'Merger ({m})', 'detail': f'gh pr merge --{m}'})

	def test_question_rend_la_methode_de_la_politique(self):
		self.booted()
		self.regler('livraison.methode', 'merge')
		qid = self.ask('--merge', PR)[1]
		self.assertEqual(agence.find(self.state(), 'questions', qid)['options'][0]['label'], 'Merger (merge)')

	def test_clic_passe_la_methode_de_la_politique(self):
		self.booted()
		for regle, attendu in ((None, '--squash'), ('pr-tdd', '--rebase'), ('merge', '--merge')):
			with self.subTest(regle=regle):
				if regle == 'pr-tdd':
					self.preset('pr-tdd')
				elif regle:
					self.regler('livraison.methode', regle)
				avant = len(self.run.ran('gh', 'pr', 'merge'))
				qid = self.ask('--merge', PR)[1]
				self.assertEqual(agence.click(f'/ask/{qid}', {'choice': ['0']}), (303, '/'))
				merge = self.run.ran('gh', 'pr', 'merge')[avant:]
				self.assertEqual(merge, [['gh', 'pr', 'merge', '4', '-R', 'o/r', attendu]])

	def test_clic_sous_politique_invalide_ne_merge_pas(self):
		self.booted()
		qid = self.ask('--merge', PR)[1]
		self.casser()
		code, msg = agence.click(f'/ask/{qid}', {'choice': ['0']})
		self.assertEqual(code, 409)
		self.assertIn('pratiques', msg)
		self.assertFalse(self.run.ran('gh', 'pr', 'merge'))
		self.assertIsNone(agence.find(self.state(), 'questions', qid)['answer'])

	def test_merger_quand_meme_porte_la_methode(self):
		self.booted()
		qid = self.ask('--merge', PR)[1]
		with agence.tx() as st:
			agence.add_need(st, 'draft', 'Corps de la PR #4', ref='d1', unblocks='PR #4')
		page = agence.page_ask(self.state(), qid)
		self.assertIn('Merger quand même (squash)', page)
		self.assertNotIn('rebase)', page)


class AskMerge(Politique):
	"""FR-006 : une question de merge n'a de sens que si l'humain merge au clic, sur une PR."""

	def setUp(self):
		super().setUp()
		self.booted()

	def test_dehors_refuse_en_citant_la_cle(self):
		self.regler('livraison.merge', 'dehors')
		code, _, err = self.ask('--merge', PR)
		self.assertEqual(code, 2)
		self.assertIn('livraison.merge', err)
		self.assertEqual(self.state()['questions'], [])

	def test_mode_main_refuse_en_citant_la_cle(self):
		self.regler('livraison.mode', 'main')
		code, _, err = self.ask('--merge', PR)
		self.assertEqual(code, 2)
		self.assertIn('livraison.mode', err)

	def test_question_sans_merge_reste_possible(self):
		self.regler('livraison.merge', 'dehors')
		code, qid, _ = self.ask('--option', 'Oui|x', '--option', 'Non|y')
		self.assertEqual(code, 0)
		self.assertIsNone(agence.find(self.state(), 'questions', qid)['action'])

	def test_politique_en_erreur_refuse_en_citant_l_erreur(self):
		self.casser()
		code, _, err = self.ask('--merge', PR)
		self.assertEqual(code, 2)
		self.assertIn(pratiques.fichier_projet(self.tmp), err)
		self.assertEqual(self.state()['questions'], [])


class JetonSlack(Politique):
	"""FR-007 : le jeton vient de la variable nommée par envoi.slack.variable, sinon du fichier envoi.slack.fichier."""

	def fichier(self, texte, chemin='~/secrets/slack.env'):
		vrai = os.path.expanduser(chemin)
		os.makedirs(os.path.dirname(vrai), exist_ok=True)
		with open(vrai, 'w') as f:
			f.write(texte)
		self.regler('envoi.slack.fichier', chemin, dev=True)

	def test_variable_par_defaut(self):
		self.variable('SLACK_USER_TOKEN', JETON)
		self.assertEqual(agence.slack_token(), JETON)

	def test_variable_nommee(self):
		self.regler('envoi.slack.variable', 'MON_JETON')
		self.variable('MON_JETON', JETON)
		self.variable('SLACK_USER_TOKEN', 'xoxp-autre')
		self.assertEqual(agence.slack_token(), JETON)

	def test_fichier_nomme_a_defaut_de_variable(self):
		self.regler('envoi.slack.variable', 'MON_JETON')
		self.fichier(f'AUTRE=x\nMON_JETON="{JETON}"\n')
		self.assertEqual(agence.slack_token(), JETON)

	def test_variable_avant_le_fichier(self):
		self.fichier('SLACK_USER_TOKEN=xoxp-du-fichier\n')
		self.variable('SLACK_USER_TOKEN', JETON)
		self.assertEqual(agence.slack_token(), JETON)

	def test_ni_variable_ni_fichier_refus_sans_fuite(self):
		self.fichier('SLACK_BOT_TOKEN=xoxb-bot\n')
		with self.assertRaises(agence.Refus) as cm:
			agence.slack_token()
		self.assertIn('SLACK_USER_TOKEN', str(cm.exception))
		self.assertNotIn('xoxb', str(cm.exception))
		os.remove(os.path.expanduser('~/secrets/slack.env'))
		with self.assertRaises(agence.Refus):
			agence.slack_token()

	def test_hermes_n_est_plus_lu(self):
		hermes = os.path.expanduser('~/.hermes/.env')
		os.makedirs(os.path.dirname(hermes))
		with open(hermes, 'w') as f:
			f.write(f'SLACK_USER_TOKEN={JETON}\n')
		self.variable('HERMES_ENV', hermes)
		with self.assertRaises(agence.Refus):
			agence.slack_token()

	def test_jeton_absent_de_show_de_l_etat_et_du_journal(self):
		self.fichier(f'SLACK_USER_TOKEN={JETON}\n')
		self.booted()
		vus = []
		agence.SLACK = lambda method, payload, token: (vus.append(token), {'ok': True, 'channel': 'C1', 'ts': '1.2', 'permalink': 'https://x/p'})[1]
		did = self.cli('draft', 'new', '--cible', 'slack:C1', '--from', 'a1', 'Salut')[1].strip()
		self.assertEqual(agence.click(f'/draft/{did}/send', self.shown(did)), (303, '/'))
		self.assertIn(JETON, vus)
		sorties = [self.cli('pratiques', 'show')[1], self.cli('pratiques', 'show', '--json')[1], self.cli('pratiques', 'brief')[1]]
		for chemin in glob.glob(os.path.join(agence.adir(), '**', '*'), recursive=True):
			if os.path.isfile(chemin):
				with open(chemin, errors='replace') as f:
					sorties.append(f.read())
		self.assertTrue(any('Salut' in s for s in sorties))  # l'état et le brouillon sont bien relus
		for s in sorties:
			self.assertNotIn(JETON, s)


class Plafond(Politique):
	"""Audit, plafond : agents.max remplace MAX_AGENTS et la clé maxAgents de l'état."""

	def test_plafond_lit_agents_max(self):
		self.regler('agents.max', 6)
		self.assertEqual(agence.plafond(self.state()), 6)

	def test_start_max_agents_ponctuel_sans_ecrire(self):
		"""Spec 008 (FR-009) remplace l'écriture de 005-L2 : la valeur est ponctuelle, le fichier du projet n'existe pas."""
		self.assertEqual(self.cli('start', '--max-agents', '6')[0], 0)
		self.assertFalse(os.path.exists(pratiques.fichier_projet(self.tmp)))
		self.assertEqual(self.state()['ponctuel'], {'agents.max': 6})
		self.assertNotIn('maxAgents', self.state())
		self.assertEqual(agence.plafond(self.state()), 6)

	def test_start_max_agents_hors_bornes_refuse(self):
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, _ = self.cli('start', '--max-agents', '17')
		self.assertEqual(code, 2)
		self.assertIn('agents.max', err.getvalue())
		self.assertFalse(os.path.exists(pratiques.fichier_projet(self.tmp)))

	def test_etat_ancien_avec_max_agents_ignore_sans_reecriture(self):
		with agence.tx():
			pass
		chemin = agence.state_file()
		with open(chemin) as f:
			vieux = json.load(f)
		vieux['maxAgents'] = 2
		with open(chemin, 'w') as f:
			json.dump(vieux, f)
		self.assertEqual(agence.plafond(agence.load()), 4)
		with open(chemin) as f:
			self.assertEqual(json.load(f)['maxAgents'], 2)


class SansCodeEnDur(unittest.TestCase):
	def test_plus_de_hermes_ni_de_rebase_en_dur(self):
		with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'agence.py'), encoding='utf-8') as f:
			trouves = [f'{i}: {l.strip()}' for i, l in enumerate(f, 1) if any(m in l.lower() for m in ('hermes', '--rebase', 'max_agents ='))]
		self.assertEqual(trouves, [])


if __name__ == '__main__':
	unittest.main()
