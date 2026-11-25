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


class Aide(Base):
	"""Projet démarré, `propose`, la carte et le clic : ce que partagent les tests des cartes de setup."""

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


class Setup(Aide):
	"""Carte de pratiques posée par `agence pratiques propose`, écrite au clic Appliquer."""

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

	def test_la_phrase_part_avec_le_prompt_de_l_agent(self):
		agence.click('/setup/ouvrir', {'panneau': ['o1'], 'phrase': ['mets le plafond à 2']})
		self.assertEqual(self.demarrages()[0][-2], '/setup mets le plafond à 2')

	def test_la_phrase_va_a_l_agent_qui_tourne_sans_en_lancer_un_second(self):
		agence.click('/setup/ouvrir', {'panneau': ['o1']})
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'title': 'Agence', 'type': 'agence'},
		                                          {'panelId': 'p1', 'title': 'Setup', 'type': 'terminal'}])
		agence.click('/setup/ouvrir', {'panneau': ['o1'], 'phrase': ['ajoute un relecteur']})
		self.assertEqual(len(self.demarrages()), 1)
		(envoi,) = self.run.ran('cate', 'agent', 'send')
		self.assertEqual(envoi[:5], ['cate', 'agent', 'send', '--panel', 'p1'])
		self.assertIn('ajoute un relecteur', envoi[5])

	def test_la_commande_agence_setup_ouvre_sans_rien_ecrire(self):
		avant = agence.load()['pratiques']
		code, out = self.cli('setup', 'ce projet sert aussi au SEO')
		self.assertEqual(code, 0)
		self.assertIn('p1', out)
		self.assertEqual(self.demarrages()[0][-2], '/setup ce projet sert aussi au SEO')
		self.assertFalse(os.path.exists(pratiques.fichier_projet(self.tmp)))
		self.assertFalse(os.path.exists(os.path.join(self.tmp, '.cate', 'tmp', 'agence', 'setup.json')))
		self.assertEqual(agence.load()['pratiques'], avant)

	def test_la_commande_sans_phrase_ouvre_et_fin_ferme(self):
		self.assertEqual(self.cli('setup')[0], 0)
		self.assertEqual(self.demarrages()[0][-2], '/setup')
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'p1', 'title': 'Setup', 'type': 'terminal'}])
		self.assertEqual(self.cli('setup', '--fin')[0], 0)
		self.assertNotIn('setup', agence.load()['panels'])

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

	def test_lit_la_memoire_a_chaque_ouverture_et_ne_l_ecrit_jamais(self):
		for mot in ('.cate/tmp/agence/setup.json', 'dernierSetup', 'Noter ce contexte', 'resume', '200 lignes', 'illisible'):
			with self.subTest(mot=mot):
				self.assertIn(mot, self.texte)

	def test_distingue_l_ajustement_ponctuel_la_relance_en_bloc_et_le_premier_setup(self):
		for mot in ('Ajustement ponctuel', 'Relance en bloc', 'Premier setup', 'seulement', 'ne propose que les écarts', 'au plus une question par phrase'):
			with self.subTest(mot=mot):
				self.assertIn(mot, self.texte)

	def test_aucune_liste_de_cles_recopiee(self):
		for cle in ('livraison.mode', 'agents.max', 'verification'):
			with self.subTest(cle=cle):
				self.assertNotIn(cle, self.texte)


JOUR = '2026-12-16'
MEMOIRE = {'version': 1, 'objet': 'Refonte de l\'espace donateur', 'contexte': [{'date': '2026-11-25', 'texte': 'Les relectures se font le jeudi'}],
           'decisions': {'tests': {'valeur': 'tdd', 'raison': 'CLAUDE.md impose les tests d\'abord', 'source': 'CLAUDE.md:12', 'date': '2026-11-25'}},
           'dernierSetup': '2026-11-25'}


