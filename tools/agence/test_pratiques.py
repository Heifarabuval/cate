#!/usr/bin/env python3
"""Pratiques réglables (spec 005, lot 1) : schéma, priorité des sources, refus, écriture, brief, presets figés,
publication par le régisseur et commande `agence pratiques`.

Tout tourne en faux HOME et en dossier temporaire : un test échoue s'il voit le vrai ~/.config ou ~/.cate.
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import unittest.mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import agence  # noqa: E402
import pratiques  # noqa: E402
from test_agence import FakeRun  # noqa: E402

NEUTRE = {
	'livraison.mode': 'pr', 'livraison.merge': 'clic', 'livraison.methode': 'squash', 'issue': 'libre', 'tests': 'libre',
	'speckit': 'non', 'verification': 'libre', 'preuve': None, 'agents.max': 4, 'declencheurs.actifs': ['T1'],
	'envoi.slack.variable': 'SLACK_USER_TOKEN', 'envoi.slack.fichier': None,
	'notifications.systeme': 'oui', 'notifications.rappel': 300, 'agents.modele': 'auto', 'agents.effort': 'auto',  # spec 008
}
PR_TDD = {
	'livraison.mode': 'pr', 'livraison.merge': 'clic', 'livraison.methode': 'rebase', 'issue': 'obligatoire', 'tests': 'tdd',
	'speckit': 'au-dela-d-une-journee', 'verification': 'differente', 'preuve': ['ci-verte', 'pr-mergee'], 'agents.max': 4,
	'declencheurs.actifs': ['T1', 'T2', 'T3'], 'envoi.slack.variable': 'SLACK_USER_TOKEN', 'envoi.slack.fichier': None,
	'notifications.systeme': 'oui', 'notifications.rappel': 300, 'agents.modele': 'auto', 'agents.effort': 'auto',
}
# Une valeur hors liste (ou hors type) par clé du schéma : SC-003, 100 % des clés.
HORS_LISTE = {
	'livraison.mode': 'branche', 'livraison.merge': 'auto', 'livraison.methode': 'fast-forward', 'issue': 'parfois',
	'tests': 'tdd-strict', 'speckit': 'souvent', 'verification': 'croisee', 'preuve': ['pr-mergee', 'deploiement'],
	'agents.max': 17, 'declencheurs.actifs': ['T1', 'T99'], 'envoi.slack.variable': 'xoxp-123-secret',
	'envoi.slack.fichier': 'xoxp-123-secret', 'modele.tri': 42, 'modele.interlocuteur': 'opus --dangerously-skip-permissions',
	'modele.implementation': ['sonnet'], 'modele.structurant': '', 'notifications.systeme': True,
	'notifications.rappel': 60, 'agents.modele': 'gpt', 'agents.effort': 'extreme',
}
# Spec 010, lot 7 (FR-010, SC-003) : modèle par rôle, proposé, jamais choisi par le code ; null hors des presets.
MODELES = {'modele.tri': None, 'modele.interlocuteur': None, 'modele.implementation': None, 'modele.structurant': None}
DEFAUT = {**NEUTRE, **MODELES}  # valeurs effectives sans aucun fichier
DEFAUT_PR_TDD = {**PR_TDD, **MODELES}


def imbrique(plat):
	"""{'livraison.mode': 'pr'} -> {'livraison': {'mode': 'pr'}} : la seule forme acceptée d'un fichier."""
	out = {}
	for cle, v in plat.items():
		d = out
		*tete, fin = cle.split('.')
		for t in tete:
			d = d.setdefault(t, {})
		d[fin] = v
	return out


