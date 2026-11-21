#!/usr/bin/env python3
"""Cercle vertueux (spec 004, lot 2) : l'évaluateur des déclencheurs, son journal, son bilan, le mode à blanc.

Rien ne part jamais en lot 2 : la décision d'une commande vraie est `blanc`, journalisée. L'évaluateur est une
fonction pure sur des instantanés fabriqués (agents, usage, horloge) ; aucun modèle, aucun appel à la CLI cate.
Tout ce qui s'écrit tourne dans un dossier temporaire, HOME compris : un test échoue s'il voit le vrai ~/.cate
ou le vrai ~/.claude.
"""
import contextlib
import copy
import inspect
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
import unittest.mock
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
import pratiques  # noqa: E402

PANNEAU = '3f2a9c1e-7b4d-4e0a-9d51-0a1b2c3d4e5f'
AUTRE = '9a8b7c6d-1111-4222-8333-444455556666'
# Midi, heure locale : J-N tombe le même jour local quel que soit le fuseau de la machine.
MIDI = datetime(2026, 11, 20, 12, 0, 0).timestamp()
CHAMPS_TABLE = ('commande', 'agentId', 'condition', 'donnee', 'seuil', 'classe', 'repos', 'plafond', 'indicateur', 'hypothese')
SETUP = ('/learn', '/audit-config', '/update-config', '/fewer-permission-prompts', '/autocompact', 'skill-creator', 'claude-md-improver')
CLES_LIGNE = {'ts', 'commande', 'classe', 'decision', 'panneau', 'raison', 'avant', 'apres', 'verdict'}


def iso(epoch):
	return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec='seconds')


def jour(epoch):
	return datetime.fromtimestamp(epoch).strftime('%Y-%m-%d')


def mesure(ctx, entree=None, sortie=10, cout=1.5):
	return {'contextTokens': ctx, 'inputTokens': entree if entree is not None else ctx, 'outputTokens': sortie, 'costUsd': cout}


def agent(state='waitingForInput', peut=True, prompts=None, agent_id='claude-code', panneau=PANNEAU):
	return {'panelId': panneau, 'title': 'Orchestrateur', 'agentId': agent_id, 'agentName': 'Claude Code',
	        'state': state, 'canReceivePrompt': peut, 'prompts': prompts or []}


def instantane(ctx, usage=True, actifs=('T1',), **kw):
	"""Ce que un_tour lit : l'orchestrateur, cate agent list, cate agent usage (contextTokens absent = null), et
	`declencheurs.actifs` de la politique (preset neutre par défaut)."""
	# contextTokens absent du champ : le lot 1 n'est pas mergé, ou l'agent ne compte pas ses jetons
	m = mesure(ctx) if ctx is not None else {'inputTokens': 5, 'outputTokens': 5, 'costUsd': None}
	return {'orchestrateur': PANNEAU, 'agents': [agent(**kw)], 'usage': {PANNEAU: m} if usage else None, 'actifs': list(actifs)}


def ligne(ts, commande='/compact', classe='A', decision='envoyer', raison='ctx>=150000', avant=None, apres=None, verdict=None, panneau=PANNEAU):
	return {'ts': iso(ts), 'commande': commande, 'classe': classe, 'decision': decision, 'panneau': panneau,
	        'raison': raison, 'avant': avant if avant is not None else mesure(180000), 'apres': apres, 'verdict': verdict}


class Base(unittest.TestCase):
	def setUp(self):
		self.tmp = tempfile.mkdtemp(prefix='declencheurs-test-')
		self.addCleanup(shutil.rmtree, self.tmp, True)
		self.home = os.path.join(self.tmp, 'home')
		os.makedirs(self.home)
		self.base = os.path.join(self.tmp, 'projet')
		os.makedirs(self.base)
		env = unittest.mock.patch.dict(os.environ, {'HOME': self.home, 'AGENCE_ROOT': self.base})
		env.start()
		self.addCleanup(env.stop)
		self.assertTrue(os.path.expanduser('~').startswith(self.tmp))  # jamais le vrai ~/.cate ni ~/.claude
		self.table = agence.charger_table()
		self.t1 = next(t for t in self.table if t['id'] == 'T1')
		self.addCleanup(self.aucun_fichier_dans_home)

	def aucun_fichier_dans_home(self):
		self.assertEqual(os.listdir(self.home), [], 'un test a écrit dans HOME')

	def evaluer(self, snap, journal=(), maintenant=MIDI):
		return agence.evaluer(snap, self.table, list(journal), maintenant)

	def t1_decision(self, snap, journal=(), maintenant=MIDI):
		rendues = [d for d in self.evaluer(snap, journal, maintenant) if d['declencheur'] == 'T1']
		self.assertEqual(len(rendues), 1)
		return rendues[0]

	def fichiers(self):
		d = agence.journal_dir(self.base)
		return sorted(os.listdir(d)) if os.path.isdir(d) else []

	def lignes(self):
		return agence.journal_lire(self.base, 90, MIDI)[0]


# ---------- T020 : schéma de la table ----------