class Memoire(unittest.TestCase):
	"""setup.json (FR-017, FR-021) : lisible, éditable à la main, jamais un secret, jamais plus de 200 lignes de contexte."""

	def setUp(self):
		import tempfile
		self.racine = tempfile.mkdtemp(prefix='setup-mem-')
		self.addCleanup(__import__('shutil').rmtree, self.racine, True)

	def poser(self, contenu):
		os.makedirs(os.path.dirname(setup.fichier(self.racine)), exist_ok=True)
		with open(setup.fichier(self.racine), 'w') as f:
			f.write(contenu if isinstance(contenu, str) else json.dumps(contenu, indent=2, ensure_ascii=False))

	def test_absente_n_est_pas_une_erreur(self):
		self.assertEqual(setup.lire(self.racine), (None, None))

	def test_lue_telle_quelle_meme_editee_a_la_main(self):
		editee = json.loads(json.dumps(MEMOIRE))
		editee['decisions']['tests']['raison'] = 'Je l\'ai corrigée à la main'
		editee['contexte'] = []
		self.poser(editee)
		self.assertEqual(setup.lire(self.racine), (editee, None))

	def test_illisible_ou_mal_formee_dit_pourquoi_sans_empecher_le_setup(self):
		for nom, contenu, mot in (('json cassé', '{ nope', 'illisible'), ('liste', '[]', 'objet'),
		                          ('clé inconnue', {'version': 1, 'autre': 1}, 'clé inconnue'),
		                          ('version', {'version': 2}, 'version'),
		                          ('décision sans raison', {'version': 1, 'decisions': {'tests': {'valeur': 'tdd'}}}, 'décision'),
		                          ('secret', {'version': 1, 'objet': FAUX_GITHUB}, 'secret')):
			with self.subTest(nom):
				self.poser(contenu)
				memoire, erreur = setup.lire(self.racine)
				self.assertIsNone(memoire)
				self.assertIn(mot, erreur)

	def prop(self, **memoire):
		return setup.lire_proposition(json.dumps({'valeurs': {'agents.max': 2}, 'sources': {'agents.max': 'réponse de la personne'},
		                                          'memoire': memoire}))

	def test_fusion_date_chaque_ligne_et_garde_la_source_de_chaque_decision(self):
		neuve = setup.fusionner(None, self.prop(objet='Un outil de devis', contexte=['Deux personnes relisent'], raisons={'agents.max': 'Le Mac a 16 Go'}), JOUR)
		self.assertEqual(neuve, {'version': 1, 'objet': 'Un outil de devis', 'contexte': [{'date': JOUR, 'texte': 'Deux personnes relisent'}],
		                         'decisions': {'agents.max': {'valeur': 2, 'raison': 'Le Mac a 16 Go', 'source': 'réponse de la personne', 'date': JOUR}},
		                         'dernierSetup': JOUR})

	def test_fusion_garde_l_existant_et_ne_change_que_ce_qui_est_dit(self):
		neuve = setup.fusionner(MEMOIRE, self.prop(contexte=['Un relecteur SEO arrive']), JOUR)
		self.assertEqual(neuve['objet'], MEMOIRE['objet'])
		self.assertEqual([c['texte'] for c in neuve['contexte']], ['Les relectures se font le jeudi', 'Un relecteur SEO arrive'])
		self.assertEqual(neuve['decisions']['tests'], MEMOIRE['decisions']['tests'])
		self.assertEqual(neuve['decisions']['agents.max']['valeur'], 2)
		self.assertEqual(neuve['dernierSetup'], JOUR)

	def test_au_dela_de_200_lignes_il_faut_un_resume(self):
		pleine = json.loads(json.dumps(MEMOIRE))
		pleine['contexte'] = [{'date': '2026-11-25', 'texte': f'ligne {n}'} for n in range(200)]
		with self.assertRaises(setup.Invalide) as ctx:
			setup.fusionner(pleine, self.prop(contexte=['une de trop']), JOUR)
		self.assertIn('résumé', str(ctx.exception))
		resume = setup.fusionner(pleine, self.prop(resume=['Tout tient en une ligne']), JOUR)
		self.assertEqual([c['texte'] for c in resume['contexte']], ['Tout tient en une ligne'])

	def test_secret_refuse_dans_la_proposition(self):
		with self.assertRaises(setup.Invalide):
			self.prop(contexte=[FAUX_SLACK])
		with self.assertRaises(setup.Invalide):
			self.prop(raisons={'agents.max': FAUX_GITHUB})

	def test_ecrire_atomiquement_et_mettre_de_cote_l_illisible_sans_la_supprimer(self):
		self.poser('{ nope')
		setup.ecrire(self.racine, MEMOIRE)
		self.assertEqual(setup.lire(self.racine), (MEMOIRE, None))
		with open(setup.fichier(self.racine) + '.illisible') as f:
			self.assertEqual(f.read(), '{ nope')

	def test_diff_des_lignes_ajoutees_et_retirees(self):
		noms = {'agents.max': 'Agents en même temps'}
		neuve = setup.fusionner(MEMOIRE, self.prop(objet='Refonte et SEO', contexte=['Un relecteur SEO arrive'], raisons={'agents.max': 'Le Mac rame'}), JOUR)
		lignes = setup.diff(MEMOIRE, neuve, noms)
		self.assertIn('- Mémoire, objet : Refonte de l\'espace donateur → Refonte et SEO', lignes)
		self.assertIn('- Mémoire, contexte ajouté : Un relecteur SEO arrive', lignes)
		self.assertIn('- Mémoire, raison de « Agents en même temps » : Le Mac rame', lignes)
		resume = setup.fusionner(MEMOIRE, self.prop(resume=['Résumé']), JOUR)
		self.assertIn('- Mémoire, contexte retiré : Les relectures se font le jeudi', setup.diff(MEMOIRE, resume, noms))

	def test_rien_de_nouveau_pas_de_diff(self):
		meme = setup.fusionner(MEMOIRE, setup.lire_proposition(json.dumps({'memoire': {'objet': MEMOIRE['objet']}})), '2026-11-25')
		self.assertEqual(setup.diff(MEMOIRE, meme, {}), [])


