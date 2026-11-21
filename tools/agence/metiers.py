"""Métiers et connecteurs (spec 012) : deux catalogues JSON livrés à côté, déclarés une fois, lus par la politique,
la garde et `agence connecteur check`.

Un connecteur : {id, nom, explique, acces (mcp|api|navigateur), serveur (mcp), lecture, ecriture (noms d'outils sans
le préfixe mcp__<serveur>__), secret {variable, fichier?} (api), panneau?}. Seul un connecteur mcp écrit, et toujours
par une carte (la garde ne voit que les appels d'outils MCP). Un métier : {id, nom, explique, connecteurs, panneaux,
validateur (preuves nommées ; aucune pour dev, qui garde la preuve de 005), recettes}.
Aucun secret dans un catalogue : un connecteur nomme une variable, jamais sa valeur.
AGENCE_CATALOGUES : dossier des deux catalogues (fixtures des tests) ; défaut, celui de ce fichier.
Python 3.9, stdlib seule ; aucune fonction n'importe agence.py.
"""
import hashlib
import json
import os
import re

ICI = os.path.dirname(os.path.abspath(__file__))
CATALOGUES = ('connecteurs.json', 'metiers.json')
ACCES = ('mcp', 'api', 'navigateur')
TYPES_PREUVE = ('fichier', 'lien', 'clic')
TYPES_PANNEAU = ('navigateur', 'perso')
DEV = 'dev'
# Motifs de secret (007 FR-012) : jetons GitHub, OpenAI ou Anthropic, Slack, AWS, clé privée.
SECRET_RE = re.compile(r'gh[pousr]_|github_pat_|sk-|xox[abpres]-|AKIA|-----BEGIN')
VARIABLE_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*\Z')
SERVEUR_RE = re.compile(r'^[A-Za-z0-9_-]+\Z')  # nom tel que Claude Code l'écrit dans mcp__<serveur>__<outil>


class Invalide(Exception):
	"""Catalogue refusé : le message nomme le fichier, l'id et le champ, jamais la valeur fautive."""


def dossier():
	return os.environ.get('AGENCE_CATALOGUES') or ICI


def _refus(fichier, ident, champ, raison):
	raise Invalide(f'{fichier} : {ident or "?"} : champ « {champ} » : {raison}')


def _secrets(fichier, ident, valeur, champ=''):
	"""Toute chaîne, à toute profondeur : un motif de secret refuse le catalogue (le champ est nommé, pas la valeur)."""
	if isinstance(valeur, dict):
		for k, v in valeur.items():
			_secrets(fichier, ident, v, f'{champ}.{k}' if champ else k)
	elif isinstance(valeur, list):
		for v in valeur:
			_secrets(fichier, ident, v, champ)
	elif isinstance(valeur, str) and SECRET_RE.search(valeur):
		_refus(fichier, ident, champ, 'valeur qui ressemble à un secret ; un catalogue nomme une variable, jamais sa valeur')


def _objets(fichier, lignes, exiges):
	"""Liste d'objets à id unique, champs exigés présents, aucun secret."""
	if not isinstance(lignes, list):
		_refus(fichier, None, 'racine', 'une liste d’objets est attendue')
	vus = set()
	for x in lignes:
		ident = x.get('id') if isinstance(x, dict) else None
		if not isinstance(ident, str) or not ident:
			_refus(fichier, None, 'id', 'texte non vide attendu')
		if ident in vus:
			_refus(fichier, ident, 'id', 'en double')
		vus.add(ident)
		for champ in exiges:
			if champ not in x:
				_refus(fichier, ident, champ, 'manquant')
		_secrets(fichier, ident, x)
	return vus


def _textes(fichier, ident, champ, v):
	if not isinstance(v, list) or not all(isinstance(t, str) and t for t in v):
		_refus(fichier, ident, champ, 'liste de textes attendue')