class TableTest(Base):
	def ecrire(self, rows):
		path = os.path.join(self.tmp, 'table.json')
		with open(path, 'w') as f:
			json.dump(rows, f)
		return path

	def ligne_t(self, **kw):
		return {**{k: v for k, v in self.t1.items()}, **kw}

	def test_la_table_livree_se_charge_avec_t1_a_t10(self):
		self.assertEqual([t['id'] for t in self.table], ['T%d' % i for i in range(1, 11)])
		self.assertEqual(self.t1['commande'], '/compact')
		self.assertEqual((self.t1['classe'], self.t1['agentId'], self.t1['seuil'], self.t1['repos'], self.t1['plafond']),
		                 ('A', 'claude-code', 150000, 600, 3))

	def test_chaque_ligne_porte_tous_les_champs(self):
		for t in self.table:
			for champ in CHAMPS_TABLE:
				self.assertIn(champ, t, f"{t['id']} sans {champ}")
			self.assertIsInstance(t['hypothese'], bool)
			self.assertIn(t['classe'], ('A', 'B'))

	def test_t4_a_t10_hors_de_tout_preset_et_marquees_hypothese(self):
		presets = pratiques.schema()['presets'].values()
		for t in self.table[3:]:
			self.assertFalse(any(t['id'] in p['declencheurs.actifs'] for p in presets), t['id'])
			self.assertIs(t['hypothese'], True, t['id'])
		self.assertTrue(all(t['hypothese'] for t in self.table))  # aucun seuil n'est une mesure

	def test_un_champ_manquant_est_refuse_au_chargement(self):
		for champ in CHAMPS_TABLE:
			row = self.ligne_t()
			del row[champ]
			with self.assertRaises(agence.Refus, msg=champ):
				agence.charger_table(self.ecrire([row]))

	def test_classe_inconnue_identifiant_double_et_json_invalide_refuses(self):
		for rows in ([self.ligne_t(classe='C')], [self.ligne_t(), self.ligne_t()], {'pas': 'une liste'}, [self.ligne_t(repos=-1)],
		             [self.ligne_t(plafond=0)], [self.ligne_t(hypothese='oui')]):
			with self.assertRaises(agence.Refus, msg=rows):
				agence.charger_table(self.ecrire(rows))
		with open(os.path.join(self.tmp, 'casse.json'), 'w') as f:
			f.write('[{')
		with self.assertRaises(agence.Refus):
			agence.charger_table(os.path.join(self.tmp, 'casse.json'))
		with self.assertRaises(agence.Refus):
			agence.charger_table(os.path.join(self.tmp, 'absente.json'))

	def test_une_commande_de_setup_en_classe_a_est_refusee(self):
		for commande in SETUP:
			with self.assertRaises(agence.Refus, msg=commande) as ctx:
				agence.charger_table(self.ecrire([self.ligne_t(commande=commande, classe='A')]))
			self.assertIn(commande, str(ctx.exception))
			agence.charger_table(self.ecrire([self.ligne_t(commande=commande, classe='B')]))  # en carte : permis

	def test_la_commande_de_setup_se_reconnait_sans_barre_ni_casse(self):
		for commande in ('learn', '/Learn', ' /audit-config '):
			with self.assertRaises(agence.Refus, msg=commande):
				agence.charger_table(self.ecrire([self.ligne_t(commande=commande, classe='A')]))


# ---------- T021 : T1 sur instantanés ----------

class EvaluerTest(Base):
	def test_seuil_149999_150000_150001(self):
		self.assertEqual(self.t1_decision(instantane(149999))['decision'], 'rien')
		self.assertEqual(self.t1_decision(instantane(150000))['decision'], 'rien')
		d = self.t1_decision(instantane(150001))
		self.assertEqual((d['decision'], d['commande'], d['classe'], d['panneau']), ('blanc', '/compact', 'A', PANNEAU))
		self.assertEqual(d['raison'], 'ctx>=150000')
		self.assertEqual(d['avant']['contextTokens'], 150001)

	def test_rien_ne_part_en_lot_2_meme_ouvert(self):
		for d in self.evaluer(instantane(900000)):
			self.assertNotIn(d['decision'], ('envoyer', 'carte'))

	def test_agent_occupe_attend_et_ne_met_rien_en_file(self):
		cas = {'en tour': {'state': 'running', 'peut': False},
		       'permission': {'state': 'waitingForInput', 'peut': False},
		       'prompt en file': {'state': 'waitingForInput', 'prompts': [{'id': 'p1', 'state': 'queued'}]},
		       'repos': {}}
		attendu = {'en tour': 'attendre', 'permission': 'attendre', 'prompt en file': 'attendre', 'repos': 'blanc'}
		for nom, kw in cas.items():
			d = self.t1_decision(instantane(180000, **kw))
			self.assertEqual(d['decision'], attendu[nom], nom)
			if nom != 'repos':
				self.assertEqual(d['raison'], 'occupe', nom)

	def test_sous_le_seuil_rien_meme_si_occupe(self):
		self.assertEqual(self.t1_decision(instantane(100000, state='running', peut=False))['decision'], 'rien')

	def test_un_autre_agent_que_claude_code_ne_declenche_pas(self):
		self.assertEqual([d for d in self.evaluer(instantane(900000, agent_id='codex')) if d['declencheur'] == 'T1'], [])

	def test_orchestrateur_absent_de_la_liste_ou_inconnu(self):
		snap = instantane(900000)
		snap['agents'] = [agent(panneau=AUTRE)]
		self.assertEqual(self.evaluer(snap), [])
		snap['orchestrateur'] = None
		self.assertEqual(self.evaluer(snap), [])

	def test_seule_t1_a_une_condition_en_lot_2(self):
		self.assertEqual([d['declencheur'] for d in self.evaluer(instantane(900000))], ['T1'])  # T2 et T3 : lot 4 ; T4 à T10 inactives

	def test_rafale_100_instantanes_identiques_une_decision(self):
		snap = instantane(180000)
		for i in range(100):
			agence.declencheurs_tour(self.base, snap, MIDI + i)
		lignes = self.lignes()
		self.assertEqual([l['decision'] for l in lignes if l['decision'] in ('blanc', 'envoyer')], ['blanc'])
		self.assertEqual([l['decision'] for l in lignes if l['decision'] == 'attendre'], ['attendre'])  # une fois, pas 99
		self.assertEqual({l['raison'] for l in lignes if l['decision'] == 'attendre'}, {'repos'})

	def test_repos_de_10_minutes(self):
		avant = ligne(MIDI, decision='blanc', verdict='blanc')
		d = self.t1_decision(instantane(180000), [avant], MIDI + 599)
		self.assertEqual((d['decision'], d['raison']), ('attendre', 'repos'))
		d = self.t1_decision(instantane(180000), [avant], MIDI + 540)  # 9 min
		self.assertEqual((d['decision'], d['raison']), ('attendre', 'repos'))
		self.assertEqual(self.t1_decision(instantane(180000), [avant], MIDI + 600)['decision'], 'blanc')

	def test_horloge_qui_recule_compte_comme_repos_non_ecoule(self):
		avant = ligne(MIDI, decision='blanc', verdict='blanc')
		d = self.t1_decision(instantane(180000), [avant], MIDI - 3600)
		self.assertEqual((d['decision'], d['raison']), ('attendre', 'repos'))

	def test_le_repos_est_par_panneau(self):
		avant = ligne(MIDI, decision='blanc', verdict='blanc', panneau=AUTRE)
		self.assertEqual(self.t1_decision(instantane(180000), [avant], MIDI + 1)['decision'], 'blanc')

	def test_plafond_de_3_par_panneau_et_par_jour(self):
		trois = [ligne(MIDI - 3 * 3600 + i * 3600, decision='blanc', verdict='blanc') for i in range(3)]  # 9 h, 10 h, 11 h
		d = self.t1_decision(instantane(180000), trois, MIDI + 3600)  # 13 h : le repos est écoulé
		self.assertEqual((d['decision'], d['raison']), ('attendre', 'plafond'))
		hier = [ligne(MIDI - 86400 + i, decision='blanc', verdict='blanc') for i in range(3)]
		self.assertEqual(self.t1_decision(instantane(180000), hier, MIDI)['decision'], 'blanc')

	def test_sans_mesure_une_fois_par_jour(self):
		for snap in (instantane(None), instantane(180000, usage=False)):
			d = self.t1_decision(snap)
			self.assertEqual((d['decision'], d['raison']), ('sans-mesure', 'ctx-absent'))
			deja = ligne(MIDI - 60, decision='sans-mesure', raison='ctx-absent', avant=mesure(None), verdict='sans-mesure')
			self.assertEqual(self.t1_decision(snap, [deja])['decision'], 'rien')
			hier = ligne(MIDI - 86400, decision='sans-mesure', raison='ctx-absent', avant=mesure(None), verdict='sans-mesure')
			self.assertEqual(self.t1_decision(snap, [hier])['decision'], 'sans-mesure')

	def test_evaluer_est_pure(self):
		snap, journal = instantane(180000), [ligne(MIDI - 5000, decision='blanc', verdict='blanc')]
		avant = (copy.deepcopy(snap), copy.deepcopy(journal), copy.deepcopy(self.table))
		self.evaluer(snap, journal)
		self.assertEqual((snap, journal, self.table), avant)
		self.assertEqual(self.fichiers(), [])

	def test_ligne_inactive_ignoree(self):
		seule_t4 = [t for t in self.table if t['id'] == 'T4']
		self.assertEqual(agence.evaluer(instantane(900000), seule_t4, [], MIDI), [])