class SetupMemoire(Aide):
	"""La carte de pratiques porte la mémoire : diff avant le clic, écriture dans le même clic (FR-016, FR-017)."""

	def setUp(self):
		super().setUp()
		patch = unittest_patch(agence, 'jour', lambda: JOUR)
		patch.__enter__()
		self.addCleanup(patch.__exit__, None, None, None)

	def memoire(self):
		return setup.lire(self.tmp)

	def avec_memoire(self, **memoire):
		return {**PROPOSITION, 'memoire': memoire}

	def test_la_carte_montre_le_diff_de_la_memoire_et_n_ecrit_rien(self):
		self.propose(self.avec_memoire(objet='Un outil de devis', contexte=['Deux personnes relisent'], raisons={'agents.max': 'Le Mac a 16 Go'}))
		q = self.carte()['question']
		self.assertIn('- Mémoire, objet : aucun → Un outil de devis', q)
		self.assertIn('- Mémoire, contexte ajouté : Deux personnes relisent', q)
		self.assertIn('- Mémoire, raison de « Agents en même temps » : Le Mac a 16 Go', q)
		self.assertFalse(os.path.exists(setup.fichier(self.tmp)))

	def test_appliquer_ecrit_la_memoire_dans_le_meme_clic(self):
		self.propose(self.avec_memoire(objet='Un outil de devis', raisons={'agents.max': 'Le Mac a 16 Go'}))
		self.clic(self.carte()['id'], 0)
		memoire, erreur = self.memoire()
		self.assertIsNone(erreur)
		self.assertEqual(memoire['objet'], 'Un outil de devis')
		self.assertEqual(memoire['decisions']['agents.max'], {'valeur': 2, 'raison': 'Le Mac a 16 Go', 'source': 'réponse de la personne', 'date': JOUR})
		self.assertEqual(memoire['decisions']['verification']['source'], 'CLAUDE.md:12')
		self.assertEqual(memoire['dernierSetup'], JOUR)

	def test_sans_clic_ou_refuse_rien_n_est_ecrit(self):
		self.propose(self.avec_memoire(objet='Un outil de devis'))
		self.assertFalse(os.path.exists(setup.fichier(self.tmp)))
		self.clic(self.carte()['id'], 1)
		self.assertFalse(os.path.exists(setup.fichier(self.tmp)))
		self.assertFalse(os.path.exists(self.projet()))

	def test_un_contexte_seul_pose_la_carte_noter_et_n_ecrit_que_la_memoire(self):
		self.propose({'memoire': {'contexte': ['Les relectures se font toujours le jeudi']}})
		q = self.carte()
		self.assertTrue(q['question'].startswith('Noter ce contexte ?'))
		self.assertEqual([o['label'] for o in q['options']], ['Noter', 'Refuser'])
		self.clic(q['id'], 0)
		self.assertFalse(os.path.exists(self.projet()), 'aucune clé : le fichier de réglages n\'est pas touché')
		self.assertEqual([c['texte'] for c in self.memoire()[0]['contexte']], ['Les relectures se font toujours le jeudi'])

	def test_rien_a_changer_ni_reglage_ni_memoire_est_refuse(self):
		self.propose(self.avec_memoire(objet='Un outil de devis'))
		self.clic(self.carte()['id'], 0)
		avant = self.state()['questions']
		code, out, err = self.propose({'memoire': {'objet': 'Un outil de devis'}})
		self.assertEqual((code, out), (1, ''))
		self.assertIn('aucun écart', err)
		self.assertEqual(self.state()['questions'], avant)

	def test_une_memoire_illisible_n_empeche_pas_le_setup_elle_est_mise_de_cote(self):
		os.makedirs(os.path.dirname(setup.fichier(self.tmp)), exist_ok=True)
		with open(setup.fichier(self.tmp), 'w') as f:
			f.write('{ nope')
		code, out, _ = self.propose(self.avec_memoire(objet='Un outil de devis'))
		self.assertEqual(code, 0)
		self.assertIn('mémoire du setup illisible', self.carte()['question'])
		self.clic(self.carte()['id'], 0)
		self.assertEqual(self.memoire()[0]['objet'], 'Un outil de devis')
		with open(setup.fichier(self.tmp) + '.illisible') as f:
			self.assertEqual(f.read(), '{ nope')

	def test_la_memoire_editee_a_la_main_est_relue_telle_quelle(self):
		self.propose(self.avec_memoire(objet='Un outil de devis', contexte=['A', 'B']))
		self.clic(self.carte()['id'], 0)
		editee = self.memoire()[0]
		editee['contexte'] = editee['contexte'][:1]
		with open(setup.fichier(self.tmp), 'w') as f:
			json.dump(editee, f)
		self.propose({'valeurs': {'agents.max': 3}, 'sources': {'agents.max': 'x'}, 'memoire': {'contexte': ['C']}})
		self.clic(self.carte()['id'], 0)
		self.assertEqual([c['texte'] for c in self.memoire()[0]['contexte']], ['A', 'C'])

	def test_secret_dans_la_memoire_refuse(self):
		code, out, err = self.propose(self.avec_memoire(contexte=[FAUX_SLACK]))
		self.assertEqual((code, out), (1, ''))
		self.assertIn('secret', err)


