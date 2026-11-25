"""Pratiques réglables d'un dev (spec 005) : la politique de flux, lue à chaque appel dans deux fichiers JSON.

Schéma, valeurs permises, cohérences, invariants et presets sont déclarés une fois, dans pratiques.json (à côté).
Ordre, la dernière source gagne clé par clé : preset neutre (défaut), fichier du dev (son preset puis ses clés),
fichier du projet (son preset puis ses clés). Les deux fichiers s'écrivent seulement par `agence pratiques`.
Python 3.9, stdlib seule ; aucune fonction n'importe agence.py.
"""
import fcntl
import json
import os
import re
import tempfile

import metiers

ICI = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(ICI, 'pratiques.json')
DEFAUT = 'neutre'
NOM_SOURCE = {'défaut': 'preset neutre'}


class Invalide(Exception):
	"""Politique refusée : le message cite le fichier, la clé et les valeurs permises (pour la CLI) ; `phrase` le dit
	en mots simples, sans clé ni chemin (pour le formulaire du panneau, spec 008 FR-005)."""

	def __init__(self, message, phrase=None):
		super().__init__(message)
		self.phrase = phrase or 'Ce réglage est refusé.'


INCONNU = "Ce réglage n'existe pas."
ILLISIBLE = 'Le fichier de réglages de ce workspace est illisible.'


def schema(path=SCHEMA):
	with open(path) as f:
		return json.load(f)


def fichier_projet(racine):
	return os.path.join(racine, '.cate', 'tmp', 'agence', 'pratiques.json')


def fichier_dev(home):
	return os.path.join(home, '.config', 'agence', 'pratiques.json') if home else None


def lire_valeur(texte):
	"""Valeur tapée sur la ligne de commande : du JSON (4, null, ["a"]), sinon le texte tel quel."""
	try:
		return json.loads(texte)
	except ValueError:
		return texte


def _permis(sch, cle):
	spec = sch['cles'][cle]
	if 'valeurs' in spec:
		return 'une de : ' + ', '.join(map(cle_choix, spec['valeurs']))
	if spec.get('un'):
		return 'une de : ' + ', '.join(_liste(sch, spec))
	if 'entier' in spec:
		return 'un entier de %d à %d' % tuple(spec['entier'])
	if 'motif' in spec:
		return 'un texte de forme %s' % spec['motif']
	return 'une liste sans doublon parmi : ' + ', '.join(_liste(sch, spec))


def _table(spec):
	"""Table d'une clé `parmi` : les catalogues de métiers et de connecteurs suivent AGENCE_CATALOGUES (spec 012)."""
	base = metiers.dossier() if spec['parmi'] in metiers.CATALOGUES else ICI
	with open(os.path.join(base, spec['parmi'])) as f:
		return json.load(f)


def _liste(sch, spec):
	return [r['id'] for r in _table(spec)] if 'parmi' in spec else spec['liste']


def cle_choix(v):
	"""Clé d'une valeur dans `choix` : le texte tel quel, sinon son JSON (300 -> "300")."""
	return v if isinstance(v, str) else json.dumps(v)


def _choix(spec):
	"""[(valeur, libellé)] d'une clé à choix fermés ; None pour un entier ou un motif."""
	if 'parmi' in spec:
		return [(r['id'], r['nom']) for r in _table(spec)]
	permis = spec.get('valeurs') or spec.get('liste')
	return [(v, spec['choix'][cle_choix(v)]) for v in permis] if permis else None


def _phrase(spec):
	"""Refus d'une valeur, en mots simples : le nom du réglage et ce qu'il accepte, jamais la clé ni la valeur tapée."""
	nom = f"« {spec['nom']} »"
	if 'entier' in spec:
		return f"{nom} : un nombre de %d à %d." % tuple(spec['entier'])
	choix = _choix(spec)
	if choix is None:
		return f"{nom} n'accepte pas cette valeur."
	libs = [f'« {lib} »' for _, lib in choix]
	if 'valeurs' in spec or spec.get('un'):
		return f"{nom} : choisissez {', '.join(libs[:-1])} ou {libs[-1]}." if len(libs) > 1 else f"{nom} : choisissez {libs[0]}."
	return f"{nom} : choisissez parmi {', '.join(libs)}, sans doublon."