# ---------- T022 : journal ----------

class JournalTest(Base):
	def ecrire(self, **kw):
		l = ligne(MIDI, decision='blanc', verdict='blanc', **kw)
		agence.journal_ecrire(self.base, l)
		return l

	def test_etat_neuf_aucun_fichier_ni_dossier(self):
		self.assertEqual(self.fichiers(), [])
		self.assertFalse(os.path.exists(os.path.join(self.base, '.cate')))
		self.assertEqual(agence.journal_lire(self.base, 90, MIDI), ([], 0))
		agence.declencheurs_tour(self.base, instantane(100000), MIDI)  # aucune décision : journal vide
		agence.declencheurs_tour(self.base, instantane(150000), MIDI)
		self.assertFalse(os.path.exists(os.path.join(self.base, '.cate')))

	def test_une_ligne_par_decision_dans_le_fichier_du_jour(self):
		l = self.ecrire()
		self.assertEqual(self.fichiers(), [jour(MIDI) + '.jsonl'])
		self.assertTrue(agence.journal_dir(self.base).endswith(os.path.join('.cate', 'tmp', 'agence', 'declencheurs')))
		with open(os.path.join(agence.journal_dir(self.base), self.fichiers()[0])) as f:
			brut = f.read().splitlines()
		self.assertEqual(len(brut), 1)
		self.assertEqual(set(json.loads(brut[0])), CLES_LIGNE)
		self.assertEqual(json.loads(brut[0]), l)

	def test_modes_0700_et_0600(self):
		self.ecrire()
		d = agence.journal_dir(self.base)
		self.assertEqual(stat.S_IMODE(os.stat(d).st_mode), 0o700)
		self.assertEqual(stat.S_IMODE(os.stat(os.path.join(d, self.fichiers()[0])).st_mode), 0o600)

	def test_modes_meme_avec_un_umask_ouvert(self):
		ancien = os.umask(0)
		self.addCleanup(os.umask, ancien)
		self.ecrire()
		d = agence.journal_dir(self.base)
		self.assertEqual(stat.S_IMODE(os.stat(d).st_mode), 0o700)
		self.assertEqual(stat.S_IMODE(os.stat(os.path.join(d, self.fichiers()[0])).st_mode), 0o600)

	def test_ajout_seul(self):
		premiere = self.ecrire()
		chemin = os.path.join(agence.journal_dir(self.base), self.fichiers()[0])
		with open(chemin) as f:
			debut = f.read()
		agence.journal_ecrire(self.base, ligne(MIDI + 60, decision='blanc', verdict='blanc'))
		with open(chemin) as f:
			fin = f.read()
		self.assertTrue(fin.startswith(debut))
		self.assertEqual(len(fin.splitlines()), 2)
		self.assertEqual(json.loads(fin.splitlines()[0]), premiere)

	def test_raison_hors_de_la_liste_fermee_rejetee(self):
		for bonne in ('ctx>=150000', 'merge:12', '7j', 'friction:2', 'repos', 'plafond', 'occupe', 'ctx-absent'):
			agence.journal_ecrire(self.base, ligne(MIDI, decision='blanc', verdict='blanc', raison=bonne))
		self.assertEqual(len(self.lignes()), 8)
		avant = self.fichiers()
		for mauvaise in ('ctx>=abc', 'ctx>=', 'resume la conversation', 'ctx>=150000 et plus', 'merge:x', '', None, 12, 'friction:2\n'):
			with self.assertRaises(agence.Refus, msg=repr(mauvaise)):
				agence.journal_ecrire(self.base, ligne(MIDI, decision='blanc', verdict='blanc', raison=mauvaise))
		self.assertEqual(len(self.lignes()), 8)
		self.assertEqual(self.fichiers(), avant)

	def test_texte_libre_rejete_dans_chaque_champ(self):
		base = ligne(MIDI, decision='blanc', verdict='blanc')
		mauvaises = [
			{'panneau': 'le texte du prompt'}, {'panneau': None}, {'commande': 'compacte la conversation'}, {'commande': '/compact\n/clear'},
			{'classe': 'A, très sûre'}, {'decision': 'je décide de compacter'}, {'verdict': 'ça a marché'},
			{'avant': {**mesure(1), 'note': 'texte'}}, {'avant': {'contextTokens': 'beaucoup', 'inputTokens': 1, 'outputTokens': 1, 'costUsd': 1}},
			{'avant': {'contextTokens': True, 'inputTokens': 1, 'outputTokens': 1, 'costUsd': 1}},
			{'avant': 'texte'}, {'apres': {'contextTokens': 1}}, {'ts': 'hier soir'}, {'ts': 12345},
		]
		for kw in mauvaises:
			with self.assertRaises(agence.Refus, msg=kw):
				agence.journal_ecrire(self.base, {**base, **kw})
		with self.assertRaises(agence.Refus):
			agence.journal_ecrire(self.base, {**base, 'note': 'texte libre'})
		manque = dict(base)
		del manque['raison']
		with self.assertRaises(agence.Refus):
			agence.journal_ecrire(self.base, manque)
		self.assertEqual(self.fichiers(), [])

	def test_champs_de_mesure_peuvent_etre_null(self):
		self.ecrire()
		agence.journal_ecrire(self.base, ligne(MIDI, decision='sans-mesure', raison='ctx-absent',
		                                       avant={'contextTokens': None, 'inputTokens': None, 'outputTokens': None, 'costUsd': None}, verdict='sans-mesure'))
		self.assertEqual(len(self.lignes()), 2)

	def test_ligne_illisible_ignoree_et_comptee(self):
		self.ecrire()
		chemin = os.path.join(agence.journal_dir(self.base), self.fichiers()[0])
		with open(chemin, 'a') as f:
			f.write('{pas du json\n')
			f.write(json.dumps({'ts': 'x', 'commande': 'y'}) + '\n')
			f.write('\n')
		lignes, illisibles = agence.journal_lire(self.base, 90, MIDI)
		self.assertEqual((len(lignes), illisibles), (1, 2))  # la ligne vide n'est pas une ligne
		self.assertEqual(agence.bilan(self.base, 30, MIDI)['illisibles'], 2)  # le bilan passe outre

	def test_declencheurs_tour_journalise_le_blanc_et_rend_la_decision(self):
		rendues = agence.declencheurs_tour(self.base, instantane(180000), MIDI)
		self.assertEqual([d['decision'] for d in rendues], ['blanc'])
		l = self.lignes()
		self.assertEqual(len(l), 1)
		self.assertEqual((l[0]['commande'], l[0]['decision'], l[0]['verdict'], l[0]['apres']), ('/compact', 'blanc', 'blanc', None))
		self.assertEqual(l[0]['avant']['contextTokens'], 180000)
		self.assertEqual(l[0]['panneau'], PANNEAU)

	def test_la_lecture_borne_les_jours(self):
		for n in (0, 3, 40):
			agence.journal_ecrire(self.base, ligne(MIDI - n * 86400, decision='blanc', verdict='blanc'))
		self.assertEqual(len(agence.journal_lire(self.base, 7, MIDI)[0]), 2)
		self.assertEqual(len(agence.journal_lire(self.base, 90, MIDI)[0]), 3)