class Base(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='pratiques-test-')
		self.addCleanup(shutil.rmtree, self.tmp, True)
		self.home = os.path.join(self.tmp, 'home')
		self.racine = os.path.join(self.tmp, 'projet')
		os.makedirs(self.home)
		os.makedirs(self.racine)
		env = unittest.mock.patch.dict(os.environ, {'HOME': self.home, 'AGENCE_ROOT': self.racine})
		env.start()
		self.addCleanup(env.stop)
		self.assertTrue(os.path.expanduser('~').startswith(self.tmp))
		self.projet = os.path.join(self.racine, '.cate', 'tmp', 'agence', 'pratiques.json')
		self.dev = os.path.join(self.home, '.config', 'agence', 'pratiques.json')

	def ecrit(self, chemin, contenu):
		os.makedirs(os.path.dirname(chemin), exist_ok=True)
		with open(chemin, 'w') as f:
			f.write(contenu if isinstance(contenu, str) else json.dumps(contenu))

	def lit(self, chemin):
		with open(chemin) as f:
			return json.load(f)

	def charge(self):
		return pratiques.charger(self.racine, self.home)

	def refus(self, *mots):
		pol = self.charge()
		self.assertTrue(pol['erreur'], 'politique acceptée à tort')
		for m in mots:
			self.assertIn(m, pol['erreur'])
		self.assertEqual(pol['valeurs'], DEFAUT)  # retombe sur neutre, sans rien appliquer
		return pol['erreur']


# ---------- T001 : priorité (FR-001) ----------

class Priorite(Base):
	def test_defaut_seul(self):
		pol = self.charge()
		self.assertEqual((pol['valeurs'], pol['erreur'], pol['preset']), (DEFAUT, None, 'neutre'))
		self.assertEqual(set(pol['sources'].values()), {'défaut'})
		self.assertEqual(set(pol['sources']), set(DEFAUT) | {'preset'})

	def test_chemins(self):
		self.assertEqual(pratiques.fichier_projet(self.racine), self.projet)
		self.assertEqual(pratiques.fichier_dev(self.home), self.dev)
		self.assertIsNone(pratiques.fichier_dev(None))  # HOME absent : fichier du dev absent

	def test_preset_du_dev(self):
		self.ecrit(self.dev, {'preset': 'pr-tdd'})
		pol = self.charge()
		self.assertEqual(pol['valeurs'], DEFAUT_PR_TDD)
		self.assertEqual((pol['preset'], pol['sources']['preset'], pol['sources']['tests']), ('pr-tdd', 'dev', 'dev'))

	def test_cles_du_dev_par_dessus_son_preset(self):
		self.ecrit(self.dev, {'preset': 'pr-tdd', 'livraison': {'methode': 'merge'}})
		pol = self.charge()
		self.assertEqual(pol['valeurs']['livraison.methode'], 'merge')
		self.assertEqual(pol['valeurs']['tests'], 'tdd')

	def test_preset_du_projet_par_dessus_le_dev(self):
		self.ecrit(self.dev, {'preset': 'pr-tdd', 'livraison': {'methode': 'merge'}})
		self.ecrit(self.projet, {'preset': 'neutre'})
		pol = self.charge()
		self.assertEqual(pol['valeurs'], DEFAUT)  # le preset du projet couvre aussi les clés du dev
		self.assertEqual({pol['sources'][k] for k in NEUTRE} | {pol['sources']['preset']}, {'projet'})
		self.assertEqual({pol['sources'][k] for k in MODELES}, {'défaut'})  # aucun preset ne pose de modèle
		self.assertEqual(pol['preset'], 'neutre')

	def test_cles_du_projet_en_dernier(self):
		self.ecrit(self.dev, {'tests': 'libre', 'issue': 'obligatoire'})
		self.ecrit(self.projet, {'preset': 'pr-tdd', 'tests': 'libre'})
		pol = self.charge()
		self.assertEqual((pol['valeurs']['tests'], pol['sources']['tests']), ('libre', 'projet'))
		self.assertEqual((pol['valeurs']['issue'], pol['sources']['issue']), ('obligatoire', 'projet'))

	def test_chaque_cle_rend_sa_source(self):
		"""SC-003 : chaque clé du schéma a une source défaut, dev et projet."""
		for cle, v in PR_TDD.items():
			if v == NEUTRE[cle]:
				v = {'livraison.mode': 'main', 'livraison.merge': 'dehors', 'agents.max': 6,
				     'envoi.slack.variable': 'MON_JETON', 'envoi.slack.fichier': '~/.env', 'notifications.systeme': 'non',
				     'notifications.rappel': 900, 'agents.modele': 'sonnet', 'agents.effort': 'high'}[cle]
			with self.subTest(cle=cle):
				for f in (self.dev, self.projet):
					with contextlib.suppress(FileNotFoundError):
						os.remove(f)
				self.assertEqual(self.charge()['sources'][cle], 'défaut')
				self.ecrit(self.dev, imbrique({cle: v}))
				pol = self.charge()
				self.assertEqual((pol['valeurs'][cle], pol['sources'][cle], pol['erreur']), (v, 'dev', None))
				self.ecrit(self.projet, imbrique({cle: v}))
				self.assertEqual(self.charge()['sources'][cle], 'projet')
				autres = {k for k, s in self.charge()['sources'].items() if s != 'défaut'}
				self.assertEqual(autres, {cle})

	def test_home_absent(self):
		self.ecrit(self.dev, {'tests': 'tdd'})
		self.assertEqual(pratiques.charger(self.racine, None)['valeurs'], DEFAUT)


