"""Spec 010, lot 3 : un seul interlocuteur par projet, qui écrit des fiches et ne lance rien (FR-001, FR-002).

`cate` est simulé (FakeRun) ; état en dossier temporaire et faux HOME (Base de test_agence)."""
import contextlib
import io
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agence  # noqa: E402
from test_agence import Base  # noqa: E402
from test_portable import ADRESSE_FORK, PERSONNEL, REPO  # noqa: E402

SKILL = os.path.join(REPO, 'skills', 'interlocuteur', 'SKILL.md')
MODELES = re.compile(r'\b(opus|sonnet|haiku|fable|claude-[\w.-]+|gpt[\w.-]*|gemini|o[134]-\w+)\b', re.I)


class Skill(unittest.TestCase):
	"""T040 : le skill donne les commandes de fiche et de registre, et aucune qui lance du travail."""

	def setUp(self):
		with open(SKILL, encoding='utf-8') as f:
			self.texte = f.read()

	def test_cite_les_commandes_de_l_interlocuteur(self):
		for cmd in ('agence fiche add', 'agence fiche list', 'agence decision list --active', 'agence decision add'):
			with self.subTest(cmd=cmd):
				self.assertIn(cmd, self.texte)

	def test_propose_une_lentille_a_la_demande_par_sa_carte(self):
		self.assertIn('agence lentille F<n> --carte', self.texte)

	def test_ne_cite_aucune_commande_qui_lance(self):
		for cmd in ('cate agent start', 'agence need add', 'agence ask', 'Hermes'):
			with self.subTest(cmd=cmd):
				self.assertNotIn(cmd.lower(), self.texte.lower())

	def test_aucun_nom_de_modele(self):
		self.assertIsNone(MODELES.search(self.texte), MODELES.search(self.texte))

	def test_dit_qu_il_ne_lance_rien(self):
		self.assertIn('ne lance rien', self.texte)

	def test_renvoie_aux_pratiques_pour_le_modele_par_role(self):
		self.assertIn('agence pratiques show', self.texte)

	def test_aucun_nom_ni_chemin_personnel(self):
		trouves = [l for l in self.texte.splitlines() if PERSONNEL.search(ADRESSE_FORK.sub('', l))]
		self.assertEqual(trouves, [])

	def test_frontmatter_du_skill(self):
		self.assertTrue(self.texte.startswith('---\nname: interlocuteur\ndescription: '), self.texte[:80])
		self.assertNotIn(chr(0x2014), self.texte)  # jamais de tiret long


class Demarrage(Base):
	"""T041 : agence start crée l'interlocuteur une fois, l'enregistre, le relie au panneau agence ; adopte le vivant."""

	def inter_starts(self):
		return [c for c in self.run.ran('cate', 'agent', 'start') if '/interlocuteur' in c]

	def test_start_cree_et_enregistre_l_interlocuteur(self):
		self.assertEqual(self.cli('start')[0], 0)
		st = self.state()
		self.assertEqual(st['panels'], {'orchestrator': 'p1', 'interlocuteur': 'p2'})
		start = self.inter_starts()
		self.assertEqual(len(start), 1)
		self.assertEqual(start[0][start[0].index('--title') + 1], 'Interlocuteur')
		self.assertEqual(start[0][start[0].index('--agent') + 1], 'claude-code')
		self.assertNotIn('--canvas', start[0])
		links = [c[3:7] for c in self.run.ran('cate', 'panel', 'link')]
		self.assertIn(['p2', 'p1', '--kind', 'context'], links)

	def test_boot_du_panneau_agence_cree_interlocuteur_et_boite_une_fois(self):
		# Clic droit > Start Agence : le panneau lance l'orchestrateur, dont « agence boot » complète l'équipe.
		with agence.tx() as st:
			st['panels'] = {'orchestrator': 'o1'}
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'type': 'agence'}])
		code, out = self.cli('boot')
		self.assertEqual(code, 0)
		self.assertIn('régisseur tenu par le panneau agence', out)
		self.assertEqual(len(self.inter_starts()), 1)
		self.assertEqual([c[3] for c in self.run.ran('cate', 'panel', 'create')], ['boite'])
		inter = self.state()['panels']['interlocuteur']
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'type': 'agence'}, {'panelId': 'b1', 'type': 'boite'},
		                                           {'panelId': inter, 'type': 'terminal', 'title': 'Interlocuteur'}])
		self.assertEqual(self.cli('boot')[0], 0)
		self.assertEqual(len(self.inter_starts()), 1)
		self.assertEqual(len(self.run.ran('cate', 'panel', 'create')), 1)

	def test_start_deux_fois_un_seul_interlocuteur(self):
		self.assertEqual(self.cli('start')[0], 0)
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'p1', 'type': 'agence'},
		                                           {'panelId': 'p2', 'type': 'terminal', 'title': 'Interlocuteur'}])
		self.assertEqual(self.cli('start')[0], 0)
		self.assertEqual(len(self.inter_starts()), 1)
		self.assertEqual(self.state()['panels']['interlocuteur'], 'p2')

	def test_interlocuteur_mort_recree(self):
		self.assertEqual(self.cli('start')[0], 0)
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'p1', 'type': 'agence'}])
		self.assertEqual(self.cli('start')[0], 0)
		self.assertEqual(len(self.inter_starts()), 2)
		self.assertEqual(self.state()['panels']['interlocuteur'], 'p3')

	def test_vivant_du_meme_titre_non_enregistre_adopte(self):
		with agence.tx() as st:
			st['panels'] = {'orchestrator': 'p1'}
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'p1', 'type': 'agence'},
		                                           {'panelId': 'i9', 'type': 'terminal', 'title': 'Interlocuteur'}])
		self.assertEqual(self.cli('start')[0], 0)
		self.assertEqual(self.state()['panels']['interlocuteur'], 'i9')
		self.assertEqual(self.inter_starts(), [])
		self.assertIn(['i9', 'p1', '--kind', 'context'], [c[3:7] for c in self.run.ran('cate', 'panel', 'link')])

	def test_chemin_canvas_interlocuteur_sur_le_canvas(self):
		self.run.reply(['cate', 'panel', 'create', 'agence'], '', code=1, err="cate: unknown panel type 'agence'")
		self.assertEqual(self.cli('start')[0], 0)
		st = self.state()
		self.assertEqual((st['panels']['canvas'], st['panels']['orchestrator'], st['panels']['interlocuteur']), ('p1', 'p2', 'p3'))
		start = self.inter_starts()
		self.assertEqual(len(start), 1)
		self.assertEqual(start[0][start[0].index('--canvas') + 1], 'p1')
		self.assertIn(['p3', 'p2', '--kind', 'context'], [c[3:7] for c in self.run.ran('cate', 'panel', 'link')])