class Perimee(Aide):
	"""FR-018 : une clé que la carte change a bougé depuis la proposition (formulaire, autre client) : refus, rien d'écrit."""

	def test_un_reglage_change_au_formulaire_rend_la_carte_perimee(self):
		self.propose()
		q = self.carte()
		pratiques.regler(self.tmp, os.environ['HOME'], 'agents.max', 3)  # le formulaire passe avant le clic
		with open(self.projet()) as f:
			ecrit = f.read()
		code, message = self.clic(q['id'], 0)
		self.assertEqual(code, 409)
		self.assertIn('les réglages ont changé depuis la proposition', message)
		with open(self.projet()) as f:
			self.assertEqual(f.read(), ecrit, 'le dernier clic du formulaire gagne, la carte n\'écrase rien')
		self.assertFalse(os.path.exists(setup.fichier(self.tmp)), 'ni la mémoire')
		self.assertEqual(self.carte()['answer'], 'Périmée', 'la carte est fermée, l\'agent reproposera')
		self.assertTrue(self.run.ran('cate', 'agent', 'send', '--panel', 'a1'), 'l\'agent l\'apprend')

	def test_une_cle_que_la_carte_ne_touche_pas_ne_la_perime_pas(self):
		self.propose()
		pratiques.regler(self.tmp, os.environ['HOME'], 'issue', 'obligatoire')
		self.assertEqual(self.clic(self.carte()['id'], 0)[0], 303)
		with open(self.projet()) as f:
			self.assertEqual(json.load(f)['issue'], 'obligatoire')

	def test_le_formulaire_et_la_carte_ecrivent_le_meme_fichier_et_rendent_la_meme_valeur(self):
		pratiques.regler(self.tmp, os.environ['HOME'], 'agents.max', 2)
		formulaire = agence.politique()['valeurs']['agents.max']
		os.remove(self.projet())
		self.propose({'valeurs': {'agents.max': 2}, 'sources': {'agents.max': 'x'}})
		self.clic(self.carte()['id'], 0)
		self.assertEqual(agence.politique()['valeurs']['agents.max'], formulaire)