# ---------- T002 : refus (FR-003, SC-003) ----------

class Refus(Base):
	def test_valeur_hors_liste_pour_chaque_cle(self):
		schema = pratiques.schema()
		self.assertEqual(set(HORS_LISTE), set(schema['cles']))
		for cle, v in HORS_LISTE.items():
			with self.subTest(cle=cle):
				self.ecrit(self.projet, imbrique({cle: v}))
				err = self.refus(self.projet, cle)
				spec = schema['cles'][cle]
				for permise in spec.get('valeurs') or spec.get('liste') or []:
					self.assertIn(pratiques.cle_choix(permise), err)

	def test_valeurs_permises_citees(self):
		self.ecrit(self.projet, {'tests': 'tdd-strict'})
		self.refus('tdd-strict', 'libre', 'tdd', 'tests', self.projet)

	def test_cle_inconnue(self):
		self.ecrit(self.dev, {'livraisn': {'mode': 'pr'}})
		self.refus('livraisn.mode', self.dev)

	def test_cle_pointee_refusee(self):
		self.ecrit(self.projet, {'livraisn.mode': 'pr'})
		self.refus('livraisn.mode', self.projet)
		self.ecrit(self.projet, {'livraison.mode': 'pr'})  # une seule forme : imbriquée
		self.refus('livraison.mode', self.projet)

	def test_type_faux(self):
		self.ecrit(self.projet, {'agents': {'max': '4'}})
		self.refus('agents.max', '1', '16', self.projet)
		self.ecrit(self.projet, {'agents': {'max': True}})
		self.refus('agents.max')
		self.ecrit(self.projet, {'agents': {'max': 0}})
		self.refus('agents.max')
		self.ecrit(self.projet, {'tests': ['tdd']})
		self.refus('tests')
		self.ecrit(self.projet, {'preuve': 'ci-verte'})
		self.refus('preuve')
		self.ecrit(self.projet, {'preuve': ['ci-verte', 'ci-verte']})
		self.refus('preuve')
		self.ecrit(self.projet, {'livraison': 'pr'})
		self.refus('livraison')

	def test_preset_inconnu(self):
		self.ecrit(self.dev, {'preset': 'flux-de-max'})
		self.refus('flux-de-max', 'neutre', 'pr-tdd', self.dev)

	def test_json_invalide(self):
		self.ecrit(self.projet, '{"tests": "tdd",}')
		self.refus(self.projet, 'line 1')

	def test_racine_pas_un_objet(self):
		self.ecrit(self.dev, '["tests"]')
		self.refus(self.dev, 'objet')

	def test_main_avec_preuve_de_pr(self):
		for preuve in (['pr-mergee'], ['ci-verte'], ['rapport', 'ci-verte']):
			with self.subTest(preuve=preuve):
				self.ecrit(self.projet, {'livraison': {'mode': 'main'}, 'preuve': preuve})
				self.refus('livraison.mode', 'preuve', self.projet)
		self.ecrit(self.projet, {'livraison': {'mode': 'main'}, 'preuve': ['rapport']})
		self.assertIsNone(self.charge()['erreur'])

	def test_combinaison_entre_deux_fichiers(self):
		self.ecrit(self.dev, {'preset': 'pr-tdd'})
		self.ecrit(self.projet, {'livraison': {'mode': 'main'}})  # preuve de pr-tdd : ci-verte, pr-mergee
		self.refus('livraison.mode', 'preuve', self.projet, self.dev)

	def test_verification_differente_avec_un_seul_agent(self):
		self.ecrit(self.projet, {'verification': 'differente', 'agents': {'max': 1}})
		self.refus('verification', 'agents.max', self.projet)

	def test_declencheur_absent_de_la_table(self):
		self.ecrit(self.projet, {'declencheurs': {'actifs': ['T1', 'T42']}})
		self.refus('declencheurs.actifs', 'T42', 'T10')


