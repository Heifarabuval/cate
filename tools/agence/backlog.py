"""Backlog de fiches et registre de décisions (spec 010) : schéma, validation, ajout, modification, transitions.

Deux fichiers JSON éditables à la main, <racine>/.cate/tmp/agence/backlog.json et decisions.json, écrits seulement
par `agence fiche` et `agence decision`, sous le verrou de l'état. Un fichier invalide (Invalide) bloque toute
écriture ; une demande refusée (Refus) ne change rien. Fonctions pures sauf charger et ecrire.
Python 3.9, stdlib seule ; aucune fonction n'importe agence.py.
"""
import json
import math
import os
import posixpath
import re
import tempfile
from datetime import datetime, timedelta

ETATS = ('discussion', 'prête', 'lancée', 'faite', 'abandonnée')
PAR_LA_CLI = ('discussion', 'prête')  # lancée, faite, abandonnée : régisseur, sur clic ou à la fermeture du besoin
TERMINAUX = ('faite', 'abandonnée')
TYPES = ('bug', 'idee', 'retour', 'audit', 'tache')
PRIORITES = ('P1', 'P2', 'P3')
STATUTS = ('proposée', 'active', 'rejetée', 'révoquée')
EXIGES = ('titre', 'type', 'preuve', 'priorite', 'fichiers', 'budgetJetons', 'vision')  # pour passer prête
# Référentiel des points de vision (spec 010, Q2) : couches et FR de la spec 009. Hors liste : signalée par la revue, jamais refusée.
VISION = tuple(f'couche-{i}' for i in range(1, 5)) + tuple(f'FR-{i:03d}' for i in range(1, 15))

_txt = lambda v: isinstance(v, str)  # noqa: E731
_txt_nul = lambda v: v is None or isinstance(v, str)  # noqa: E731
_liste = lambda v: isinstance(v, list) and all(isinstance(x, str) for x in v)  # noqa: E731
_journal = lambda v: isinstance(v, list) and all(isinstance(x, dict) and set(x) == {'ts', 'by', 'text'} for x in v)  # noqa: E731

CHAMPS_FICHE = {
	'id': lambda v: isinstance(v, str) and re.fullmatch(r'F[1-9]\d*', v) is not None,
	'titre': _txt,
	'type': lambda v: v is None or v in TYPES,
	'preuve': _txt_nul,
	'priorite': lambda v: v is None or v in PRIORITES,
	'fichiers': _liste,
	'dependances': _liste,
	'budgetJetons': lambda v: v is None or (type(v) is int and v > 0),
	'vision': _txt_nul,
	'modele': _txt_nul,
	'decisions': _liste,
	'etat': lambda v: v in ETATS,
	'besoin': _txt_nul,
	'creee': _txt,
	'maj': _txt,
	'journal': _journal,
}
CHAMPS_DECISION = {
	'id': lambda v: isinstance(v, str) and re.fullmatch(r'D[1-9]\d*', v) is not None,
	'date': _txt,
	'objet': _txt,
	'pourquoi': _txt,
	'alternatives': _liste,
	'invalide': _liste,
	'structurante': lambda v: isinstance(v, bool),
	'statut': lambda v: v in STATUTS,
	'revoqueePar': _txt_nul,
}
EDITABLES = ('titre', 'type', 'preuve', 'priorite', 'fichiers', 'dependances', 'budgetJetons', 'vision', 'modele', 'decisions')


class Invalide(Exception):
	"""Fichier refusé (édité à la main) : le message cite le fichier et le motif ; rien ne s'écrit."""


class Refus(Exception):
	"""Demande refusée : rien n'a changé."""


def vide():
	return {'seq': 0, 'fiches': [], 'derniereRevue': None}


def vide_decisions():
	return {'seq': 0, 'decisions': []}


def chemin(racine, nom):
	return os.path.join(racine, '.cate', 'tmp', 'agence', nom)


# ---------- validation ----------