# ---------- T023 : purge ----------

class PurgeTest(Base):
	def fichier(self, nom, age_mtime_jours=None):
		d = agence.journal_dir(self.base)
		os.makedirs(d, mode=0o700, exist_ok=True)
		chemin = os.path.join(d, nom)
		with open(chemin, 'w') as f:
			f.write('')
		if age_mtime_jours is not None:
			t = MIDI - age_mtime_jours * 86400
			os.utime(chemin, (t, t))
		return chemin

	def nom(self, age):
		return jour(MIDI - age * 86400) + '.jsonl'

	def test_j89_et_j90_restent_j91_part(self):
		for age in (0, 89, 90, 91, 200):
			self.fichier(self.nom(age))
		supprimes, invalides = agence.journal_purger(self.base, MIDI)
		self.assertEqual(sorted(supprimes), sorted([self.nom(91), self.nom(200)]))
		self.assertEqual(invalides, [])
		self.assertEqual(self.fichiers(), sorted([self.nom(0), self.nom(89), self.nom(90)]))

	def test_nom_invalide_ignore_signale_jamais_supprime(self):
		mauvais = ['notes.jsonl', '2026-13-45.jsonl', 'x.txt', '2026-11-20.jsonl.bak', '2020-01-01.json']
		for nom in mauvais:
			self.fichier(nom, age_mtime_jours=400)
		supprimes, invalides = agence.journal_purger(self.base, MIDI)
		self.assertEqual(supprimes, [])
		self.assertEqual(sorted(invalides), sorted(mauvais))
		self.assertEqual(self.fichiers(), sorted(mauvais))

	def test_la_purge_lit_le_nom_pas_le_mtime(self):
		self.fichier(self.nom(91), age_mtime_jours=0)  # récent pour le disque, vieux pour son nom
		self.fichier(self.nom(89), age_mtime_jours=300)  # l'inverse
		supprimes, _ = agence.journal_purger(self.base, MIDI)
		self.assertEqual(supprimes, [self.nom(91)])
		self.assertEqual(self.fichiers(), [self.nom(89)])

	def test_sans_dossier_rien_a_faire_et_rien_cree(self):
		self.assertEqual(agence.journal_purger(self.base, MIDI), ([], []))
		self.assertFalse(os.path.exists(os.path.join(self.base, '.cate')))

	def test_un_sous_dossier_n_est_ni_supprime_ni_traite_en_fichier(self):
		os.makedirs(os.path.join(agence.journal_dir(self.base), self.nom(200)))
		supprimes, _ = agence.journal_purger(self.base, MIDI)
		self.assertEqual(supprimes, [])
		self.assertEqual(self.fichiers(), [self.nom(200)])

	def test_la_purge_tourne_au_demarrage_puis_une_fois_par_jour(self):
		self.fichier(self.nom(120))
		agence.declencheurs_tour(self.base, instantane(100000), MIDI)
		self.assertEqual(self.fichiers(), [])  # purgée au premier tour
		self.fichier(self.nom(120))
		agence.declencheurs_tour(self.base, instantane(100000), MIDI + 3600)  # même jour : pas de purge
		self.assertEqual(self.fichiers(), [self.nom(120)])
		agence.declencheurs_tour(self.base, instantane(100000), MIDI + 86400)  # le lendemain
		self.assertEqual(self.fichiers(), [])