# ---------- T003 : écriture (FR-004) ----------

class Ecriture(Base):
	def test_set_cree_le_fichier_du_projet_imbrique(self):
		pratiques.regler(self.racine, self.home, 'livraison.methode', 'rebase')
		self.assertEqual(self.lit(self.projet), {'livraison': {'methode': 'rebase'}})
		self.assertFalse(os.path.exists(self.dev))
		pratiques.regler(self.racine, self.home, 'livraison.mode', 'pr')
		self.assertEqual(self.lit(self.projet), {'livraison': {'methode': 'rebase', 'mode': 'pr'}})

	def test_set_dev(self):
		pratiques.regler(self.racine, self.home, 'tests', 'tdd', dev=True)
		self.assertEqual(self.lit(self.dev), {'tests': 'tdd'})
		self.assertFalse(os.path.exists(self.projet))

	def test_set_invalide_ne_modifie_pas_le_fichier(self):
		self.ecrit(self.projet, {'tests': 'tdd'})
		avant = open(self.projet).read()
		for cle, v in (('tests', 'tdd-strict'), ('livraisn.mode', 'pr'), ('agents.max', '4'), ('preset', 'x')):
			with self.subTest(cle=cle), self.assertRaises(pratiques.Invalide):
				pratiques.regler(self.racine, self.home, cle, v)
			self.assertEqual(open(self.projet).read(), avant)

	def test_set_valide_le_resultat_entier(self):
		"""Chaque fichier est valide seul, mais la combinaison ne l'est pas : rien n'est écrit."""
		self.ecrit(self.dev, {'preset': 'pr-tdd'})
		with self.assertRaises(pratiques.Invalide) as cm:
			pratiques.regler(self.racine, self.home, 'livraison.mode', 'main')
		self.assertIn('preuve', str(cm.exception))
		self.assertFalse(os.path.exists(self.projet))

	def test_unset(self):
		self.ecrit(self.projet, {'livraison': {'methode': 'rebase', 'mode': 'pr'}, 'tests': 'tdd'})
		pratiques.retirer(self.racine, self.home, 'livraison.methode')
		self.assertEqual(self.lit(self.projet), {'livraison': {'mode': 'pr'}, 'tests': 'tdd'})
		pratiques.retirer(self.racine, self.home, 'livraison.mode')
		self.assertEqual(self.lit(self.projet), {'tests': 'tdd'})  # objet vide retiré
		pratiques.retirer(self.racine, self.home, 'tests')
		self.assertEqual(self.lit(self.projet), {})

	def test_preset(self):
		pratiques.poser_preset(self.racine, self.home, 'pr-tdd', dev=True)
		self.assertEqual(self.lit(self.dev), {'preset': 'pr-tdd'})
		self.assertEqual(self.charge()['valeurs'], DEFAUT_PR_TDD)
		with self.assertRaises(pratiques.Invalide):
			pratiques.poser_preset(self.racine, self.home, 'inconnu')
		self.assertFalse(os.path.exists(self.projet))

	def test_valeur_lue_comme_json_sinon_texte(self):
		self.assertEqual(pratiques.lire_valeur('4'), 4)
		self.assertEqual(pratiques.lire_valeur('["ci-verte"]'), ['ci-verte'])
		self.assertIsNone(pratiques.lire_valeur('null'))
		self.assertEqual(pratiques.lire_valeur('tdd'), 'tdd')
		self.assertEqual(pratiques.lire_valeur('~/.env'), '~/.env')

	def test_verrou_deux_ecrivains(self):
		"""Deux processus écrivent des clés différentes en même temps : le fichier reste valide et garde les deux."""
		code = ('import sys; sys.path.insert(0, %r); import pratiques\n'
		        'cle, a, b = sys.argv[1:4]\n'
		        'for i in range(40):\n'
		        '    pratiques.regler(%r, %r, cle, a if i %% 2 else b)\n') % (HERE, self.racine, self.home)
		procs = [subprocess.Popen([sys.executable, '-c', code, 'tests', 'tdd', 'libre']),
		         subprocess.Popen([sys.executable, '-c', code, 'issue', 'obligatoire', 'libre'])]
		for p in procs:
			self.assertEqual(p.wait(timeout=60), 0)
		self.assertEqual(self.lit(self.projet), {'tests': 'tdd', 'issue': 'obligatoire'})
		self.assertEqual([f for f in os.listdir(os.path.dirname(self.projet)) if f.startswith('tmp')], [])