def _objets(contenu, racine_cles, coll, champs, nom):
	if not isinstance(contenu, dict):
		raise Invalide(f'{nom} : la racine doit être un objet JSON')
	if set(contenu) != set(racine_cles):
		raise Invalide(f"{nom} : clés de la racine {sorted(contenu)}, attendues {sorted(racine_cles)}")
	if type(contenu['seq']) is not int or contenu['seq'] < 0 or not isinstance(contenu[coll], list):
		raise Invalide(f'{nom} : seq doit être un entier positif et {coll} une liste')
	vus = set()
	for x in contenu[coll]:
		if not isinstance(x, dict):
			raise Invalide(f'{nom} : chaque élément de {coll} doit être un objet')
		oid = x.get('id', '?')
		if set(x) != set(champs):
			inconnus, absents = sorted(set(x) - set(champs)), sorted(set(champs) - set(x))
			raise Invalide(f"{nom} : {oid} : champs inconnus {inconnus}, absents {absents}")
		for cle, ok in champs.items():
			if not ok(x[cle]):
				raise Invalide(f'{nom} : {oid} : {cle} invalide ({json.dumps(x[cle], ensure_ascii=False)})')
		if oid in vus or int(oid[1:]) > contenu['seq']:
			raise Invalide(f'{nom} : {oid} en double ou au-delà de seq')
		vus.add(oid)


def valider(b):
	_objets(b, ('seq', 'fiches', 'derniereRevue'), 'fiches', CHAMPS_FICHE, 'backlog.json')
	if not _txt_nul(b['derniereRevue']):
		raise Invalide('backlog.json : derniereRevue doit être une date ou null')
	err = _dependances(b['fiches'])
	if err:
		raise Invalide(f'backlog.json : {err}')


def valider_decisions(d):
	_objets(d, ('seq', 'decisions'), 'decisions', CHAMPS_DECISION, 'decisions.json')


def _dependances(fiches):
	"""Motif d'erreur (dépendance inconnue, cycle nommé) ou None."""
	par_id = {f['id']: f for f in fiches}
	for f in fiches:
		for dep in f['dependances']:
			if dep not in par_id:
				return f"{f['id']} : dépendance inconnue {dep}"

	def chemin_cycle(fid, pile):
		if fid in pile:
			return pile[pile.index(fid):] + [fid]
		for dep in par_id[fid]['dependances']:
			c = chemin_cycle(dep, pile + [fid])
			if c:
				return c
		return None
	for f in fiches:  # ponytail: parcours naïf par fiche, O(n²) au pire ; un backlog réel reste sous 100 fiches
		c = chemin_cycle(f['id'], [])
		if c:
			return 'dépendances en cycle : ' + ' -> '.join(c)
	return None


def manques(f):
	"""Champs exigés pour `prête` qui manquent, dans l'ordre de EXIGES."""
	return [c for c in EXIGES if f[c] in (None, '', []) or (isinstance(f[c], str) and not f[c].strip())]


# ---------- fiches ----------

def trouver(coll, oid):
	for x in coll:
		if x['id'] == oid:
			return x
	raise Refus(f'{oid} introuvable')


def _poser(b, f, champs, maintenant):
	"""Applique champs à une copie de f, valide, puis remplace f dans b ; Refus sans rien changer sinon."""
	inconnus = set(champs) - set(EDITABLES)
	if inconnus:
		raise Refus(f'champs non modifiables : {", ".join(sorted(inconnus))}')
	neuve = {**f, **champs, 'maj': maintenant}
	if 'titre' in champs and not str(champs['titre']).strip():
		raise Refus('titre vide')
	for cle in champs:
		if not CHAMPS_FICHE[cle](neuve[cle]):
			raise Refus(f'{cle} invalide : {json.dumps(neuve[cle], ensure_ascii=False)}')
	if champs.get('preuve') is not None:
		import pratiques  # à côté de ce fichier : la grammaire de --done-when (spec 005)
		try:
			pratiques.conditions(neuve['preuve'])
		except pratiques.Invalide as err:
			raise Refus(f'preuve : {err}')
	if neuve['etat'] == 'prête' and manques(neuve):
		raise Refus(f"{f['id']} est prête : {', '.join(manques(neuve))} ne peut pas manquer")
	fiches = [neuve if x is f else x for x in b['fiches']]
	err = _dependances(fiches)
	if err:
		raise Refus(err)
	b['fiches'][:] = fiches
	return neuve


