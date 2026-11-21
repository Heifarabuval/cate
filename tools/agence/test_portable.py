#!/usr/bin/env python3
"""Pureté du code livré (SC-002, FR-005, FR-012) : aucun nom ni chemin personnel dans ce que le fork livre.
Lecture seule du dépôt, aucun HOME touché."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
# hermes couvre .hermes (spec 005, lot 2) ; .claude/state : dossier du setup d'un dev, pas de Claude Code (005, lot 4)
PERSONNEL = re.compile(r'heifara|U02FQHK9FPD|/Users/|hermes|\.claude/state', re.I)
# URL du fork : l'adresse du dépôt, pas un nom de personne.
ADRESSE_FORK = re.compile(r'Heifarabuval/cate', re.I)
# Seules lignes autorisées : la clé opaque de la valeur stockée (q303), une fois côté CLI, une fois côté panneau.
CLE_OPAQUE = re.compile(r'^\s*(export\s+)?(const\s+)?OWNER_HUMAIN\s*[=:]')
EXTENSIONS = ('.py', '.ts', '.tsx', '.md', '.json', '.sh')


def fichiers_livres():
	"""Chemins relatifs des fichiers que le fork livre dans le tarball ou dans l'app."""
	out = []
	for base, filtre in (
		('tools/agence', lambda f: (f == 'agence' or f == 'agence-hook' or f.endswith('.py')) and not f.startswith('test_')),
		('skills/orchestrateur', lambda f: True),
		('src/panels/agence', lambda f: f.endswith(('.ts', '.tsx', '.json')) and '.test.' not in f),
		('src/shells/desktop/ui/panels/agence', lambda f: f.endswith(('.ts', '.tsx')) and '.test.' not in f),
	):
		for racine, dossiers, noms in os.walk(os.path.join(REPO, base)):
			dossiers[:] = [d for d in dossiers if d not in ('fixtures', '__pycache__', 'node_modules')]
			out += [os.path.relpath(os.path.join(racine, n), REPO) for n in noms if filtre(n)]
	return sorted(out)


class Purete(unittest.TestCase):
	def test_skill_livre_existe(self):
		self.assertTrue(os.path.isfile(os.path.join(REPO, 'skills', 'orchestrateur', 'SKILL.md')))

	def test_fichiers_livres_trouves(self):
		self.assertGreater(len(fichiers_livres()), 5)

	def test_aucun_nom_ni_chemin_personnel(self):
		trouves = []
		for rel in fichiers_livres():
			with open(os.path.join(REPO, rel), encoding='utf-8') as f:
				for i, ligne in enumerate(f, 1):
					texte = ADRESSE_FORK.sub('', ligne)
					if PERSONNEL.search(texte) and not CLE_OPAQUE.match(ligne):
						trouves.append(f'{rel}:{i}: {ligne.strip()}')
		self.assertEqual(trouves, [])

	def test_cle_opaque_une_fois_par_cote(self):
		for rel in ('tools/agence/agence.py', 'src/panels/agence/contract/suivi.ts'):
			with open(os.path.join(REPO, rel), encoding='utf-8') as f:
				lignes = [l for l in f if re.search('heifara', l, re.I)]
			self.assertEqual(len(lignes), 1, (rel, lignes))
			self.assertRegex(lignes[0], CLE_OPAQUE)


if __name__ == '__main__':
	unittest.main()