def _valide(sch, cle, v):
	spec = sch['cles'][cle]
	if v is None:
		return bool(spec.get('nul'))
	if 'valeurs' in spec:  # type exact : True n'est pas 1, ni False 0
		return any(type(v) is type(x) and v == x for x in spec['valeurs'])
	if 'entier' in spec:
		return type(v) is int and spec['entier'][0] <= v <= spec['entier'][1]
	if 'motif' in spec:
		return isinstance(v, str) and re.search(spec['motif'], v) is not None
	if spec.get('un'):  # une valeur de la table (spec 012 : metier)
		return isinstance(v, str) and v in _liste(sch, spec)
	return isinstance(v, list) and len(set(map(str, v))) == len(v) and all(isinstance(x, str) and x in _liste(sch, spec) for x in v)


def aplatir(sch, contenu, origine):
	"""Fichier imbriqué -> {'preset': ..., 'livraison.mode': ...} validé clé par clé ; Invalide sinon."""
	if not isinstance(contenu, dict):
		raise Invalide(f'{origine} : la racine doit être un objet JSON', ILLISIBLE)
	presets = sch['presets']
	plat = {}
	if 'preset' in contenu:
		if contenu['preset'] not in presets:
			raise Invalide(f"{origine} : preset {contenu['preset']!r} inconnu ; permis : {', '.join(presets)}",
			               "Ce modèle de réglages n'existe pas.")
		plat['preset'] = contenu['preset']

	def descend(d, prefixe):
		for k, v in d.items():
			cle = prefixe + k
			if not prefixe and k == 'preset':
				continue
			if '.' not in k and cle in sch['cles']:
				if not _valide(sch, cle, v):
					raise Invalide(f"{origine} : clé « {cle} » : valeur {json.dumps(v, ensure_ascii=False)} refusée ; "
					               f"attendu {_permis(sch, cle)}", _phrase(sch['cles'][cle]))
				plat[cle] = v
			elif '.' not in k and isinstance(v, dict) and any(c.startswith(cle + '.') for c in sch['cles']):
				descend(v, cle + '.')
			else:
				while isinstance(v, dict) and v:  # nomme la feuille : « livraisn.mode », pas « livraisn »
					k, v = next(iter(v.items()))
					cle += '.' + k
				raise Invalide(f"{origine} : clé inconnue « {cle} » (une seule forme : objets imbriqués) ; "
				               f"clés permises : preset, {', '.join(sch['cles'])}", INCONNU)
	descend(contenu, '')
	return plat


def _lire(chemin):
	"""Contenu JSON du fichier, None s'il est absent ; Invalide s'il est illisible."""
	if not chemin:
		return None
	try:
		with open(chemin) as f:
			return json.load(f)
	except FileNotFoundError:
		return None
	except (OSError, ValueError) as err:
		raise Invalide(f'{chemin} : JSON illisible ({err})', ILLISIBLE)


def fusionner(sch, couches):
	"""couches : [(source, chemin, contenu ou None)], du plus faible au plus fort. Rend la politique ; Invalide sinon."""
	# une clé absente de neutre (modèle par rôle, spec 010 lot 7) vaut null : aucun preset livré ne la pose
	valeurs = {**{k: None for k in sch['cles']}, **sch['presets'][DEFAUT]['valeurs']}
	sources = {k: 'défaut' for k in valeurs}
	sources['preset'] = 'défaut'
	preset = DEFAUT
	origines = dict(NOM_SOURCE)
	for source, chemin, contenu in couches:
		if contenu is None:
			continue
		origines[source] = chemin
		plat = aplatir(sch, contenu, chemin)
		if 'preset' in plat:
			preset = plat.pop('preset')
			sources['preset'] = source
			for k, v in sch['presets'][preset]['valeurs'].items():
				valeurs[k], sources[k] = v, source
		for k, v in plat.items():
			valeurs[k], sources[k] = v, source
	if 'metier' in sch['cles']:
		_metier(valeurs, origines, sources)
	for c in sch['coherences']:
		if all(_touche(valeurs[k], permis) for k, permis in c['si'].items()):
			detail = ' avec '.join(f'{k} = {json.dumps(valeurs[k], ensure_ascii=False)} ({origines[sources[k]]})' for k in c['si'])
			raise Invalide(f"combinaison refusée : {detail} : {c['message']}", c['phrase'])
	return {'preset': preset, 'valeurs': valeurs, 'sources': sources, 'erreur': None}