class Raisons(Base):
	"""Q12 : la raison d'un réglage se lit sous sa ligne du formulaire, depuis setup.json, en lecture seule."""

	def test_la_vue_publiee_porte_les_raisons(self):
		os.makedirs(os.path.dirname(setup.fichier(self.tmp)))
		with open(setup.fichier(self.tmp), 'w') as f:
			json.dump(MEMOIRE, f)
		vue = pratiques.vue(self.tmp, os.environ['HOME'], pratiques.charger(self.tmp, os.environ['HOME']), 'Max')
		self.assertEqual(vue['raisons'], {'tests': 'CLAUDE.md impose les tests d\'abord'})

	def test_sans_memoire_ou_illisible_aucune_raison(self):
		vue = lambda: pratiques.vue(self.tmp, os.environ['HOME'], pratiques.charger(self.tmp, os.environ['HOME']), 'Max')  # noqa: E731
		self.assertEqual(vue()['raisons'], {})
		os.makedirs(os.path.dirname(setup.fichier(self.tmp)))
		with open(setup.fichier(self.tmp), 'w') as f:
			f.write('{ nope')
		self.assertEqual(vue()['raisons'], {})


ORGA = {'maxAgents': 2, 'roles': {'dev': {'name': 'Dev', 'model': 'sonnet', 'effort': 'medium', 'tools': ['read', 'edit'], 'done': 'PR ouverte'},
                                  'verif': {'name': 'Vérificateur', 'model': 'sonnet', 'effort': 'high', 'tools': ['read'], 'done': 'Preuves relancées'}},
        'links': [{'from': 'dev', 'to': 'verif', 'verifiedBy': 'verif', 'click': 'after'}]}


class DiffOrga(unittest.TestCase):
	"""FR-016 : la carte d'orga montre les postes et les liens ajoutés, retirés, modifiés avant le clic."""

	def avec(self, **patch):
		neuve = json.loads(json.dumps(ORGA))
		for cle, valeur in patch.items():
			neuve[cle] = valeur
		return neuve

	def test_identique_ne_dit_rien(self):
		self.assertEqual(setup.diff_orga(ORGA, ORGA), [])

	def test_poste_et_lien_ajoutes(self):
		roles = {**ORGA['roles'], 'seo': {'name': 'Relecteur SEO', 'model': 'sonnet', 'effort': 'low', 'tools': ['read'], 'done': 'Audit relu'}}
		neuve = self.avec(roles=roles, links=ORGA['links'] + [{'from': 'dev', 'to': 'seo', 'click': 'never'}])
		self.assertEqual(setup.diff_orga(ORGA, neuve), ['- Orga, poste ajouté : seo (Relecteur SEO)', '- Orga, lien ajouté : dev -> seo ; clic jamais'])

	def test_poste_et_lien_retires(self):
		neuve = self.avec(roles={'dev': ORGA['roles']['dev']}, links=[])
		self.assertEqual(setup.diff_orga(ORGA, neuve), ['- Orga, poste retiré : verif (Vérificateur)', '- Orga, lien retiré : dev -> verif'])

	def test_poste_et_lien_modifies_disent_le_champ(self):
		roles = {**ORGA['roles'], 'dev': {**ORGA['roles']['dev'], 'effort': 'high', 'tools': ['read']}}
		neuve = self.avec(roles=roles, links=[{'from': 'dev', 'to': 'verif', 'click': 'before'}])
		self.assertEqual(setup.diff_orga(ORGA, neuve), ['- Orga, poste modifié : dev (effort : medium → high ; tools : read, edit → read)',
		                                               '- Orga, lien modifié : dev -> verif (vérifié par : verif → aucun ; clic : après le travail → avant le travail)'])

	def test_plafond_modifie(self):
		self.assertEqual(setup.diff_orga(ORGA, self.avec(maxAgents=3)), ['- Orga, agents vivants au plus : 2 → 3'])


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