def _modifiable(f):
	if f['etat'] in TERMINAUX:
		raise Refus(f"{f['id']} est {f['etat']} : elle ne change plus")


def ajouter(b, titre, maintenant, **champs):
	f = {**{c: None for c in CHAMPS_FICHE}, 'id': f"F{b['seq'] + 1}", 'titre': titre, 'fichiers': [], 'dependances': [],
	     'decisions': [], 'etat': 'discussion', 'creee': maintenant, 'maj': maintenant, 'journal': []}
	if not titre.strip():
		raise Refus('titre vide')
	b['fiches'].append(f)
	try:
		f = _poser(b, f, champs, maintenant)
	except Refus:
		b['fiches'].pop()
		raise
	b['seq'] += 1
	return f


def modifier(b, fid, maintenant, **champs):
	f = trouver(b['fiches'], fid)
	_modifiable(f)
	return _poser(b, f, champs, maintenant)


def transition(b, fid, etat, maintenant):
	"""Transition par la CLI : discussion <-> prête seulement ; prête exige les champs de EXIGES."""
	if etat not in ETATS:
		raise Refus(f'état inconnu : {etat} ({", ".join(ETATS)})')
	if etat not in PAR_LA_CLI:
		raise Refus(f'{etat} : par le clic seulement')
	f = trouver(b['fiches'], fid)
	_modifiable(f)
	if f['etat'] not in PAR_LA_CLI:
		raise Refus(f"{fid} est {f['etat']} : par le clic seulement")
	if etat == 'prête' and manques(f):
		raise Refus(f"{fid} ne passe pas prête, champs manquants : {', '.join(manques(f))}")
	f['etat'], f['maj'] = etat, maintenant
	return f


def noter(b, fid, texte, maintenant, par='cli'):
	f = trouver(b['fiches'], fid)
	_modifiable(f)
	texte = ' '.join(texte.split())  # une ligne : un texte d'agent ne forge pas une ligne « clic »
	if not texte:
		raise Refus('note vide')
	f['journal'].append({'ts': maintenant, 'by': par, 'text': texte})
	f['maj'] = maintenant
	return f


# ---------- décisions ----------

def decision_ajouter(d, objet, pourquoi, maintenant, alternatives=(), invalide=(), structurante=False):
	"""Une décision naît proposée ; active, rejetée et révoquée viennent d'un clic de l'humain (lot 6)."""
	if not objet.strip() or not pourquoi.strip():
		raise Refus('une décision porte un objet et un pourquoi')
	x = {'id': f"D{d['seq'] + 1}", 'date': maintenant, 'objet': objet.strip(), 'pourquoi': pourquoi.strip(),
	     'alternatives': list(alternatives), 'invalide': list(invalide), 'structurante': bool(structurante),
	     'statut': 'proposée', 'revoqueePar': None}
	d['seq'] += 1
	d['decisions'].append(x)
	return x


def decisions_actives(d):
	return [x for x in d['decisions'] if x['statut'] == 'active']


def revoquees(d, x):
	"""Décisions actives que x invalide (ids cités dans x['invalide'])."""
	return [y for y in decisions_actives(d) if y['id'] in x['invalide'] and y['id'] != x['id']]


def decider(d, did, choix):
	"""Clic sur une décision proposée (lot 6) : valider la pose active et révoque les actives qu'elle invalide
	(revoqueePar = did) ; rejeter la pose rejetée. Rend les ids changés ; Refus si elle n'est plus proposée."""
	x = trouver(d['decisions'], did)
	if x['statut'] != 'proposée':
		raise Refus(f"{did} est déjà {x['statut']}")
	if choix == 'rejeter':
		x['statut'] = 'rejetée'
		return [did]
	anciennes = revoquees(d, x)
	for y in anciennes:
		y.update(statut='révoquée', revoqueePar=did)
	x['statut'] = 'active'
	return [did] + [y['id'] for y in anciennes]


