"""Détection automatique d'un besoin d'ajuster le setup (spec 015, FR-020, FR-022, FR-023).

Règle déterministe sur un texte : oui, ambigu ou non. Le régisseur (agence.py) en tire une carte « Ajuster le setup ? » ;
ce module ne pose aucune carte, n'écrit aucun fichier et n'appelle aucun modèle. Python 3.9, stdlib seule.
"""
import re
import unicodedata

MAX_PAR_HEURE = 3  # cartes par heure au plus (Q20)
FENETRE_EVENEMENT = 24 * 3600  # un événement compte à sa deuxième occurrence dans cette fenêtre
OCCURRENCES = 2

# Mots comparés sans accent ni casse, au début d'un mot (« relecteur » et « relecture » partagent « relec »).
CHANGEMENT = ('mets', 'mettre', 'passe', 'passer', 'change', 'changer', 'ajoute', 'ajouter', 'retire', 'retirer', 'baisse', 'baisser',
              'monte', 'monter', 'augmente', 'diminue', 'active', 'activer', 'desactive', 'desactiver', 'regle', 'regler', 'supprime',
              'sert aussi', 'servira aussi', 'passons', 'limite')
REGLAGE = ('plafond', 'agents en meme temps', 'relec', 'verification', 'orga', 'poste', 'livraison', 'merge', 'test', 'preuve',
           'metier', 'connecteur', 'preset', 'reglage', 'setup', 'seo', 'ce projet', 'modele', 'effort', 'worktree', 'declencheur',
           'notification', 'speckit', 'issue')
# Mot entier : « mets » ne doit pas lire « mets-moi un café » comme un ordre de réglage, ni « test » dans « contester ».
_MOT = r'(?<![a-z0-9]){}'


def normaliser(texte):
	"""Minuscules, sans accent, ponctuation et espaces compactés : la clé de comparaison de deux phrases."""
	bas = unicodedata.normalize('NFD', texte or '').casefold()
	sans = ''.join(c for c in bas if not unicodedata.combining(c))
	return ' '.join(re.sub(r"[^\w.]+", ' ', sans).split())


def _contient(norm, mots):
	return any(re.search(_MOT.format(re.escape(m)), norm) for m in mots)


def _cite_une_cle(norm, cles):
	"""Le texte nomme une clé du schéma (`agents.max`) ou son nom en mots simples (« Agents en même temps »)."""
	return any(re.search(_MOT.format(re.escape(normaliser(c))) + r'(?![a-z0-9])', norm) or
	           (nom and re.search(_MOT.format(re.escape(normaliser(nom))) + r'(?![a-z0-9])', norm)) for c, nom in cles.items())


def decider(texte, cles):
	"""'oui' : un mot de changement ET un mot de réglage, ou une clé citée ; 'ambigu' : un mot de réglage seul (Qwen départage) ;
	'non' : le reste. cles : {clé du schéma: nom en mots simples}.
	ponytail: listes de mots à la main, à resserrer sur le taux de cartes ignorées (spec 015, « Faux positifs »)."""
	norm = normaliser(texte)
	if not norm or len(norm) > 1000:
		return 'non'
	reglage = _contient(norm, REGLAGE) or _cite_une_cle(norm, cles)
	if reglage and (_contient(norm, CHANGEMENT) or _cite_une_cle(norm, cles)):
		return 'oui'
	return 'ambigu' if reglage else 'non'


def refus_anti_spam(questions, phrase, maintenant):
	"""Motif du refus d'une nouvelle carte (FR-023) ou None : une carte ouverte à la fois, jamais deux fois la même phrase,
	MAX_PAR_HEURE cartes par heure. questions : les cartes `setup == 'ajuster'` de l'état, avec `phrase` et `ts`."""
	norm = normaliser(phrase)
	if any(q['answer'] is None for q in questions):
		return 'une carte « Ajuster le setup ? » est déjà ouverte'
	if any(normaliser(q['phrase']) == norm for q in questions):
		return 'cette phrase a déjà eu sa carte'
	if sum(1 for q in questions if maintenant - q['ts'] < 3600) >= MAX_PAR_HEURE:
		return f'{MAX_PAR_HEURE} cartes déjà posées dans l\'heure'
	return None


def occurrence_suffisante(horodatages, maintenant):
	"""Vrai quand l'événement qui vient d'être compté est au moins la OCCURRENCES-ième dans la fenêtre. Rend aussi la liste purgée."""
	gardes = [t for t in horodatages if maintenant - t < FENETRE_EVENEMENT]
	return len(gardes) >= OCCURRENCES, gardes