def _metier(valeurs, origines, sources):
	"""Spec 012 (FR-002) : métier absent = dev ; lecture absente = tous les connecteurs du métier ; écriture absente =
	aucune. Un connecteur ouvert hors du métier est refusé, avec son nom et celui du métier."""
	try:
		cat = metiers.charger()
	except metiers.Invalide as err:
		raise Invalide(f'catalogue des métiers refusé : {err}', 'Le catalogue des métiers est illisible.')
	if valeurs['metier'] is None:
		valeurs['metier'] = metiers.DEV
	m = metiers.metier(cat, valeurs['metier'])
	if valeurs['connecteurs.lecture'] is None:
		valeurs['connecteurs.lecture'] = list(m['connecteurs'])
	if valeurs['connecteurs.ecriture'] is None:
		valeurs['connecteurs.ecriture'] = []
	for cle in CLES_CONNECTEURS:
		for ident in valeurs[cle]:
			if ident not in m['connecteurs']:
				nom = metiers.connecteur(cat, ident)['nom']
				raise Invalide(f"combinaison refusée : {cle} = {ident} « {nom} » ({origines[sources[cle]]}) hors du métier "
				               f"{m['id']} « {m['nom']} » ({origines[sources['metier']]})",
				               f"« {nom} » n'est pas un outil du métier « {m['nom']} ».")


def _touche(v, permis):
	return any(x in permis for x in v) if isinstance(v, list) else v in permis


def _couches(racine, home, remplace=None, ponctuel=None):
	"""ponctuel : {'agents.max': 6}, les options du dernier `agence start` (spec 008 FR-009), en dernier."""
	out = []
	for source, chemin in (('dev', fichier_dev(home)), ('projet', fichier_projet(racine))):
		contenu = remplace[1] if remplace and remplace[0] == chemin else _lire(chemin)
		out.append((source, chemin, contenu))
	if ponctuel:
		imbrique = {}
		for cle, v in ponctuel.items():
			tete, fin = _chemin(cle)
			d = imbrique
			for t in tete:
				d = d.setdefault(t, {})
			d[fin] = v
		out.append(('ponctuel', 'option de agence start', imbrique))
	return out


def charger(racine, home, ponctuel=None):
	"""Politique effective. Fichier invalide : valeurs de neutre et `erreur` renseignée (seuls ceux qui agissent refusent)."""
	sch = schema()
	try:
		return fusionner(sch, _couches(racine, home, ponctuel=ponctuel))
	except Invalide as err:
		pol = fusionner(sch, [])
		pol['erreur'] = str(err)
		return pol


def verifier(racine, home, ponctuel=None):
	"""check : Invalide si l'un des fichiers ou leur combinaison est refusé ; n'écrit rien."""
	return fusionner(schema(), _couches(racine, home, ponctuel=ponctuel))


# ---------- écriture (la CLI seule) ----------