# ---------- T004 : brief ----------

class Brief(Base):
	def brief(self):
		return pratiques.brief(self.charge(), 'Max')

	def test_invariants_toujours(self):
		for contenu in (None, {'preset': 'pr-tdd'}):
			with self.subTest(contenu=contenu):
				if contenu:
					self.ecrit(self.projet, contenu)
				b = self.brief()
				for invariant in pratiques.schema()['invariants']:
					self.assertIn(invariant.replace("{humain}", 'Max'), b)
				self.assertIn('Max', b)

	def test_neutre_aucune_exigence(self):
		b = self.brief()
		self.assertNotIn('rouge', b)
		self.assertNotIn('Closes #N', b)
		self.assertEqual(len(b.strip().splitlines()), len(pratiques.schema()['invariants']) + 1)  # titre + invariants

	def test_tdd(self):
		self.ecrit(self.projet, {'tests': 'tdd'})
		b = self.brief()
		self.assertIn('test rouge', b)
		self.assertIn('vu en échec avant le code', b)
		self.assertIn('projet', b)  # la source du réglage

	def test_issue_obligatoire(self):
		self.ecrit(self.dev, {'issue': 'obligatoire'})
		b = self.brief()
		self.assertIn('Closes #N', b)
		self.assertIn('dev', b)

	def test_speckit_et_verification(self):
		self.ecrit(self.projet, {'speckit': 'au-dela-d-une-journee', 'verification': 'differente'})
		b = self.brief()
		self.assertIn('spec-kit', b)
		self.assertIn('une journée', b)
		self.assertIn('vérificateur', b)
		self.ecrit(self.projet, {'speckit': 'toujours'})
		self.assertIn('spec-kit', self.brief())

	def test_libre_n_ajoute_rien(self):
		base = self.brief()
		self.ecrit(self.projet, {'tests': 'libre', 'issue': 'libre', 'verification': 'libre', 'speckit': 'non'})
		self.assertEqual(self.brief().replace('projet', 'défaut'), base.replace('projet', 'défaut'))


# ---------- T005 : presets figés (SC-005) ----------

class Presets(unittest.TestCase):
	def test_neutre(self):
		self.assertEqual(pratiques.schema()['presets']['neutre']['valeurs'], NEUTRE)

	def test_pr_tdd(self):
		self.assertEqual(pratiques.schema()['presets']['pr-tdd']['valeurs'], PR_TDD)

	def test_cles_des_presets_dans_le_schema(self):
		schema = pratiques.schema()
		self.assertEqual(len(schema['cles']), 20)  # 12 de 005, 4 modele.* de 010, 4 de 008
		for nom, p in schema['presets'].items():
			with self.subTest(preset=nom):
				self.assertLessEqual(set(p['valeurs']), set(schema['cles']))
		# neutre est la base, complet sauf le modèle par rôle (null par défaut, jamais posé par un preset)
		self.assertEqual(set(schema['presets']['neutre']['valeurs']), set(schema['cles']) - set(MODELES))

	def test_modele_par_role_sc003(self):
		"""T120, SC-003 : quatre clés modele.*, chaîne ou null, null par défaut, absentes des presets livrés."""
		schema = pratiques.schema()
		self.assertLessEqual(set(MODELES), set(schema['cles']))
		for nom, p in schema['presets'].items():
			with self.subTest(preset=nom):
				self.assertEqual(set(p['valeurs']) & set(MODELES), set())
		tmp = tempfile.mkdtemp(prefix='pratiques-modele-')
		self.addCleanup(shutil.rmtree, tmp, True)
		for nom in schema['presets']:
			f = pratiques.fichier_projet(tmp)
			os.makedirs(os.path.dirname(f), exist_ok=True)
			with open(f, 'w') as fh:
				json.dump({'preset': nom}, fh)
			pol = pratiques.charger(tmp, None)
			with self.subTest(preset=nom):
				self.assertEqual({k: pol['valeurs'][k] for k in MODELES}, MODELES)
				self.assertEqual({pol['sources'][k] for k in MODELES}, {'défaut'})