class SecondeBarriere(Base):
	"""T043 : sans aucun hook, la CLI refuse à l'interlocuteur de créer un besoin, un brouillon ou une question --merge."""

	def setUp(self):
		super().setUp()
		with agence.tx() as st:
			st['port'] = 8765
			st['panels'] = {'orchestrator': 'o1', 'interlocuteur': 'i1'}
		self.run.reply(['cate', 'panel', 'list'], [{'panelId': 'o1', 'type': 'agence'}, {'panelId': 'i1', 'type': 'terminal'}])

	def appelant(self, pid):
		self.run.reply(['cate', 'panel', 'title'], {'panelId': pid})

	def refuse(self, *argv):
		err = io.StringIO()
		with contextlib.redirect_stderr(err):
			code, _ = self.cli(*argv)
		self.assertEqual(code, 1, err.getvalue())
		self.assertIn("l'interlocuteur ne lance rien", err.getvalue())

	def test_need_add_refuse_a_l_interlocuteur(self):
		self.appelant('i1')
		self.refuse('need', 'add', '--kind', 'cmd', 'Lancer un implémenteur')
		self.assertEqual(self.state()['needs'], [])

	def test_draft_new_refuse_a_l_interlocuteur(self):
		self.appelant('i1')
		self.refuse('draft', 'new', '--cible', 'mail:dg@exemple.fr', 'Bonjour')
		self.assertEqual(self.state()['drafts'], [])

	def test_ask_merge_refuse_a_l_interlocuteur(self):
		self.appelant('i1')
		self.refuse('ask', 'Merger ?', '--merge', 'o/r#1')
		self.assertEqual(self.state()['questions'], [])

	def test_orchestrateur_permis(self):
		self.appelant('o1')
		self.assertEqual(self.cli('need', 'add', '--kind', 'cmd', 'Lancer un implémenteur')[0], 0)
		with contextlib.redirect_stderr(io.StringIO()):
			self.assertEqual(self.cli('draft', 'new', '--cible', 'mail:dg@exemple.fr', 'Bonjour')[0], 0)
		self.assertEqual(len(self.state()['needs']), 2)

	def test_sonde_en_echec_laisse_passer(self):
		self.run.reply(['cate', 'panel', 'title'], '', code=1, err='cate: no panel')
		self.assertEqual(self.cli('need', 'add', '--kind', 'cmd', 'x')[0], 0)

	def test_sans_interlocuteur_aucune_sonde(self):
		with agence.tx() as st:
			st['panels'] = {'orchestrator': 'o1'}
		self.assertEqual(self.cli('need', 'add', '--kind', 'cmd', 'x')[0], 0)
		self.assertEqual(self.run.ran('cate', 'panel', 'title'), [])


if __name__ == '__main__':
	unittest.main()