def _modifier(racine, home, dev, change, lire=True, ponctuel=None):
	"""Applique change(contenu) au fichier visé, valide la politique entière qui en résulte avec la couche ponctuelle qui
	restera (celle de l'état), puis écrit (verrou, atomique). Refus : rien d'écrit, la politique publiée reste valide.
	lire=False : part d'un objet vide, sans lire l'ancien fichier (repartir d'un fichier illisible)."""
	chemin = fichier_dev(home) if dev else fichier_projet(racine)
	if not chemin:
		raise Invalide('HOME absent : pas de fichier du dev', 'Vos réglages de tous vos projets sont introuvables sur cette machine.')
	d = os.path.dirname(chemin)
	os.makedirs(d, exist_ok=True)
	with open(os.path.join(d, '.pratiques.lock'), 'w') as verrou:
		fcntl.flock(verrou, fcntl.LOCK_EX)
		contenu = (_lire(chemin) if lire else None) or {}
		if not isinstance(contenu, dict):
			raise Invalide(f'{chemin} : la racine doit être un objet JSON', ILLISIBLE)
		change(contenu)
		fusionner(schema(), _couches(racine, home, (chemin, contenu), ponctuel))
		fd, tmp = tempfile.mkstemp(dir=d, prefix='tmp-pratiques-')
		with os.fdopen(fd, 'w') as f:
			json.dump(contenu, f, ensure_ascii=False, indent=1)
			f.write('\n')
		os.replace(tmp, chemin)
	return chemin


def _chemin(cle):
	*tete, fin = cle.split('.')
	return tete, fin


def _dev(cle, dev):
	"""Fichier visé : celui dit par la CLI (--dev), sinon la portée déclarée de la clé (routes du régisseur)."""
	if dev is not None:
		return dev
	spec = schema()['cles'].get(cle)
	if spec is None:
		raise Invalide(f'clé inconnue « {cle} »', INCONNU)
	return spec['portee'] == 'dev'


def regler(racine, home, cle, valeur, dev=False, ponctuel=None):
	if cle == 'preset':
		return poser_preset(racine, home, valeur, dev, ponctuel=ponctuel)
	return regler_plusieurs(racine, home, [(cle, valeur)], dev, ponctuel)


def regler_plusieurs(racine, home, paires, dev=None, ponctuel=None):
	"""Plusieurs réglages d'un seul fichier en une écriture : tous ou aucun. dev=None : la portée de chaque clé.
	ponctuel : la couche de l'état ; une clé réglée la quitte (spec 008 FR-010), le reste compte dans la validation."""
	if not paires:
		raise Invalide('aucun réglage reçu', 'Aucun réglage reçu.')
	portees = {_dev(cle, dev) for cle, _ in paires}
	if len(portees) > 1:
		raise Invalide('réglages de deux fichiers en un envoi', 'Ces réglages ne se changent pas ensemble : un à la fois.')

	reglees = {cle for cle, _ in paires}
	reste = {k: v for k, v in (ponctuel or {}).items() if k not in reglees}
	return _modifier(racine, home, portees.pop(), _poser(None, paires), ponctuel=reste)


def _poser(preset, paires):
	"""change(contenu) d'une écriture : le preset d'abord s'il y en a un, puis chaque clé."""
	def change(contenu):
		if preset:
			contenu['preset'] = preset
		for cle, valeur in paires:
			tete, fin = _chemin(cle)
			d = contenu
			for t in tete:
				if not isinstance(d.get(t), dict):
					d[t] = {}
				d = d[t]
			d[fin] = valeur
	return change