class ModeleParRole(Base):
	"""T120 : une clé modele.* se pose d'une commande (chaîne ou null), garde sa source et survit à un preset."""

	def test_chaine_ou_null_par_dev_et_projet(self):
		for cle in MODELES:
			with self.subTest(cle=cle):
				for f in (self.dev, self.projet):
					with contextlib.suppress(FileNotFoundError):
						os.remove(f)
				self.ecrit(self.dev, imbrique({cle: 'claude-opus-5-5'}))
				pol = self.charge()
				self.assertEqual((pol['valeurs'][cle], pol['sources'][cle], pol['erreur']), ('claude-opus-5-5', 'dev', None))
				self.ecrit(self.projet, imbrique({cle: None}))
				pol = self.charge()
				self.assertEqual((pol['valeurs'][cle], pol['sources'][cle]), (None, 'projet'))

	def test_une_commande_et_preset_sans_effet(self):
		self.assertEqual(pratiques.regler(self.racine, self.home, 'modele.implementation', 'sonnet'), self.projet)
		self.assertEqual(self.lit(self.projet), {'modele': {'implementation': 'sonnet'}})
		pratiques.poser_preset(self.racine, self.home, 'pr-tdd')
		self.assertEqual(self.charge()['valeurs']['modele.implementation'], 'sonnet')  # un preset ne touche pas au modèle

	def test_refus_nomme_la_cle(self):
		for v in ('opus --dangerously-skip-permissions', '', 42, ['sonnet'], True):
			with self.subTest(v=v):
				self.ecrit(self.projet, {'modele': {'tri': v}})
				self.refus('modele.tri', self.projet)

	def test_presets_valides_par_le_schema(self):
		tmp = tempfile.mkdtemp(prefix='pratiques-presets-')
		self.addCleanup(shutil.rmtree, tmp, True)
		for nom in pratiques.schema()['presets']:
			with self.subTest(preset=nom):
				f = pratiques.fichier_projet(tmp)
				os.makedirs(os.path.dirname(f), exist_ok=True)
				with open(f, 'w') as fh:
					json.dump({'preset': nom}, fh)
				self.assertIsNone(pratiques.charger(tmp, None)['erreur'])


# ---------- T006 : le régisseur publie la politique (FR-013) ----------