# ---------- T024 : verdicts et bilan ----------

class VerdictTest(Base):
	def test_verdict_de_compact(self):
		self.assertEqual(agence.verdict_pour(mesure(180000), mesure(80000)), 'reussi')
		self.assertEqual(agence.verdict_pour(mesure(180000), mesure(90000)), 'reussi')  # 50 % pile
		self.assertEqual(agence.verdict_pour(mesure(180000), mesure(160000)), 'echec')
		self.assertEqual(agence.verdict_pour(mesure(180000), mesure(144000)), 'echec')  # 80 % pile
		self.assertEqual(agence.verdict_pour(mesure(180000), mesure(120000)), 'partiel')

	def test_mesure_absente_sans_mesure(self):
		self.assertEqual(agence.verdict_pour(mesure(180000), None), 'sans-mesure')
		self.assertEqual(agence.verdict_pour(mesure(180000), mesure(None)), 'sans-mesure')
		self.assertEqual(agence.verdict_pour(mesure(None), mesure(80000)), 'sans-mesure')
		self.assertEqual(agence.verdict_pour(mesure(0), mesure(0)), 'sans-mesure')

	def test_deux_tours_plus_tard_la_ligne_recoit_apres_et_verdict(self):
		agence.journal_ecrire(self.base, ligne(MIDI - 120, decision='envoyer'))
		agence.journal_ecrire(self.base, ligne(MIDI - 10, decision='envoyer', panneau=AUTRE))  # trop récente
		agence.journal_ecrire(self.base, ligne(MIDI - 5000, decision='blanc', verdict='blanc'))  # à blanc : rien à mesurer
		snap = instantane(80000)
		snap['usage'][AUTRE] = mesure(70000)
		self.assertEqual(agence.resoudre_verdicts(self.base, snap, MIDI), 1)
		par_decision = {(l['decision'], l['panneau']): l for l in self.lignes()}
		fait = par_decision[('envoyer', PANNEAU)]
		self.assertEqual((fait['verdict'], fait['apres']['contextTokens']), ('reussi', 80000))
		self.assertEqual(set(fait), CLES_LIGNE)
		self.assertIsNone(par_decision[('envoyer', AUTRE)]['verdict'])
		self.assertEqual(par_decision[('blanc', PANNEAU)]['verdict'], 'blanc')
		self.assertEqual(agence.resoudre_verdicts(self.base, snap, MIDI), 0)  # déjà résolue

	def test_panneau_disparu_ou_contexte_illisible_sans_mesure(self):
		agence.journal_ecrire(self.base, ligne(MIDI - 120, decision='envoyer'))
		agence.journal_ecrire(self.base, ligne(MIDI - 130, decision='envoyer', panneau=AUTRE))
		snap = instantane(None)  # PANNEAU : contextTokens absent ; AUTRE : absent de l'usage
		agence.resoudre_verdicts(self.base, snap, MIDI)
		self.assertEqual({l['verdict'] for l in self.lignes()}, {'sans-mesure'})

	def test_mesure_absente_une_ligne_par_jour_avec_sa_raison(self):
		for i in range(50):
			agence.declencheurs_tour(self.base, instantane(None), MIDI + i * 30)
		l = self.lignes()
		self.assertEqual(len(l), 1)
		self.assertEqual((l[0]['decision'], l[0]['raison'], l[0]['verdict']), ('sans-mesure', 'ctx-absent', 'sans-mesure'))
		agence.declencheurs_tour(self.base, instantane(None), MIDI + 86400)
		self.assertEqual(len(self.lignes()), 2)