def appliquer(racine, home, preset, paires, ecrire=False, ponctuel=None):
	"""Spec 015 : une proposition du setup (preset puis clés, fichier du projet). Rend la politique effective qui en
	résulte ; ecrire=False ne touche à rien (aperçu et diff d'une carte), ecrire=True l'écrit comme le formulaire
	(`regler_plusieurs` : même verrou, même écriture, même validation). Une clé personnelle est refusée : elle se règle au formulaire."""
	if not preset and not paires:
		raise Invalide('aucun réglage reçu', 'Aucun réglage reçu.')
	sch = schema()
	for cle, _ in paires:
		if cle not in sch['cles']:
			raise Invalide(f'clé inconnue « {cle} »', INCONNU)
		if sch['cles'][cle]['portee'] != 'workspace':
			raise Invalide(f'clé « {cle} » personnelle : elle se règle au formulaire, pas par le setup',
			               f"« {sch['cles'][cle]['nom']} » est personnel : il se change dans les réglages.")
	if preset and preset not in sch['presets']:
		raise Invalide(f"preset {preset!r} inconnu ; permis : {', '.join(sch['presets'])}", "Ce modèle de réglages n'existe pas.")
	reste = {k: v for k, v in (ponctuel or {}).items() if k not in {c for c, _ in paires} | posees_par_preset(preset)}
	change = _poser(preset, paires)
	if ecrire:
		_modifier(racine, home, False, change, ponctuel=reste)
		return verifier(racine, home, reste)
	contenu = _lire(fichier_projet(racine)) or {}
	if not isinstance(contenu, dict):
		raise Invalide(f'{fichier_projet(racine)} : la racine doit être un objet JSON', ILLISIBLE)
	change(contenu)
	return fusionner(sch, _couches(racine, home, (fichier_projet(racine), contenu), reste))


def en_mots(spec, v):
	"""Une valeur en mots simples : le libellé de son choix, la phrase `vide` pour aucune."""
	if v is None or v == []:
		return spec.get('vide', 'Aucun')
	libelles = {cle_choix(x): lib for x, lib in (_choix(spec) or [])}
	un = lambda x: libelles.get(cle_choix(x), str(x))  # noqa: E731
	return ', '.join(map(un, v)) if isinstance(v, list) else un(v)


def ecarts(avant, apres):
	"""[(cle, nom, avant en mots, après en mots)] : les clés dont la valeur effective change, le preset en tête."""
	sch = schema()
	out = []
	if avant['preset'] != apres['preset']:
		noms = {k: p['nom'] for k, p in sch['presets'].items()}
		out.append(('preset', 'Modèle de réglages', noms[avant['preset']], noms[apres['preset']]))
	for cle, spec in sch['cles'].items():
		if avant['valeurs'][cle] != apres['valeurs'][cle]:
			out.append((cle, spec['nom'], en_mots(spec, avant['valeurs'][cle]), en_mots(spec, apres['valeurs'][cle])))
	return out


def retirer(racine, home, cle, dev=False, ponctuel=None):
	dev = _dev(cle, dev)

	def change(contenu):
		tete, fin = _chemin(cle)
		pile = [contenu]
		for t in tete:
			if not isinstance(pile[-1].get(t), dict):
				return
			pile.append(pile[-1][t])
		pile[-1].pop(fin, None)
		for parent, t in reversed(list(zip(pile, tete))):  # objets vidés retirés
			if not parent[t]:
				del parent[t]
	return _modifier(racine, home, dev, change, ponctuel=ponctuel)


def posees_par_preset(nom):
	"""Clés que le preset pose : elles quittent la couche ponctuelle quand il est choisi (spec 008 FR-010)."""
	return set(schema()['presets'].get(nom, {}).get('valeurs', {})) if isinstance(nom, str) else set()


def poser_preset(racine, home, nom, dev=False, remplacer=False, ponctuel=None):
	"""remplacer : le fichier ne garde que le preset (un modèle choisi efface les réglages posés à côté).
	ponctuel : la couche de l'état ; les clés que le preset pose la quittent, le reste compte dans la validation."""
	def change(contenu):
		if remplacer:
			contenu.clear()
		contenu['preset'] = nom
	reste = {k: v for k, v in (ponctuel or {}).items() if k not in posees_par_preset(nom)}
	return _modifier(racine, home, dev, change, lire=not remplacer, ponctuel=reste)


# ---------- vue publiée pour le formulaire du panneau (spec 008, FR-003) ----------

TYPES_CHAMP = ('valeurs', 'entier', 'motif', 'liste', 'parmi')
CLES_CONNECTEURS = ('connecteurs.lecture', 'connecteurs.ecriture')


