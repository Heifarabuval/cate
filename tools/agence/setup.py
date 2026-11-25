"""Setup conversationnel (spec 015) : la proposition qu'un agent de setup écrit, validée avant de poser une carte.

L'agent propose, l'humain clique, le régisseur écrit (agence.py). Ce module ne touche aucun fichier de politique :
il lit et valide une proposition, rien d'autre. Python 3.9, stdlib seule ; aucune fonction n'importe agence.py.
"""
import copy
import fcntl
import json
import os
import re
import tempfile

HAUT = ('preset', 'valeurs', 'sources', 'notes', 'memoire')
MEMOIRE_PROP = ('objet', 'contexte', 'resume', 'raisons')  # ce que la proposition peut dire de la mémoire
MEMOIRE_CLES = ('version', 'objet', 'contexte', 'decisions', 'dernierSetup')
MAX_CONTEXTE = 200  # lignes de contexte au plus (Q16) ; au-delà, un résumé  # clés permises de la proposition de pratiques (Key Entities de la spec)

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
	memoire = _memoire_proposee(brut.get('memoire', {}), valeurs, preset)
	return {'preset': preset, 'valeurs': valeurs, 'sources': sources, 'notes': notes, 'memoire': memoire}


def _memoire_proposee(brut, valeurs, preset):
	"""Ce que la proposition dit de la mémoire : objet, lignes de contexte à ajouter, résumé qui remplace le contexte, raison de
	chaque réglage proposé. Aucun secret (FR-021)."""
	if not isinstance(brut, dict) or [k for k in brut if k not in MEMOIRE_PROP]:
		raise Invalide(f"memoire : un objet avec {', '.join(MEMOIRE_PROP)} au plus est attendu")
	if 'objet' in brut and not (isinstance(brut['objet'], str) and brut['objet'].strip()):
		raise Invalide("memoire.objet : une phrase est attendue (à quoi sert l'espace)")
	for cle in ('contexte', 'resume'):
		if cle in brut and not (isinstance(brut[cle], list) and all(isinstance(t, str) and t.strip() for t in brut[cle])):
			raise Invalide(f'memoire.{cle} : une liste de phrases est attendue')
	raisons = brut.get('raisons', {})
	if not (isinstance(raisons, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in raisons.items())):
		raise Invalide('memoire.raisons : un objet {clé: raison} est attendu')
	hors = [k for k in raisons if k not in valeurs and not (k == 'preset' and preset)]
	if hors:
		raise Invalide(f"memoire.raisons : raison d'un réglage non proposé : {', '.join(hors)}")
	for texte in [brut.get('objet')] + brut.get('contexte', []) + brut.get('resume', []) + list(raisons.values()):
		if secret_apparent(texte):
			raise Invalide('la mémoire ne reçoit aucun secret : une valeur y ressemble à un jeton ou à un mot de passe')
	return brut


# ---------- la mémoire du setup : <racine>/.cate/tmp/agence/setup.json (FR-017) ----------

def fichier(racine):
	return os.path.join(racine, '.cate', 'tmp', 'agence', 'setup.json')


def _valide(m):
	"""Forme du fichier, lu à la main aussi : Invalide avec la raison, jamais un correctif silencieux."""
	if not isinstance(m, dict):
		raise Invalide('un objet JSON est attendu')
	inconnues = [k for k in m if k not in MEMOIRE_CLES]
	if inconnues:
		raise Invalide(f"clé inconnue : {', '.join(inconnues)}")
	if m.get('version') != 1:
		raise Invalide('version 1 attendue')
	if 'objet' in m and not isinstance(m['objet'], str):
		raise Invalide('objet : un texte est attendu')
	contexte = m.get('contexte', [])
	if not (isinstance(contexte, list) and all(isinstance(c, dict) and isinstance(c.get('date'), str) and isinstance(c.get('texte'), str) for c in contexte)):
		raise Invalide('contexte : une liste de {date, texte} est attendue')
	decisions = m.get('decisions', {})
	if not (isinstance(decisions, dict) and all(isinstance(d, dict) and 'valeur' in d and all(isinstance(d.get(k), str) for k in ('raison', 'source', 'date'))
	                                           for d in decisions.values())):
		raise Invalide('decisions : une décision porte valeur, raison, source et date')
	if 'dernierSetup' in m and not isinstance(m['dernierSetup'], str):
		raise Invalide('dernierSetup : une date est attendue')
	if any(secret_apparent(t) for t in re.findall(r'"((?:[^"\\]|\\.)*)"', json.dumps(m, ensure_ascii=False))):
		raise Invalide('une valeur ressemble à un secret')


def lire(racine):
	"""(mémoire, None) ; (None, None) sans fichier ; (None, raison) si illisible ou mal formée : le setup travaille sans elle."""
	try:
		with open(fichier(racine)) as f:
			m = json.load(f)
	except FileNotFoundError:
		return None, None
	except (OSError, ValueError) as err:
		return None, f'JSON illisible ({err})'
	try:
		_valide(m)
	except Invalide as err:
		return None, str(err)
	return m, None


def fusionner(memoire, prop, jour):
	"""La mémoire après la proposition (pure) : l'objet remplacé, les lignes de contexte datées, la décision de chaque réglage proposé
	avec sa valeur, sa raison, sa source et sa date. Plus de 200 lignes : Invalide, il faut un résumé."""
	m = copy.deepcopy(memoire) if memoire else {'version': 1}
	dit = prop['memoire']
	m.setdefault('contexte', [])
	m.setdefault('decisions', {})
	if dit.get('objet'):
		m['objet'] = dit['objet'].strip()
	if 'resume' in dit:
		m['contexte'] = [{'date': jour, 'texte': t} for t in dit['resume']]
	m['contexte'] += [{'date': jour, 'texte': t} for t in dit.get('contexte', [])]
	if len(m['contexte']) > MAX_CONTEXTE:
		raise Invalide(f"{len(m['contexte'])} lignes de contexte, {MAX_CONTEXTE} au plus : propose un résumé (« resume »)")
	posees = dict(prop['valeurs'])
	if prop['preset']:
		posees['preset'] = prop['preset']
	for cle, valeur in posees.items():
		m['decisions'][cle] = {'valeur': valeur, 'raison': dit.get('raisons', {}).get(cle, ''), 'source': prop['sources'][cle], 'date': jour}
	m['dernierSetup'] = jour
	return m