class BilanTest(Base):
	def remplir(self):
		"""30 jours : 5 /compact envoyés (4 réussis, 1 échec), 3 à blanc, 2 cartes /learn (ignorée, refusée)."""
		gains = [(100000, 'reussi'), (110000, 'reussi'), (120000, 'reussi'), (90000, 'reussi'), (20000, 'echec')]
		for i, (gain, verdict) in enumerate(gains):
			agence.journal_ecrire(self.base, ligne(MIDI - (28 - 5 * i) * 86400, avant=mesure(180000), apres=mesure(180000 - gain), verdict=verdict))
		for i, ctx in enumerate((160000, 170000, 180000)):
			agence.journal_ecrire(self.base, ligne(MIDI - (2 - i) * 86400, decision='blanc', avant=mesure(ctx), verdict='blanc'))
		agence.journal_ecrire(self.base, ligne(MIDI - 3 * 86400, commande='/learn', classe='B', decision='carte', raison='merge:12', verdict='ignoree'))
		agence.journal_ecrire(self.base, ligne(MIDI - 4 * 86400, commande='/learn', classe='B', decision='carte', raison='merge:13', verdict='refusee'))

	def par_commande(self, b):
		return {c['commande']: c for c in b['commandes']}

	def test_bilan_par_commande_sur_30_jours(self):
		self.remplir()
		b = agence.bilan(self.base, 30, MIDI)
		c = self.par_commande(b)['/compact']
		self.assertEqual((c['decisions'], c['blancs'], c['reussis'], c['echecs'], c['partiels']), (8, 3, 4, 1, 0))
		self.assertEqual(c['taux'], 0.8)
		self.assertEqual(c['gain_median'], 100000)
		self.assertEqual(c['contexte_median_blanc'], 170000)
		l = self.par_commande(b)['/learn']
		self.assertEqual((l['decisions'], l['ignorees'], l['refusees'], l['reussis']), (2, 1, 1, 0))
		self.assertIsNone(l['taux'])
		self.assertIsNone(l['gain_median'])

	def test_fenetre_en_jours(self):
		self.remplir()
		c = self.par_commande(agence.bilan(self.base, 7, MIDI))['/compact']
		self.assertEqual((c['decisions'], c['blancs'], c['reussis']), (3, 3, 0))  # les envois vont de J-28 à J-8
		self.assertEqual(c['taux'], None)

	def test_aucun_identifiant_de_panneau_ni_raison_ni_texte_libre(self):
		self.remplir()
		sortie = json.dumps(agence.bilan(self.base, 30, MIDI), ensure_ascii=False)
		self.assertNotIn(PANNEAU, sortie)
		self.assertNotIn('panneau', sortie.lower())
		self.assertNotIn('merge:12', sortie)
		self.assertNotIn('ctx>=', sortie)
		texte = agence.bilan_texte(agence.bilan(self.base, 30, MIDI))
		self.assertNotIn(PANNEAU, texte)
		self.assertIn('/compact', texte)

	def test_trois_echecs_sur_cinq_proposent_un_seuil_chiffre_sans_rien_ecrire(self):
		for i, verdict in enumerate(('reussi', 'echec', 'echec', 'reussi', 'echec')):
			apres = 160000 if verdict == 'echec' else 70000
			agence.journal_ecrire(self.base, ligne(MIDI - (9 - i) * 3600, avant=mesure(180000), apres=mesure(apres), verdict=verdict))
		table = os.path.join(os.path.dirname(os.path.abspath(agence.__file__)), 'declencheurs.json')
		with open(table, 'rb') as f:
			table_avant = f.read()
		avant = sorted(os.listdir(agence.journal_dir(self.base)))
		with open(os.path.join(agence.journal_dir(self.base), avant[0]), 'rb') as f:
			journal_avant = f.read()
		props = agence.bilan(self.base, 30, MIDI)['propositions']
		self.assertEqual(len(props), 1)
		for morceau in ('seuil de /compact', '150000', '190000', '3 échecs sur 5'):
			self.assertIn(morceau, props[0])
		with open(table, 'rb') as f:
			self.assertEqual(f.read(), table_avant)  # la table ne change que par un commit de Heifara
		self.assertEqual(sorted(os.listdir(agence.journal_dir(self.base))), avant)
		with open(os.path.join(agence.journal_dir(self.base), avant[0]), 'rb') as f:
			self.assertEqual(f.read(), journal_avant)

	def test_deux_echecs_sur_cinq_pas_de_proposition(self):
		for i, verdict in enumerate(('reussi', 'echec', 'reussi', 'reussi', 'echec')):
			agence.journal_ecrire(self.base, ligne(MIDI - (9 - i) * 3600, avant=mesure(180000), apres=mesure(160000 if verdict == 'echec' else 70000), verdict=verdict))
		self.assertEqual(agence.bilan(self.base, 30, MIDI)['propositions'], [])

	def test_seuls_les_cinq_derniers_comptent(self):
		verdicts = ['echec'] * 3 + ['reussi'] * 5  # trois vieux échecs, cinq réussites récentes
		for i, verdict in enumerate(verdicts):
			agence.journal_ecrire(self.base, ligne(MIDI - (20 - i) * 3600, avant=mesure(180000), apres=mesure(160000 if verdict == 'echec' else 70000), verdict=verdict))
		self.assertEqual(agence.bilan(self.base, 30, MIDI)['propositions'], [])

	def test_les_lignes_a_blanc_ne_comptent_pas_dans_la_revision(self):
		for i in range(5):
			agence.journal_ecrire(self.base, ligne(MIDI - (9 - i) * 3600, decision='blanc', verdict='blanc'))
		self.assertEqual(agence.bilan(self.base, 30, MIDI)['propositions'], [])

	def test_commande_cli_json_et_texte(self):
		self.remplir()
		sortie = io.StringIO()
		with contextlib.redirect_stdout(sortie):
			code = agence.main(['declencheurs', 'bilan', '--json'])
		self.assertEqual(code, 0)
		b = json.loads(sortie.getvalue())
		self.assertEqual({c['commande'] for c in b['commandes']}, {'/compact', '/learn'})
		self.assertNotIn(PANNEAU, sortie.getvalue())
		sortie = io.StringIO()
		with contextlib.redirect_stdout(sortie):
			agence.main(['declencheurs', 'bilan', '--jours', '7'])
		self.assertIn('/compact', sortie.getvalue())
		self.assertNotIn(PANNEAU, sortie.getvalue())

	def test_commande_cli_sans_journal_ne_cree_rien_et_ne_demande_pas_cate(self):
		os.environ.pop('CATE_SOCKET', None)
		sortie = io.StringIO()
		with contextlib.redirect_stdout(sortie):
			self.assertEqual(agence.main(['declencheurs', 'bilan']), 0)
		self.assertIn('aucun', sortie.getvalue().lower())
		self.assertFalse(os.path.exists(os.path.join(self.base, '.cate')))

	def test_jours_invalides_refuses(self):
		for v in ('0', '-1', '91', 'abc'):
			with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit, msg=v):
				agence.main(['declencheurs', 'bilan', '--jours', v])

	def test_l_aide_nomme_la_commande(self):
		for argv, attendu in ((['declencheurs', '--help'], 'bilan'), (['declencheurs', 'bilan', '--help'], '--jours')):
			sortie = io.StringIO()
			with contextlib.redirect_stdout(sortie), self.assertRaises(SystemExit):
				agence.main(argv)
			self.assertIn(attendu, sortie.getvalue())
		self.assertIn('declencheurs bilan', agence.__doc__)