def champs(sch, pol):
	"""Un champ par clé, dans l'ordre du schéma : de quoi rendre le formulaire sans connaître aucune clé."""
	defauts = sch['presets'][DEFAUT]['valeurs']
	out = []
	for cle, spec in sch['cles'].items():
		forme = next(f for f in TYPES_CHAMP if f in spec)
		choix = _choix(spec)
		if cle in CLES_CONNECTEURS:  # spec 012 : les connecteurs du métier actif, par leur nom
			du_metier = metiers.metier(metiers.charger(), pol['valeurs']['metier'])['connecteurs']
			choix = [(v, lib) for v, lib in choix if v in du_metier]
		out.append({'cle': cle, 'nom': spec['nom'], 'explique': spec['explique'], 'groupe': spec['groupe'],
		            'portee': spec['portee'],
		            'forme': ('valeurs' if spec.get('un') else 'liste') if forme == 'parmi' else forme,
		            'choix': None if choix is None else [{'valeur': v, 'libelle': lib} for v, lib in choix],
		            'bornes': spec.get('entier'), 'vide': spec.get('vide'), 'defaut': defauts.get(cle),
		            'valeur': pol['valeurs'][cle], 'origine': pol['sources'][cle]})
	return out


def vue(racine, home, pol, humain):
	"""Ce que le régisseur publie à côté de la politique : champs, presets, fichier du projet présent, nombre de clés qu'il
	pose (le preset n'en est pas une), invariants rendus avec le nom de l'humain."""
	sch = schema()
	try:
		contenu = _lire(fichier_projet(racine))
		nb = len([k for k in aplatir(sch, contenu, '') if k != 'preset']) if contenu is not None else 0
	except Invalide:
		nb = 0
	return {'champs': champs(sch, pol),
	        'presets': [{'id': k, 'nom': p['nom'], 'explique': p['explique'], 'actif': k == pol['preset']}
	                    for k, p in sch['presets'].items()],
	        'projet': os.path.isfile(fichier_projet(racine)), 'nbProjet': nb,
	        'invariants': [i.replace('{humain}', humain) for i in sch['invariants']]}


# ---------- brief ----------

def brief(pol, humain):
	"""Bloc à coller dans un brief : les invariants, puis une ligne par exigence active, avec sa source."""
	sch = schema()
	lignes = [f"Pratiques du projet (preset {pol['preset']}, source {pol['sources']['preset']}) :"]
	lignes += ['- ' + i.replace('{humain}', humain) for i in sch['invariants']]
	for cle, spec in sch['cles'].items():
		v = pol['valeurs'][cle]
		texte = spec.get('exige', {}).get(v) if isinstance(v, str) else None
		if texte:
			lignes.append(f"- {texte} ({cle} : {v}, source {pol['sources'][cle]})")
	return '\n'.join(lignes)


# ---------- preuve de fin (FR-009, FR-010) ----------

FORMES = 'pr-merged:N, issue-closed:N, ci-green:N, tests-local, report, draft-sent:ID, preuve:NOM'
CONDITION_RE = re.compile(r'^(?:(pr-merged|issue-closed|ci-green):(\d*)|(tests-local|report)|(draft-sent):([\w.-]+)'
                          r'|(preuve):([\w.-]+))$')
VERS_CONDITION = {'pr-mergee': 'pr-merged:', 'ci-verte': 'ci-green:', 'tests-locaux': 'tests-local', 'rapport': 'report'}
ATTENDU = {'pr-merged': 'MERGED', 'issue-closed': 'CLOSED'}
TYPE = {'pr-merged': 'PullRequest', 'issue-closed': 'Issue'}
MANQUE = {'pr-merged': 'PR non mergée', 'issue-closed': 'issue non fermée', 'ci-green': 'checks non verts',
          'tests-local': 'tests à déclarer (need done --evidence)', 'report': 'rapport attendu (need done --evidence)',
          'draft-sent': 'brouillon non envoyé'}