def valider(connecteurs, metiers):
	"""Invalide au premier défaut : schéma (FR-001), aucun secret (FR-006)."""
	f = 'connecteurs.json'
	ids = _objets(f, connecteurs, ('nom', 'explique', 'acces', 'lecture', 'ecriture'))
	for c in connecteurs:
		i = c['id']
		if c['acces'] not in ACCES:
			_refus(f, i, 'acces', 'une de : ' + ', '.join(ACCES))
		for champ in ('lecture', 'ecriture'):
			_textes(f, i, champ, c[champ])
		if c['acces'] == 'mcp' and not (isinstance(c.get('serveur'), str) and SERVEUR_RE.match(c['serveur'])):
			_refus(f, i, 'serveur', 'nom du serveur MCP exigé pour un accès mcp (lettres, chiffres, _ et -)')
		if c['acces'] != 'mcp' and c['ecriture']:
			_refus(f, i, 'ecriture', 'seul un connecteur mcp écrit, par une carte (api et navigateur : lecture seule en v1)')
		if c['acces'] == 'api':
			s = c.get('secret')
			if not isinstance(s, dict):
				_refus(f, i, 'secret', '{variable, fichier?} exigé pour un accès api')
			if not isinstance(s.get('variable'), str) or not VARIABLE_RE.match(s['variable']):
				_refus(f, i, 'secret.variable', 'nom de variable d’environnement attendu')
	f = 'metiers.json'
	_objets(f, metiers, ('nom', 'explique', 'connecteurs', 'panneaux', 'validateur', 'recettes'))
	for m in metiers:
		i = m['id']
		_textes(f, i, 'connecteurs', m['connecteurs'])
		inconnus = [c for c in m['connecteurs'] if c not in ids]
		if inconnus:
			_refus(f, i, 'connecteurs', 'connecteur inconnu : ' + ', '.join(inconnus))
		for p in m['panneaux'] if isinstance(m['panneaux'], list) else [None]:
			if not isinstance(p, dict) or p.get('type') not in TYPES_PANNEAU or not p.get('cible'):
				_refus(f, i, 'panneaux.type', '{type: navigateur|perso, cible} attendu')
		v = m['validateur']
		if not isinstance(v, list) or bool(v) == (i == DEV):
			_refus(f, i, 'validateur', 'au moins une preuve nommée (aucune pour dev, qui garde la preuve de « Quand une tâche est finie »)')
		noms = set()
		for p in v:
			if not isinstance(p, dict) or not all(isinstance(p.get(k), str) and p[k] for k in ('nom', 'type', 'explique')):
				_refus(f, i, 'validateur', '{nom, type, explique} attendu')
			if p['type'] not in TYPES_PREUVE:
				_refus(f, i, 'validateur.type', 'une de : ' + ', '.join(TYPES_PREUVE))
			if not re.match(r'^[\w.-]+\Z', p['nom']) or p['nom'] in noms:
				_refus(f, i, 'validateur.nom', 'nom unique, lettres, chiffres, point, tiret')
			noms.add(p['nom'])
		for r in m['recettes'] if isinstance(m['recettes'], list) else [None]:
			for k in ('nom', 'declencheur', 'action', 'preuve'):
				if not isinstance(r, dict) or not isinstance(r.get(k), str) or not r[k]:
					_refus(f, i, f'recettes.{k}', 'texte non vide attendu')
	if DEV not in {m['id'] for m in metiers}:
		_refus(f, DEV, 'id', 'le métier dev est exigé (défaut de la politique)')


def charger(chemin=None):
	"""{'connecteurs': [...], 'metiers': [...]} validés ; Invalide sinon."""
	chemin = chemin or dossier()
	out = {}
	for nom in CATALOGUES:
		try:
			with open(os.path.join(chemin, nom)) as f:
				out[nom.split('.')[0]] = json.load(f)
		except (OSError, ValueError) as err:
			raise Invalide(f'{nom} : illisible ({type(err).__name__})')
	valider(out['connecteurs'], out['metiers'])
	return out


def metier(cat, ident):
	return next((m for m in cat['metiers'] if m['id'] == ident), None)


def connecteur(cat, ident):
	return next((c for c in cat['connecteurs'] if c['id'] == ident), None)


