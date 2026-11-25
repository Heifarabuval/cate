"""Setup conversationnel (spec 015) : la proposition qu'un agent de setup écrit, validée avant de poser une carte.

L'agent propose, l'humain clique, le régisseur écrit (agence.py). Ce module ne touche aucun fichier de politique :
il lit et valide une proposition, rien d'autre. Python 3.9, stdlib seule ; aucune fonction n'importe agence.py.
"""
import json
import re

HAUT = ('preset', 'valeurs', 'sources', 'notes')  # clés permises de la proposition de pratiques (Key Entities de la spec)

# Ce qui ressemble à un secret : jetons connus, clé privée, identifiants dans une adresse (FR-005, FR-017)
SECRET_RE = re.compile(r'(xox[abprs]-[\w-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}'
                       r'|-----BEGIN [A-Z ]*PRIVATE KEY-----|://[^/\s:@]+:[^/\s@]+@|\bBearer\s+[\w.-]{16,})')


class Invalide(Exception):
	"""Proposition refusée : le message dit quoi corriger, en une ligne."""


def secret_apparent(texte):
	return isinstance(texte, str) and SECRET_RE.search(texte) is not None


def lire_proposition(texte):
	"""JSON de la proposition -> {'preset': str|None, 'valeurs': {cle: valeur}, 'sources': {cle: texte}}.
	Chaque valeur proposée porte sa source (SC-002) ; aucune valeur ne ressemble à un secret."""
	try:
		brut = json.loads(texte)
	except ValueError as err:
		raise Invalide(f'proposition illisible : JSON invalide ({err})')
	if not isinstance(brut, dict):
		raise Invalide('proposition illisible : un objet JSON est attendu')
	inconnues = [k for k in brut if k not in HAUT]
	if inconnues:
		raise Invalide(f"clé inconnue de la proposition : {', '.join(inconnues)} ; permises : {', '.join(HAUT)}")
	preset, valeurs, sources, notes = brut.get('preset'), brut.get('valeurs', {}), brut.get('sources', {}), brut.get('notes', [])
	if preset is not None and not isinstance(preset, str):
		raise Invalide('preset : un nom de modèle de réglages est attendu')
	if not isinstance(valeurs, dict):
		raise Invalide('valeurs : un objet {clé: valeur} est attendu')
	if not isinstance(sources, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in sources.items()):
		raise Invalide('sources : un objet {clé: texte} est attendu')
	if not isinstance(notes, list) or not all(isinstance(n, str) and n.strip() for n in notes):
		raise Invalide('notes : une liste de phrases est attendue (ce que le catalogue ne couvre pas, sans écriture)')
	proposees = list(valeurs) + (['preset'] if preset is not None else [])
	for cle in proposees:
		if not sources.get(cle, '').strip():
			raise Invalide(f'source manquante pour « {cle} » : chemin:ligne du dépôt, ou « réponse de la personne »')
	autres = [k for k in sources if k not in proposees]
	if autres:
		raise Invalide(f"source sans valeur proposée : {', '.join(autres)}")
	for cle, v in list(valeurs.items()) + list(sources.items()) + [('notes', n) for n in notes]:
		for texte in (v if isinstance(v, list) else [v]):
			if secret_apparent(texte):
				raise Invalide(f'« {cle} » ressemble à un secret : seuls des noms de variables sont admis')
	return {'preset': preset, 'valeurs': valeurs, 'sources': sources, 'notes': notes}
