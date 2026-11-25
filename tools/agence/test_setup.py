#!/usr/bin/env python3
"""Spec 015, lots 1 à 3 : `agence pratiques propose` (proposition validée, carte avec diff), l'écriture au seul clic
Appliquer par le régisseur, l'ouverture de l'agent de setup. `cate` est simulé (FakeRun) ; faux HOME (Base)."""
import contextlib
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
import pratiques  # noqa: E402
import setup  # noqa: E402
from test_agence import Base  # noqa: E402
from test_portable import REPO  # noqa: E402

# Faux jetons, assemblés ici pour que ce fichier ne ressemble pas lui-même à un secret.
FAUX_SLACK = 'xo' + 'xb-1234567890-abcdef'
FAUX_GITHUB = 'gh' + 'p_abcdefghijklmnop1234'
PROPOSITION = {'valeurs': {'agents.max': 2, 'verification': 'differente'},
               'sources': {'agents.max': 'réponse de la personne', 'verification': 'CLAUDE.md:12'}}


class Proposition(unittest.TestCase):
	"""lire_proposition : forme, source de chaque valeur, aucun secret."""

	def lire(self, objet):
		return setup.lire_proposition(json.dumps(objet))

	def test_valide(self):
		self.assertEqual(self.lire(PROPOSITION)['valeurs'], PROPOSITION['valeurs'])

	def test_refus(self):
		for nom, objet, mot in (
				('sans source', {'valeurs': {'agents.max': 2}, 'sources': {}}, 'source manquante'),
				('source vide', {'valeurs': {'agents.max': 2}, 'sources': {'agents.max': ' '}}, 'source manquante'),
				('source orpheline', {'valeurs': {}, 'sources': {'agents.max': 'x'}}, 'sans valeur'),
				('clé inconnue', {'valeurs': {}, 'sources': {}, 'autre': 1}, 'clé inconnue de la proposition'),
				('preset sans source', {'preset': 'pr-tdd', 'sources': {}}, 'source manquante pour « preset »'),
				('secret dans une source', {'valeurs': {'agents.max': 2}, 'sources': {'agents.max': FAUX_SLACK}}, 'secret'),
				('secret dans une valeur', {'valeurs': {'envoi.slack.variable': FAUX_GITHUB}, 'sources': {'envoi.slack.variable': 'x'}}, 'secret')):
			with self.subTest(nom), self.assertRaises(setup.Invalide) as ctx:
				self.lire(objet)
			self.assertIn(mot, str(ctx.exception))

	def test_json_casse(self):
		with self.assertRaises(setup.Invalide):
			setup.lire_proposition('{ nope')