# ---------- spec 005, lot 4, T061 : declencheurs.actifs ----------

class ActifsTest(Base):
	"""La table ne porte plus `actif` : la politique (`declencheurs.actifs`) dit quelles lignes l'évaluateur regarde."""

	def setUp(self):
		super().setUp()
		self.presets = pratiques.schema()['presets']

	def cond(self, t, inst, journal, maintenant):
		"""Condition toujours vraie : T2 et T3 n'ont pas encore la leur (spec 004, lot 4)."""
		return {'declencheur': t['id'], 'commande': t['commande'], 'classe': t['classe'], 'decision': 'carte',
		        'panneau': PANNEAU, 'raison': 'merge:1', 'avant': mesure(1)}

	def rendus(self, actifs):
		with unittest.mock.patch.dict(agence.CONDITIONS, {'besoin-clos-par-merge': self.cond, 'jours-sans-audit': self.cond}):
			return [d['declencheur'] for d in self.evaluer(instantane(900000, actifs=actifs))]

	def test_la_table_livree_ne_porte_plus_actif(self):
		self.assertEqual([t['id'] for t in self.table if 'actif' in t], [])

	def test_sous_neutre_t2_et_t3_vraies_ne_produisent_aucune_carte(self):
		self.assertEqual(self.rendus(self.presets['neutre']['declencheurs.actifs']), ['T1'])

	def test_sous_pr_tdd_t2_et_t3_produisent_leur_carte(self):
		self.assertEqual(self.rendus(self.presets['pr-tdd']['declencheurs.actifs']), ['T1', 'T2', 'T3'])

	def test_liste_vide_ou_absente_rien_n_est_evalue(self):
		self.assertEqual(self.rendus([]), [])
		snap = instantane(900000)
		del snap['actifs']
		self.assertEqual(self.evaluer(snap), [])

	def test_identifiant_inconnu_refuse_par_la_politique(self):
		with self.assertRaises(pratiques.Invalide) as ctx:
			pratiques.aplatir(pratiques.schema(), {'declencheurs': {'actifs': ['T1', 'T42']}}, 'projet')
		self.assertIn('declencheurs.actifs', str(ctx.exception))


# ---------- T025 : non-capture et « jamais » ----------

class JamaisTest(Base):
	FONCTIONS = ('charger_table', '_cond_contexte_repos', '_valider_ligne', 'evaluer', 'verdict_pour', 'resoudre_verdicts', 'journal_dir', 'journal_ecrire', 'journal_lire',
	             'journal_purger', 'bilan', 'bilan_texte', 'declencheurs_tour')
	INTERDIT = ('anthropic', 'openai', 'claude', 'measure.py', 'terminal', 'subprocess', 'RUN(', 'cate(', 'urllib', 'http.client', 'socket')

	def test_le_code_de_l_evaluateur_n_atteint_ni_modele_ni_claude_ni_measure_ni_terminal(self):
		for nom in self.FONCTIONS:
			source = inspect.getsource(getattr(agence, nom)).lower()
			for mot in self.INTERDIT:
				self.assertNotIn(mot.lower(), source, f'{nom} cite « {mot} »')

	def test_aucun_sdk_de_modele_charge(self):
		for module in sys.modules:
			self.assertNotIn(module.split('.')[0], ('anthropic', 'openai', 'cohere', 'google', 'mistralai'), module)

	def test_aucun_appel_a_cate_ni_au_systeme_pendant_un_cycle_complet(self):
		appels = []

		def espion(cmd, input=None, timeout=None):
			appels.append(cmd)
			return 1, '', 'interdit'
		with unittest.mock.patch.object(agence, 'RUN', espion):
			for ctx in (None, 100000, 180000):
				agence.declencheurs_tour(self.base, instantane(ctx), MIDI)
			agence.journal_ecrire(self.base, ligne(MIDI - 600, decision='envoyer'))
			agence.resoudre_verdicts(self.base, instantane(80000), MIDI)
			agence.bilan(self.base, 30, MIDI)
			agence.journal_purger(self.base, MIDI)
		self.assertEqual(appels, [])

	def test_une_raison_ne_porte_jamais_le_texte_d_un_prompt_ou_d_un_rapport(self):
		secret = 'RAPPORT SECRET : le mot de passe est hunter2 et le prompt dit ceci'
		snap = instantane(180000, prompts=[{'id': 'p1', 'state': 'sent', 'text': secret, 'message': secret}])
		snap['agents'][0]['title'] = secret
		snap['agents'][0]['report'] = secret
		snap['usage'][PANNEAU]['note'] = secret
		rendues = agence.declencheurs_tour(self.base, snap, MIDI)
		agence.declencheurs_tour(self.base, instantane(180000, state='running', peut=False), MIDI + 700)
		self.assertTrue(rendues)
		self.assertNotIn('hunter2', json.dumps(rendues))
		for nom in self.fichiers():
			with open(os.path.join(agence.journal_dir(self.base), nom)) as f:
				brut = f.read()
			self.assertNotIn('hunter2', brut)
			self.assertNotIn('RAPPORT', brut)
		for l in self.lignes():
			self.assertRegex(l['raison'], r'^(ctx>=\d+|merge:\d+|7j|friction:\d+|repos|plafond|occupe|ctx-absent)$')

	def test_registres_absents_le_declencheur_se_tait_sans_erreur(self):
		for registre in ('state/setup/ledger.jsonl', 'state/usage-ledger.jsonl'):
			self.assertFalse(os.path.exists(os.path.join(self.home, '.claude', registre)))
		self.assertEqual([d['decision'] for d in agence.declencheurs_tour(self.base, instantane(100000), MIDI)], ['rien'])
		agence.declencheurs_tour(self.base, instantane(180000), MIDI)
		self.assertFalse(os.path.exists(os.path.join(self.home, '.claude')))  # et rien n'est créé dans HOME

	def test_table_illisible_le_tour_ne_plante_pas_le_regisseur(self):
		with unittest.mock.patch.object(agence, 'charger_table', side_effect=agence.Refus('table illisible')):
			self.assertEqual(agence.declencheurs_tour(self.base, instantane(180000), MIDI), [])
		self.assertEqual(self.fichiers(), [])