def classer(outil, cat):
	"""(connecteur, nom de l'outil, 'lecture' | 'ecriture') d'un outil mcp__<serveur>__<outil> d'un serveur déclaré ;
	None hors périmètre. Un outil de ce serveur absent de `lecture` est une écriture (échec fermé, FR-003)."""
	for c in sorted(cat['connecteurs'], key=lambda c: -len(c.get('serveur') or '')):  # le préfixe le plus long gagne
		prefixe = f"mcp__{c.get('serveur')}__"
		if c['acces'] == 'mcp' and outil.startswith(prefixe) and len(outil) > len(prefixe):
			nom = outil[len(prefixe):]
			return c, nom, 'lecture' if nom in c['lecture'] else 'ecriture'
	return None


def serveurs(cat):
	"""Serveurs MCP déclarés, triés, sans doublon : le matcher des hooks (FR-005)."""
	return sorted({c['serveur'] for c in cat['connecteurs'] if c['acces'] == 'mcp'})


def canonique(args):
	"""Arguments d'un appel, sérialisés une seule façon (clés triées) : la carte et l'appel se comparent ainsi."""
	return json.dumps(args, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def verifier_preuve(genre, valeur, racine):
	"""Texte noté au journal d'une preuve `fichier` (chemin relatif et SHA-256 d'un fichier régulier non vide sous la
	racine, ni lien symbolique ni ..) ou `lien` (https://) ; Invalide sinon. Une preuve `clic` ne se saisit pas."""
	if genre == 'lien':
		if not re.match(r'^https://\S+\Z', valeur):
			raise Invalide('une adresse https:// est attendue')
		return valeur
	if genre != 'fichier':
		raise Invalide('seul le clic de la carte de preuve la ferme')
	if '..' in valeur.replace('\\', '/').split('/'):
		raise Invalide('chemin avec .. refusé')
	chemin = valeur if os.path.isabs(valeur) else os.path.join(racine, valeur)
	if os.path.islink(chemin):
		raise Invalide('lien symbolique refusé')
	if not os.path.realpath(chemin).startswith(os.path.realpath(racine) + os.sep):
		raise Invalide('fichier hors du workspace')
	if not os.path.isfile(chemin):
		raise Invalide('fichier absent ou pas un fichier régulier')
	if os.path.getsize(chemin) == 0:
		raise Invalide('fichier vide')
	with open(chemin, 'rb') as f:
		empreinte = hashlib.sha256(f.read()).hexdigest()
	return f'{os.path.relpath(chemin, racine)} sha256 {empreinte}'


def lire_secret(variable, fichier):
	"""Valeur d'un secret nommé : la variable d'environnement, sinon la ligne VARIABLE= du fichier .env nommé ; None
	sinon. Seul un script d'accès s'en sert : jamais affichée, copiée, publiée ni écrite (FR-006)."""
	if os.environ.get(variable):
		return os.environ[variable]
	if fichier:
		try:
			with open(os.path.expanduser(fichier)) as f:
				for ligne in f:
					if ligne.startswith(variable + '='):
						return ligne.split('=', 1)[1].strip().strip('"\'')
		except OSError:
			pass
	return None


def etats_mcp(sortie):
	"""{serveur normalisé: état} lu dans la sortie de `claude mcp list` (« <nom>: <commande> - ✔ Connected ») ; le nom
	normalisé est celui des outils (« claude.ai Gmail » -> claude_ai_Gmail)."""
	out = {}
	for ligne in sortie.splitlines():
		m = re.match(r'^(.+?): .* - (.+)$', ligne.strip())
		if m:
			out[re.sub(r'[^A-Za-z0-9_-]', '_', m.group(1))] = m.group(2).strip()
	return out


def acces(c, etats):
	"""Accès d'un connecteur, en mots : mcp branché, mcp non connecté (<état>), mcp absent, api, navigateur."""
	if c['acces'] == 'navigateur':
		return 'navigateur, dernier recours, lecture seule'
	if c['acces'] == 'api':
		return 'api, lecture seule'
	etat = etats.get(c['serveur'])
	if etat is None:
		return 'mcp absent'
	return 'mcp branché' if 'Connected' in etat and not etat.startswith('!') else f'mcp non connecté ({etat})'