class Setup(Base):
	"""Carte de pratiques posée par `agence pratiques propose`, écrite au clic Appliquer."""

	def setUp(self):
		super().setUp()
		self.booted()
		self.fichier = os.path.join(self.tmp, 'proposition.json')

	def ecrire(self, objet):
		with open(self.fichier, 'w') as f:
			f.write(objet if isinstance(objet, str) else json.dumps(objet))

	def propose(self, objet=PROPOSITION):
		self.ecrire(objet)
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, out = self.cli('pratiques', 'propose', self.fichier, '--from', 'a1')
		return code, out, err.getvalue()

	def carte(self):
		return self.state()['questions'][-1]

	def projet(self):
		return pratiques.fichier_projet(self.tmp)

	def clic(self, qid, choix):
		return agence.click(f'/ask/{qid}', {'choice': [str(choix)]})

	def test_la_proposition_pose_une_carte_avec_son_diff_et_n_ecrit_rien(self):
		code, out, _ = self.propose()
		self.assertEqual(code, 0)
		q = self.carte()
		self.assertEqual([o['label'] for o in q['options']], ['Appliquer', 'Refuser'])
		self.assertTrue(q['question'].startswith('Appliquer ces réglages ?'))
		# une ligne par écart, en mots simples : nom, avant, après, source
		self.assertIn('Agents en même temps : 4 → 2 (source : réponse de la personne)', q['question'])
		self.assertIn('Relecture : Par l\'agent lui-même → Par un second agent (source : CLAUDE.md:12)', q['question'])
		self.assertNotIn('agents.max', q['question'], 'jamais la clé technique')
		self.assertFalse(os.path.exists(self.projet()), 'rien n\'est écrit avant le clic')
		self.assertEqual(out.strip().splitlines()[-1], q['id'])

	def test_la_carte_porte_le_texte_exact_de_la_proposition(self):
		texte = json.dumps(PROPOSITION, indent=1) + '\n'
		self.propose(texte)
		self.assertEqual(self.carte()['proposition'], texte)
		self.assertEqual(self.carte()['setup'], 'pratiques')

	def test_appliquer_ecrit_le_fichier_du_projet_par_le_regisseur(self):
		self.propose()
		q = self.carte()
		code, _ = self.clic(q['id'], 0)
		self.assertEqual(code, 303)
		with open(self.projet()) as f:
			self.assertEqual(json.load(f), {'agents': {'max': 2}, 'verification': 'differente'})
		self.assertTrue(agence.load()['pratiques']['projet'], 'la vue publiée dit que le projet a son fichier')
		self.assertEqual(agence.load()['pratiques']['valeurs']['agents.max'], 2)
		self.assertIsNotNone(self.carte()['answer'])

	def test_un_preset_se_pose_avant_les_cles(self):
		self.propose({'preset': 'pr-tdd', 'valeurs': {'agents.max': 3}, 'sources': {'preset': 'CLAUDE.md:3', 'agents.max': 'réponse de la personne'}})
		self.clic(self.carte()['id'], 0)
		with open(self.projet()) as f:
			self.assertEqual(json.load(f), {'preset': 'pr-tdd', 'agents': {'max': 3}})

	def test_refuser_n_ecrit_rien(self):
		self.propose()
		code, _ = self.clic(self.carte()['id'], 1)
		self.assertEqual(code, 303)
		self.assertFalse(os.path.exists(self.projet()))
		self.assertEqual(self.carte()['answer'], 'Refuser')

	def test_un_second_clic_est_refuse(self):
		self.propose()
		qid = self.carte()['id']
		self.clic(qid, 0)
		self.assertEqual(self.clic(qid, 0)[0], 409)

	def test_refus_de_la_proposition(self):
		avant = self.state()['questions']
		for nom, objet, mot in (
				('clé inconnue', {'valeurs': {'foo.bar': 1}, 'sources': {'foo.bar': 'x'}}, 'clé inconnue'),
				('hors bornes', {'valeurs': {'agents.max': 99}, 'sources': {'agents.max': 'x'}}, 'agents.max'),
				('personnelle', {'valeurs': {'envoi.slack.variable': 'MON_JETON'}, 'sources': {'envoi.slack.variable': 'x'}}, 'personnel'),
				('sans source', {'valeurs': {'agents.max': 2}, 'sources': {}}, 'source manquante'),
				('aucun écart', {'valeurs': {'agents.max': 4}, 'sources': {'agents.max': 'x'}}, 'aucun écart'),
				('secret', {'valeurs': {'agents.max': 2}, 'sources': {'agents.max': FAUX_GITHUB}}, 'secret')):
			with self.subTest(nom):
				code, out, err = self.propose(objet)
				self.assertEqual((code, out), (1, ''))
				self.assertIn(mot, err)
				self.assertEqual(self.state()['questions'], avant, 'pas de carte pour une proposition refusée')
		self.assertFalse(os.path.exists(self.projet()))

	def test_json_casse_refuse(self):
		code, out, err = self.propose('{ nope')
		self.assertEqual((code, out), (1, ''))
		self.assertIn('illisible', err)

	def test_refuse_a_l_interlocuteur(self):
		with agence.tx() as st:
			st['panels']['interlocuteur'] = 'i1'
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'i1', 'title': 'x'}])
		self.run.reply(['cate', 'panel', 'title', 'agence-'], {'panelId': 'i1'})
		with unittest_patch(agence, 'caller_panel', lambda timeout=120: 'i1'):
			code, out, err = self.propose()
		self.assertEqual(code, 1)
		self.assertIn('ne lance rien', err)


@contextlib.contextmanager
def unittest_patch(obj, nom, valeur):
	ancien = getattr(obj, nom)
	setattr(obj, nom, valeur)
	try:
		yield
	finally:
		setattr(obj, nom, ancien)


class Ouvrir(Base):
	"""L'agent de setup : un par projet, enregistré (`panels.setup`), relié au panneau agence, avec la skill setup."""

	def setUp(self):
		super().setUp()
		self.booted()
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'title': 'Agence', 'type': 'agence'}])

	def demarrages(self):
		return self.run.ran('cate', 'agent', 'start')

	def test_ouvre_un_agent_de_setup_relie_au_panneau_agence(self):
		code, _ = agence.click('/setup/ouvrir', {'panneau': ['o1']})
		self.assertEqual(code, 303)
		(cmd,) = self.demarrages()
		self.assertEqual(cmd[-2], '/setup')  # --json suit toujours
		self.assertIn('Setup', cmd)
		self.assertEqual(agence.load()['panels']['setup'], 'p1')
		self.assertTrue(self.run.ran('cate', 'panel', 'link', 'p1', 'o1'))

	def test_un_seul_agent_de_setup_par_projet(self):
		agence.click('/setup/ouvrir', {'panneau': ['o1']})
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'title': 'Agence', 'type': 'agence'},
		                                          {'panelId': 'p1', 'title': 'Setup', 'type': 'terminal'}])
		agence.click('/setup/ouvrir', {'panneau': ['o1']})
		self.assertEqual(len(self.demarrages()), 1, 'la seconde demande rouvre celui qui tourne')

	def test_le_modele_suit_celui_de_l_interlocuteur(self):
		pratiques.regler(self.tmp, os.environ['HOME'], 'modele.interlocuteur', 'sonnet')
		agence.click('/setup/ouvrir', {'panneau': ['o1']})
		cmd = self.demarrages()[0]
		self.assertEqual(cmd[cmd.index('--model') + 1], 'sonnet')

	def test_fermer_ferme_le_panneau_et_l_oublie(self):
		agence.click('/setup/ouvrir', {'panneau': ['o1']})
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'p1', 'title': 'Setup', 'type': 'terminal'}])
		code, _ = agence.click('/setup/fermer', {})
		self.assertEqual(code, 303)
		self.assertTrue(self.run.ran('cate', 'panel', 'close', 'p1'))
		self.assertNotIn('setup', agence.load()['panels'])