# ---------- le tour du régisseur ----------

class UnTourTest(Base):
	"""un_tour lit contextTokens avec costUsd, passe l'instantané à l'évaluateur, journalise `blanc` et n'envoie rien."""

	def setUp(self):
		super().setUp()
		os.environ['CATE_SOCKET'] = os.path.join(self.tmp, 'x.sock')
		self.appels = []
		self.usage = [{'panelId': PANNEAU, 'model': 'm', 'inputTokens': 900000, 'outputTokens': 50, 'costUsd': 3.0, 'contextTokens': 180000}]
		self.agents = [agent()]
		ancien = agence.RUN
		agence.RUN = self.faux
		self.addCleanup(setattr, agence, 'RUN', ancien)
		with agence.tx() as st:
			st['panels']['orchestrator'] = PANNEAU

	def faux(self, cmd, input=None, timeout=None):
		self.appels.append(cmd)
		if cmd[:3] == ['cate', 'panel', 'list']:
			return 0, json.dumps([{'panelId': PANNEAU, 'title': 'Orch', 'type': 'terminal'}]), ''
		if cmd[:3] == ['cate', 'agent', 'list']:
			return 0, json.dumps(self.agents), ''
		if cmd[:3] == ['cate', 'agent', 'usage']:
			return 0, json.dumps(self.usage), ''
		if cmd[:2] == ['git', '-C']:
			return 1, '', ''
		return 0, '{}', ''

	def envois(self):
		return [c for c in self.appels if c[:3] in (['cate', 'agent', 'send'], ['cate', 'terminal', 'type'], ['cate', 'terminal', 'press'])]

	def test_le_tour_journalise_blanc_et_n_envoie_rien(self):
		agence.un_tour()
		l = self.lignes()
		self.assertEqual([(x['commande'], x['decision'], x['avant']['contextTokens']) for x in l], [('/compact', 'blanc', 180000)])
		self.assertEqual(self.envois(), [])

	def test_le_tour_sans_decision_laisse_le_journal_vide(self):
		self.usage[0]['contextTokens'] = 100000
		agence.un_tour()
		agence.un_tour()
		self.assertEqual(self.fichiers(), [])
		self.assertEqual(self.envois(), [])

	def test_le_cout_reste_lu_et_une_seule_lecture_d_usage_par_tour(self):
		agence.un_tour()
		self.assertEqual(len([c for c in self.appels if c[:3] == ['cate', 'agent', 'usage']]), 1)

	def test_contexttokens_absent_du_champ_se_lit_comme_null(self):
		del self.usage[0]['contextTokens']
		agence.un_tour()
		self.assertEqual([(x['decision'], x['raison']) for x in self.lignes()], [('sans-mesure', 'ctx-absent')])

	def test_usage_refuse_le_declencheur_se_tait_et_le_tour_continue(self):
		ancien = self.faux

		def refuse(cmd, input=None, timeout=None):
			if cmd[:3] == ['cate', 'agent', 'usage']:
				return 1, '', 'unknown command'
			return ancien(cmd, input, timeout)
		agence.RUN = refuse
		agence.un_tour()  # ne lève pas
		self.assertEqual([x['decision'] for x in self.lignes()], ['sans-mesure'])

	def test_le_tour_suit_declencheurs_actifs_de_la_politique(self):
		chemin = pratiques.fichier_projet(self.base)
		os.makedirs(os.path.dirname(chemin), exist_ok=True)
		with open(chemin, 'w') as f:
			json.dump({'declencheurs': {'actifs': []}}, f)
		agence.un_tour()
		self.assertEqual(self.fichiers(), [])  # T1 retiré par le projet : aucune décision, rien au journal
		self.assertEqual(self.envois(), [])

	def test_un_tour_qui_echoue_dans_le_journal_ne_tue_pas_le_regisseur(self):
		with unittest.mock.patch.object(agence, 'journal_ecrire', side_effect=OSError('disque plein')):
			agence.un_tour()  # le suivi des besoins reste prioritaire


if __name__ == '__main__':
	unittest.main()