def conditions(done_when, saisie=False, preuves=None):
	"""'ci-green:12,pr-merged:12' -> [('ci-green', '12'), ('pr-merged', '12')] ; Invalide hors grammaire.
	saisie : le numéro est exigé (la forme dérivée garde N vide jusqu'à `agence need pr`).
	preuves : {nom: type} du métier actif (spec 012) ; une preuve:NOM hors de la liste est refusée."""
	out = []
	for brut in done_when.split(','):
		m = CONDITION_RE.match(brut)
		if not m or (saisie and m.group(1) and not m.group(2)):
			raise Invalide(f'--done-when : « {brut} » hors grammaire ; formes permises, séparées par une virgule : {FORMES}')
		out.append((m.group(1), m.group(2)) if m.group(1) else (m.group(3), None) if m.group(3) else
		           (m.group(4), m.group(5)) if m.group(4) else (m.group(6), m.group(7)))
		if preuves is not None and m.group(6) and m.group(7) not in preuves:
			raise Invalide(f'--done-when : preuve « {m.group(7)} » inconnue du métier actif ; preuves du métier : '
			               + (', '.join(preuves) or 'aucune (métier dev : formes de « Quand une tâche est finie »)'))
	return out


def preuves_du_metier(valeurs):
	"""{nom: type} des preuves nommées du métier actif (spec 012) ; {} pour dev."""
	m = metiers.metier(metiers.charger(), valeurs.get('metier') or metiers.DEV)
	return {p['nom']: p['type'] for p in (m['validateur'] if m else [])}


def done_when_defaut(valeurs):
	"""Condition de fin d'une tâche créée sans --done-when : les preuves du métier (spec 012, FR-007), sinon pour dev
	`preuve`, sinon dérivée du mode ; N vide pour une PR."""
	if valeurs.get('metier') not in (None, metiers.DEV):
		return ','.join('preuve:' + nom for nom in preuves_du_metier(valeurs))
	preuve = valeurs['preuve'] or (['pr-mergee'] if valeurs['livraison.mode'] == 'pr' else ['rapport'])
	return ','.join(VERS_CONDITION[p] for p in preuve)


def rattacher(done_when, num):
	"""`need pr` : la PR num devient l'objet des conditions de PR ; None s'il n'y en a aucune."""
	conds = conditions(done_when)
	if not any(nom in ('pr-merged', 'ci-green') for nom, _ in conds):
		return None
	return ','.join(f'{nom}:{num}' if nom in ('pr-merged', 'ci-green') else nom if arg is None else f'{nom}:{arg}'
	                for nom, arg in conds)


def evaluer(done_when, faits, evidence=None, preuves=None):
	"""(fait, manques). faits : {N: {'state', 'url', 'checks'}} relevé par le tour (checks : état du rollup, None
	inconnu). Les conditions humaines (tests-local, report) et draft-sent ne sont vraies que sur une preuve déclarée.
	preuve:NOM (spec 012) n'est jamais vraie ici : `need done` la contrôle ; le manque dit son nom et son type."""
	manques = []
	for nom, arg in conditions(done_when):
		f = faits.get(arg) if arg else None
		depot = f" (dépôt {f['repo']})" if f and f.get('repo') else ''
		if nom == 'preuve':
			manque = f"preuve attendue : {arg} ({(preuves or {}).get(arg, 'inconnue')})"
		elif nom not in ('pr-merged', 'issue-closed', 'ci-green'):
			manque = None if evidence else MANQUE[nom]
		elif not arg:
			manque = f'{nom} sans numéro : PR non rattachée (agence need pr <besoin> <N>)'
		elif f is None:
			manque = f'#{arg} : état inconnu'
		elif nom == 'ci-green':
			manque = None if f.get('checks') == 'SUCCESS' else 'checks inconnus' if f.get('checks') is None else MANQUE[nom]
		elif f.get('type') and f['type'] != TYPE[nom]:
			manque = f"#{arg} est {'une PR, pas une issue' if f['type'] == 'PullRequest' else 'une issue, pas une PR'}{depot}"
		else:
			manque = None if f.get('state') == ATTENDU[nom] else MANQUE[nom]
		if manque:
			manques.append(manque)
	return not manques, manques