def reviser(b, fid, choix, maintenant):
	"""Clic de la revue de cap sur une fiche en discussion : relancer remet maj à maintenant ; abandonner la passe
	abandonnée (état terminal, rien supprimé). Refus si elle n'est plus en discussion."""
	f = trouver(b['fiches'], fid)
	if f['etat'] != 'discussion':
		raise Refus(f"{fid} est {f['etat']}")
	noter(b, fid, 'relancée (revue de cap)' if choix == 'relancer' else 'abandonnée (revue de cap)', maintenant, par='clic')
	if choix == 'abandonner':
		f['etat'] = 'abandonnée'
	return f


# ---------- détections (lot 2) : fonctions pures, aucun appel externe (SC-006) ----------

def chevauche(a, b):
	"""Premier chemin commun de a et b (le plus long des deux : un fichier et son dossier donnent le fichier), sinon None.
	Comparaison par segments après posixpath.normpath : src/a et src/ab.ts ne se chevauchent pas."""
	for p in a['fichiers']:
		for q in b['fichiers']:
			if not p.strip() or not q.strip():  # chemin vide : il ne désigne rien, pas la racine
				continue
			x, y = posixpath.normpath(p), posixpath.normpath(q)
			if x == y or '.' in (x, y) or y.startswith(x + '/') or x.startswith(y + '/'):
				return max(x, y, key=len)
	return None


def _rang(f):
	return (f['priorite'] or 'P9', f['creee'], int(f['id'][1:]))


def plan(fiches, faites, place, maximum, occupees=()):
	"""Vagues d'un lot : {vagues, part, attente}. Tri par priorité puis ancienneté ; une fiche entre dans la première
	vague après ses dépendances du lot où elle ne chevauche personne. Une dépendance hors lot pas dans faites la met
	en attente. Seule la première vague part, bornée par place (agents.max moins les vivants) ; tout le reste a un motif.
	occupees : fiches lancées, qui tiennent leurs fichiers ; comptées dans la première vague, jamais rendues."""
	lot = {f['id']: f for f in fiches}  # un id en double ne compte qu'une fois
	vagues, ou, attente = [[f['id'] for f in occupees]] if occupees else [], {f['id']: 0 for f in occupees}, {}
	lot.update({f['id']: f for f in occupees})
	reste = sorted((f for f in lot.values() if f['id'] not in ou), key=_rang)
	while reste:  # chaque passe place au moins une fiche (dépendances sans cycle, validées à l'écriture)
		suite = []
		for f in reste:
			deps = [d for d in f['dependances'] if d not in faites]
			bloque = next((d for d in deps if d not in lot or d in attente and d not in ou), None)
			if bloque:
				attente[f['id']] = f'dépendance {bloque}'
				continue
			if any(d not in ou for d in deps):
				suite.append(f)
				continue
			w = max([ou[d] + 1 for d in deps], default=0)
			motif = f'dépendance {max(deps, key=lambda d: ou[d])}' if w else None
			while w < len(vagues):
				autre = next(((g, c) for g in vagues[w] for c in [chevauche(lot[g], f)] if c), None)
				if not autre:
					break
				motif = motif or f'chevauche {autre[0]} sur {autre[1]}'
				w += 1
			if w == len(vagues):
				vagues.append([])
			vagues[w].append(f['id'])
			ou[f['id']] = w
			if motif:
				attente[f['id']] = motif
		if len(suite) == len(reste):  # cycle édité à la main : refusé à la lecture, jamais atteint
			attente.update({f['id']: 'dépendance en cycle' for f in suite})
			break
		reste = suite
	occ = {f['id'] for f in occupees}
	vagues = [[x for x in w if x not in occ] for w in vagues]
	part = vagues[0][:max(place, 0)] if vagues else []
	for fid in vagues[0][len(part):] if vagues else []:
		attente[fid] = f'plafond ({maximum})'
	vagues = [w for w in vagues if w]  # la première vide : tout ce qui reste attend une lancée
	return {'vagues': vagues, 'part': part, 'attente': {f: attente[f] for f in sorted(attente, key=lambda x: int(x[1:]))}}