class Skill(unittest.TestCase):
	"""La skill setup dit comment proposer, jamais comment écrire (FR-009)."""

	def setUp(self):
		with open(os.path.join(REPO, 'skills', 'setup', 'SKILL.md'), encoding='utf-8') as f:
			self.texte = f.read()

	def test_cite_ce_qu_elle_lit_et_ce_qu_elle_propose(self):
		for cmd in ('agence pratiques show', 'agence org --json', 'agence pratiques propose', 'agence org propose', 'agence setup --fin'):
			with self.subTest(cmd=cmd):
				self.assertIn(cmd, self.texte)

	def test_ne_cite_aucune_ecriture_ni_lancement(self):
		for cmd in ('pratiques set', 'pratiques unset', 'pratiques preset', 'agence start', 'agence need', 'agence fiche', 'agence draft'):
			with self.subTest(cmd=cmd):
				self.assertNotIn(cmd, self.texte)

	def test_ouvre_par_la_question_du_projet_et_borne_ses_lectures(self):
		self.assertIn('À quoi va servir cet espace', self.texte)
		self.assertIn('40 fichiers', self.texte)
		self.assertIn('200 Ko', self.texte)
		self.assertIn('6 questions', self.texte)

	def test_aucune_liste_de_cles_recopiee(self):
		for cle in ('livraison.mode', 'agents.max', 'verification'):
			with self.subTest(cle=cle):
				self.assertNotIn(cle, self.texte)


class Garde(Base):
	"""FR-009 : l'agent de setup ne passe ni par need, fiche, draft ni ask."""

	def setUp(self):
		super().setUp()
		self.booted()
		with agence.tx() as st:
			st['panels']['setup'] = 's1'
		self.p = unittest_patch(agence, 'caller_panel', lambda timeout=120: 's1')
		self.p.__enter__()
		self.addCleanup(self.p.__exit__, None, None, None)

	def lancer(self, *argv):
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, _ = self.cli(*argv)
		return code, err.getvalue()

	def test_refuse_need_fiche_draft_ask(self):
		for argv in (('need', 'add', '--kind', 'task', 'x'), ('fiche', 'add', 'x', '--type', 'idee'),
		             ('draft', 'new', '--cible', 'mail:a@b.fr', 'x'), ('ask', '--option', 'a|b', '--option', 'c|d', 'Q ?')):
			with self.subTest(argv=argv):
				code, err = self.lancer(*argv)
				self.assertEqual(code, 1)
				self.assertIn("l'agent de setup", err)


class GardeHook(Base):
	"""La garde des pages refuse à l'agent de setup ce qui lance du travail, comme à l'interlocuteur (FR-009)."""

	def bash(self, cmd, qui):
		with agence.tx() as st:
			st['panels'].update(setup='s1', orchestrator='o1')
		with unittest_patch(agence, 'caller_panel', lambda timeout=120: qui):
			return agence.guard({'tool_name': 'Bash', 'tool_input': {'command': cmd}, 'cwd': self.tmp}, 'pages')

	def test_refuse_ce_qui_lance(self):
		self.booted()
		for cmd in ('cate agent start x', 'cate panel create terminal', 'cate agent send --panel o1 "go"', 'agence start',
		            'agence boot --from s1', 'agence need add --kind task "x"'):
			with self.subTest(cmd=cmd):
				r = self.bash(cmd, 's1')
				self.assertEqual(r['hookSpecificOutput']['permissionDecision'], 'deny')
				self.assertIn("l'agent de setup", r['hookSpecificOutput']['permissionDecisionReason'])

	def test_l_orchestrateur_garde_ses_droits(self):
		self.booted()
		for cmd in ('cate agent start x', 'agence boot --from o1'):
			with self.subTest(cmd=cmd):
				self.assertIsNone(self.bash(cmd, 'o1'))

	def test_ce_que_le_setup_propose_passe(self):
		self.booted()
		for cmd in ('agence pratiques propose .cate/tmp/p.json --from s1', 'agence org propose .cate/tmp/o.json --from s1', 'agence setup --fin'):
			with self.subTest(cmd=cmd):
				self.assertIsNone(self.bash(cmd, 's1'))


if __name__ == '__main__':
	unittest.main()