def diff(avant, apres, noms):
	"""Lignes de la carte pour la mémoire : l'objet avant et après, le contexte ajouté ou retiré, la raison de chaque réglage
	qui change. `noms` : clé -> nom du réglage en mots simples. Vide : rien à écrire."""
	avant = avant or {}
	lignes = []
	if apres.get('objet') != avant.get('objet'):
		lignes.append(f"- Mémoire, objet : {avant.get('objet') or 'aucun'} → {apres['objet']}")
	vus = {c['texte'] for c in avant.get('contexte', [])}
	nouveaux = {c['texte'] for c in apres.get('contexte', [])}
	lignes += [f"- Mémoire, contexte ajouté : {c['texte']}" for c in apres.get('contexte', []) if c['texte'] not in vus]
	lignes += [f"- Mémoire, contexte retiré : {c['texte']}" for c in avant.get('contexte', []) if c['texte'] not in nouveaux]
	for cle, d in apres.get('decisions', {}).items():
		ancien = avant.get('decisions', {}).get(cle)
		if d['raison'] and (ancien or {}).get('raison') != d['raison']:
			lignes.append(f"- Mémoire, raison de « {noms.get(cle, cle)} » : {d['raison']}")
	return lignes


def ecrire(racine, memoire):
	"""Écriture atomique sous le verrou des fichiers de politique. Un fichier illisible est mis de côté (setup.json.illisible), jamais supprimé."""
	chemin = fichier(racine)
	d = os.path.dirname(chemin)
	os.makedirs(d, exist_ok=True)
	with open(os.path.join(d, '.pratiques.lock'), 'w') as verrou:
		fcntl.flock(verrou, fcntl.LOCK_EX)
		if os.path.exists(chemin) and lire(racine)[1]:
			os.replace(chemin, chemin + '.illisible')
		fd, tmp = tempfile.mkstemp(dir=d, prefix='tmp-setup-')
		with os.fdopen(fd, 'w') as f:
			json.dump(memoire, f, ensure_ascii=False, indent=2)
			f.write('\n')
		os.replace(tmp, chemin)


# ---------- le diff de l'orga (FR-016) ----------

CLICS = {'never': 'jamais', 'before': 'avant le travail', 'after': 'après le travail'}  # comme CLICS d'agence.py : la CLI les dit pareil


def _en_texte(v):
	return ', '.join(map(str, v)) if isinstance(v, list) else 'aucun' if v is None else str(v)


def diff_orga(avant, apres):
	"""Lignes de la carte d'orga : postes et liens ajoutés, retirés, modifiés (le champ, avant et après), plafond d'agents.
	avant et apres : le fichier d'orga (`roles`, `links`, `maxAgents`), l'avant étant l'orga effective (solo sans fichier)."""
	lignes = []
	if avant.get('maxAgents') != apres.get('maxAgents'):
		lignes.append(f"- Orga, agents vivants au plus : {_en_texte(avant.get('maxAgents'))} → {_en_texte(apres.get('maxAgents'))}")
	anciens, nouveaux = avant.get('roles', {}), apres.get('roles', {})
	lignes += [f"- Orga, poste ajouté : {pid} ({r.get('name', pid)})" for pid, r in nouveaux.items() if pid not in anciens]
	lignes += [f"- Orga, poste retiré : {pid} ({r.get('name', pid)})" for pid, r in anciens.items() if pid not in nouveaux]
	for pid, r in nouveaux.items():
		if pid in anciens and anciens[pid] != r:
			champs = [f'{k} : {_en_texte(anciens[pid].get(k))} → {_en_texte(r.get(k))}' for k in dict.fromkeys([*anciens[pid], *r]) if anciens[pid].get(k) != r.get(k)]
			lignes.append(f"- Orga, poste modifié : {pid} ({' ; '.join(champs)})")
	vieux = {(l['from'], l['to']): l for l in avant.get('links', [])}
	neufs = {(l['from'], l['to']): l for l in apres.get('links', [])}
	lignes += [f'- Orga, lien ajouté : {a} -> {b}' + (f"{', vérifié par ' + l['verifiedBy'] if l.get('verifiedBy') else ''} ; clic {CLICS.get(l.get('click'), l.get('click'))}") for (a, b), l in neufs.items() if (a, b) not in vieux]
	lignes += [f'- Orga, lien retiré : {a} -> {b}' for (a, b) in vieux if (a, b) not in neufs]
	for (a, b), l in neufs.items():
		if (a, b) in vieux and vieux[(a, b)] != l:
			champs = []
			if vieux[(a, b)].get('verifiedBy') != l.get('verifiedBy'):
				champs.append(f"vérifié par : {_en_texte(vieux[(a, b)].get('verifiedBy'))} → {_en_texte(l.get('verifiedBy'))}")
			if vieux[(a, b)].get('click') != l.get('click'):
				champs.append(f"clic : {CLICS.get(vieux[(a, b)].get('click'))} → {CLICS.get(l.get('click'))}")
			lignes.append(f"- Orga, lien modifié : {a} -> {b} ({' ; '.join(champs)})")
	return lignes