def _age(depuis, maintenant):
	return datetime.fromisoformat(maintenant) - datetime.fromisoformat(depuis)


def perimees(fiches, maintenant, jours=14):
	"""Fiches en discussion modifiées il y a plus de `jours` jours (14 pile : pas encore)."""
	return [f for f in fiches if f['etat'] == 'discussion' and _age(f['maj'], maintenant) > timedelta(days=jours)]


def revue_due(derniere, premiere_fiche, maintenant, jours=7):
	"""7 jours après la revue précédente, sinon après la première fiche ; jamais sur un backlog vide."""
	depuis = derniere or premiere_fiche
	return depuis is not None and _age(depuis, maintenant) >= timedelta(days=jours)


def revue(b, d, depassements, maintenant):
	"""Contenu de la carte de revue de cap (FR-009) : fiches périmées, besoins dont le budget est dépassé (tels que
	passés), décisions structurantes des 7 derniers jours, fiches dont la vision est hors référentiel ; None si rien."""
	r = {'perimees': perimees(b['fiches'], maintenant),
	     'depassements': list(depassements),
	     'structurantes': [x for x in d['decisions'] if x['structurante'] and _age(x['date'], maintenant) <= timedelta(days=7)],
	     'horsVision': [f for f in b['fiches'] if f['etat'] not in TERMINAUX and f['vision'] and f['vision'] not in VISION]}
	return r if any(r.values()) else None


def consomme(mesures, panneaux):
	"""Somme inputTokens + outputTokens des panneaux du besoin (lignes de cate agent usage par panneau) ; None si
	aucune valeur lisible, jamais 0 par défaut."""
	vals = [v for p in panneaux for k in ('inputTokens', 'outputTokens')
	        for v in [((mesures or {}).get(p) or {}).get(k)] if type(v) in (int, float) and math.isfinite(v) and v >= 0]
	return sum(vals) if vals else None


def brief(fiche, decisions):
	"""Texte fixe donné à l'orchestrateur : un champ par ligne, dans l'ordre, puis les décisions liées actives
	(objet ; pourquoi). Une décision proposée, rejetée ou révoquée n'est pas citée."""
	val = lambda v: (', '.join(v) if isinstance(v, list) else '' if v is None else str(v)) or '-'  # noqa: E731
	liees = [x for x in decisions if x['id'] in fiche['decisions'] and x['statut'] == 'active']
	return '\n'.join([f"{fiche['id']} : {fiche['titre']}"] +
	                 [f'{c} : {val(fiche[c])}' for c in
	                  ('type', 'priorite', 'preuve', 'fichiers', 'dependances', 'budgetJetons', 'vision', 'modele')] +
	                 [f"decisions : {val([x['id'] for x in liees])}"] +
	                 [f"  {x['id']} : {x['objet']} ; {x['pourquoi']}" for x in liees])


# ---------- fichiers ----------

def _lire(path, defaut, valide, nom):
	try:
		with open(path) as f:
			contenu = json.load(f)
	except FileNotFoundError:
		return defaut
	except (OSError, ValueError) as err:
		raise Invalide(f'{nom} illisible : {err}')
	valide(contenu)
	return contenu


def charger(racine):
	"""{'backlog', 'decisions'} validés à chaque lecture ; fichier absent : vide ; Invalide sinon."""
	return {'backlog': _lire(chemin(racine, 'backlog.json'), vide(), valider, 'backlog.json'),
	        'decisions': _lire(chemin(racine, 'decisions.json'), vide_decisions(), valider_decisions, 'decisions.json')}


def ecrire(racine, nom, contenu):
	"""Remplacement atomique ; à appeler sous le verrou de l'état."""
	path = chemin(racine, nom)
	os.makedirs(os.path.dirname(path), exist_ok=True)
	fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=f'tmp-{nom}-')
	with os.fdopen(fd, 'w') as f:
		json.dump(contenu, f, ensure_ascii=False, indent=1)
	os.replace(tmp, path)