class Tour(Base):
	def setUp(self):
		super().setUp()
		os.environ['CATE_SOCKET'] = os.path.join(self.tmp, 'x.sock')
		ancien = agence.RUN
		agence.RUN = FakeRun()
		self.addCleanup(setattr, agence, 'RUN', ancien)
		with agence.tx() as st:
			st['panels']['orchestrator'] = 'o1'

	def test_etat_neuf_sans_politique(self):
		self.assertIn('pratiques', agence.empty())
		self.assertIsNone(agence.empty()['pratiques'])

	def test_watch_ecrit_la_politique(self):
		agence.un_tour()
		pub = agence.load()['pratiques']
		self.assertEqual((pub['valeurs'], pub['erreur'], pub['preset']), (DEFAUT, None, 'neutre'))
		self.ecrit(self.projet, {'tests': 'tdd'})
		agence.un_tour()
		pub = agence.load()['pratiques']
		self.assertEqual((pub['valeurs']['tests'], pub['sources']['tests']), ('tdd', 'projet'))

	def test_fichier_invalide_publie_l_erreur_et_le_tour_continue(self):
		self.ecrit(self.projet, {'tests': 'tdd-strict'})
		agence.un_tour()
		st = agence.load()
		self.assertIn('tdd-strict', st['pratiques']['erreur'])
		self.assertEqual(st['pratiques']['valeurs'], DEFAUT)
		self.assertEqual(st['humain'], agence.nom())  # le reste du tour a eu lieu

	def test_etat_ancien_complete(self):
		with open(agence.state_file()) as f:
			ancien = json.load(f)
		ancien.pop('pratiques', None)
		with open(agence.state_file(), 'w') as f:
			json.dump(ancien, f)
		self.assertIsNone(agence.load()['pratiques'])
		agence.un_tour()
		self.assertEqual(agence.load()['pratiques']['valeurs'], DEFAUT)


# ---------- commande `agence pratiques` (FR-004) ----------

class Commande(Base):
	def agence(self, *argv):
		out, err = io.StringIO(), io.StringIO()
		with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
			code = agence.main(list(argv))
		return code, out.getvalue(), err.getvalue()

	def test_show_json_neutre_source_defaut(self):
		code, out, _ = self.agence('pratiques', 'show', '--json')
		pol = json.loads(out)
		self.assertEqual((code, pol['valeurs'], pol['erreur']), (0, DEFAUT, None))
		self.assertEqual({pol['sources'][k] for k in DEFAUT}, {'défaut'})

	def test_show_json_cle_du_projet(self):
		self.ecrit(self.projet, {'tests': 'tdd'})
		pol = json.loads(self.agence('pratiques', 'show', '--json')[1])
		self.assertEqual(pol['sources']['tests'], 'projet')
		self.assertEqual({s for k, s in pol['sources'].items() if k != 'tests'}, {'défaut'})

	def test_show_texte(self):
		code, out, _ = self.agence('pratiques', 'show')
		self.assertEqual(code, 0)
		self.assertIn('neutre', out)
		for cle in NEUTRE:
			self.assertIn(cle, out)

	def test_show_refuse_une_politique_invalide(self):
		self.ecrit(self.projet, {'tests': 'tdd-strict'})
		code, _, err = self.agence('pratiques', 'show')
		self.assertEqual(code, 2)
		self.assertIn('tdd-strict', err)

	def test_set_unset_preset(self):
		self.assertEqual(self.agence('pratiques', 'set', 'agents.max', '6')[0], 0)
		self.assertEqual(self.lit(self.projet), {'agents': {'max': 6}})
		self.assertEqual(self.agence('pratiques', 'preset', 'pr-tdd', '--dev')[0], 0)
		self.assertEqual(self.lit(self.dev), {'preset': 'pr-tdd'})
		self.assertEqual(self.agence('pratiques', 'unset', 'agents.max')[0], 0)
		self.assertEqual(self.lit(self.projet), {})
		self.assertEqual(self.agence('pratiques', 'set', 'preuve', '["rapport"]', '--dev')[0], 0)
		self.assertEqual(self.lit(self.dev), {'preset': 'pr-tdd', 'preuve': ['rapport']})

	def test_set_invalide_code_2(self):
		code, _, err = self.agence('pratiques', 'set', 'tests', 'tdd-strict')
		self.assertEqual(code, 2)
		self.assertIn('libre', err)
		self.assertFalse(os.path.exists(self.projet))

	def test_check(self):
		self.assertEqual(self.agence('pratiques', 'check')[0], 0)
		self.ecrit(self.dev, '{')
		code, _, err = self.agence('pratiques', 'check')
		self.assertEqual(code, 2)
		self.assertIn(self.dev, err)
		self.assertEqual(open(self.dev).read(), '{')  # check n'écrit rien

	def test_brief(self):
		self.ecrit(self.projet, {'tests': 'tdd'})
		code, out, _ = self.agence('pratiques', 'brief')
		self.assertEqual(code, 0)
		self.assertIn('test rouge', out)


if __name__ == '__main__':
	unittest.main()
