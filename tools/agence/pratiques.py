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

ICI = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(ICI, 'pratiques.json')
DEFAUT = 'neutre'
NOM_SOURCE = {'défaut': 'preset neutre'}


class Invalide(Exception):
	"""Politique refusée : le message cite le fichier, la clé et les valeurs permises."""


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
		return 'une de : ' + ', '.join(spec['valeurs'])
	if 'entier' in spec:
		return 'un entier de %d à %d' % tuple(spec['entier'])
	if 'motif' in spec:
		return 'un texte de forme %s' % spec['motif']
	return 'une liste sans doublon parmi : ' + ', '.join(_liste(sch, spec))


def _liste(sch, spec):
	if 'parmi' in spec:
		with open(os.path.join(ICI, spec['parmi'])) as f:
			return [r['id'] for r in json.load(f)]
	return spec['liste']


def _valide(sch, cle, v):
	spec = sch['cles'][cle]
	if v is None:
		return bool(spec.get('nul'))
	if 'valeurs' in spec:
		return isinstance(v, str) and v in spec['valeurs']
	if 'entier' in spec:
		return type(v) is int and spec['entier'][0] <= v <= spec['entier'][1]
	if 'motif' in spec:
		return isinstance(v, str) and re.search(spec['motif'], v) is not None
	return isinstance(v, list) and len(set(map(str, v))) == len(v) and all(isinstance(x, str) and x in _liste(sch, spec) for x in v)


def aplatir(sch, contenu, origine):
	"""Fichier imbriqué -> {'preset': ..., 'livraison.mode': ...} validé clé par clé ; Invalide sinon."""
	if not isinstance(contenu, dict):
		raise Invalide(f'{origine} : la racine doit être un objet JSON')
	presets = sch['presets']
	plat = {}
	if 'preset' in contenu:
		if contenu['preset'] not in presets:
			raise Invalide(f"{origine} : preset {contenu['preset']!r} inconnu ; permis : {', '.join(presets)}")
		plat['preset'] = contenu['preset']

	def descend(d, prefixe):
		for k, v in d.items():
			cle = prefixe + k
			if not prefixe and k == 'preset':
				continue
			if '.' not in k and cle in sch['cles']:
				if not _valide(sch, cle, v):
					raise Invalide(f"{origine} : clé « {cle} » : valeur {json.dumps(v, ensure_ascii=False)} refusée ; "
					               f"attendu {_permis(sch, cle)}")
				plat[cle] = v
			elif '.' not in k and isinstance(v, dict) and any(c.startswith(cle + '.') for c in sch['cles']):
				descend(v, cle + '.')
			else:
				while isinstance(v, dict) and v:  # nomme la feuille : « livraisn.mode », pas « livraisn »
					k, v = next(iter(v.items()))
					cle += '.' + k
				raise Invalide(f"{origine} : clé inconnue « {cle} » (une seule forme : objets imbriqués) ; "
				               f"clés permises : preset, {', '.join(sch['cles'])}")
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
		raise Invalide(f'{chemin} : JSON illisible ({err})')


def fusionner(sch, couches):
	"""couches : [(source, chemin, contenu ou None)], du plus faible au plus fort. Rend la politique ; Invalide sinon."""
	# une clé absente de neutre (modèle par rôle, spec 010 lot 7) vaut null : aucun preset livré ne la pose
	valeurs = {**{k: None for k in sch['cles']}, **sch['presets'][DEFAUT]}
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
			for k, v in sch['presets'][preset].items():
				valeurs[k], sources[k] = v, source
		for k, v in plat.items():
			valeurs[k], sources[k] = v, source
	for c in sch['coherences']:
		if all(_touche(valeurs[k], permis) for k, permis in c['si'].items()):
			detail = ' avec '.join(f'{k} = {json.dumps(valeurs[k], ensure_ascii=False)} ({origines[sources[k]]})' for k in c['si'])
			raise Invalide(f"combinaison refusée : {detail} : {c['message']}")
	return {'preset': preset, 'valeurs': valeurs, 'sources': sources, 'erreur': None}


def _touche(v, permis):
	return any(x in permis for x in v) if isinstance(v, list) else v in permis


def _couches(racine, home, remplace=None):
	out = []
	for source, chemin in (('dev', fichier_dev(home)), ('projet', fichier_projet(racine))):
		contenu = remplace[1] if remplace and remplace[0] == chemin else _lire(chemin)
		out.append((source, chemin, contenu))
	return out


def charger(racine, home):
	"""Politique effective. Fichier invalide : valeurs de neutre et `erreur` renseignée (seuls ceux qui agissent refusent)."""
	sch = schema()
	try:
		return fusionner(sch, _couches(racine, home))
	except Invalide as err:
		pol = fusionner(sch, [])
		pol['erreur'] = str(err)
		return pol


def verifier(racine, home):
	"""check : Invalide si l'un des fichiers ou leur combinaison est refusé ; n'écrit rien."""
	return fusionner(schema(), _couches(racine, home))


# ---------- écriture (la CLI seule) ----------

def _modifier(racine, home, dev, change):
	"""Applique change(contenu) au fichier visé, valide la politique entière qui en résulte, puis écrit (verrou, atomique)."""
	chemin = fichier_dev(home) if dev else fichier_projet(racine)
	if not chemin:
		raise Invalide('HOME absent : pas de fichier du dev')
	d = os.path.dirname(chemin)
	os.makedirs(d, exist_ok=True)
	with open(os.path.join(d, '.pratiques.lock'), 'w') as verrou:
		fcntl.flock(verrou, fcntl.LOCK_EX)
		contenu = _lire(chemin) or {}
		if not isinstance(contenu, dict):
			raise Invalide(f'{chemin} : la racine doit être un objet JSON')
		change(contenu)
		fusionner(schema(), _couches(racine, home, (chemin, contenu)))
		fd, tmp = tempfile.mkstemp(dir=d, prefix='tmp-pratiques-')
		with os.fdopen(fd, 'w') as f:
			json.dump(contenu, f, ensure_ascii=False, indent=1)
			f.write('\n')
		os.replace(tmp, chemin)
	return chemin


def _chemin(cle):
	*tete, fin = cle.split('.')
	return tete, fin


def regler(racine, home, cle, valeur, dev=False):
	if cle == 'preset':
		return poser_preset(racine, home, valeur, dev)

	def change(contenu):
		tete, fin = _chemin(cle)
		d = contenu
		for t in tete:
			if not isinstance(d.get(t), dict):
				d[t] = {}
			d = d[t]
		d[fin] = valeur
	return _modifier(racine, home, dev, change)


def retirer(racine, home, cle, dev=False):
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
	return _modifier(racine, home, dev, change)


def poser_preset(racine, home, nom, dev=False):
	return _modifier(racine, home, dev, lambda contenu: contenu.__setitem__('preset', nom))


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

FORMES = 'pr-merged:N, issue-closed:N, ci-green:N, tests-local, report, draft-sent:ID'
CONDITION_RE = re.compile(r'^(?:(pr-merged|issue-closed|ci-green):(\d*)|(tests-local|report)|(draft-sent):([\w.-]+))$')
VERS_CONDITION = {'pr-mergee': 'pr-merged:', 'ci-verte': 'ci-green:', 'tests-locaux': 'tests-local', 'rapport': 'report'}
ATTENDU = {'pr-merged': 'MERGED', 'issue-closed': 'CLOSED'}
MANQUE = {'pr-merged': 'PR non mergée', 'issue-closed': 'issue non fermée', 'ci-green': 'checks non verts',
          'tests-local': 'tests à déclarer (need done --evidence)', 'report': 'rapport attendu (need done --evidence)',
          'draft-sent': 'brouillon non envoyé'}


def conditions(done_when, saisie=False):
	"""'ci-green:12,pr-merged:12' -> [('ci-green', '12'), ('pr-merged', '12')] ; Invalide hors grammaire.
	saisie : le numéro est exigé (la forme dérivée garde N vide jusqu'à `agence need pr`)."""
	out = []
	for brut in done_when.split(','):
		m = CONDITION_RE.match(brut)
		if not m or (saisie and m.group(1) and not m.group(2)):
			raise Invalide(f'--done-when : « {brut} » hors grammaire ; formes permises, séparées par une virgule : {FORMES}')
		out.append((m.group(1), m.group(2)) if m.group(1) else (m.group(3), None) if m.group(3) else (m.group(4), m.group(5)))
	return out


def done_when_defaut(valeurs):
	"""Condition de fin d'une tâche créée sans --done-when : `preuve`, sinon dérivée du mode ; N vide pour une PR."""
	preuve = valeurs['preuve'] or (['pr-mergee'] if valeurs['livraison.mode'] == 'pr' else ['rapport'])
	return ','.join(VERS_CONDITION[p] for p in preuve)


def rattacher(done_when, num):
	"""`need pr` : la PR num devient l'objet des conditions de PR ; None s'il n'y en a aucune."""
	conds = conditions(done_when)
	if not any(nom in ('pr-merged', 'ci-green') for nom, _ in conds):
		return None
	return ','.join(f'{nom}:{num}' if nom in ('pr-merged', 'ci-green') else nom if arg is None else f'{nom}:{arg}'
	                for nom, arg in conds)


def evaluer(done_when, faits, evidence=None):
	"""(fait, manques). faits : {N: {'state', 'url', 'checks'}} relevé par le tour (checks : état du rollup, None
	inconnu). Les conditions humaines (tests-local, report) et draft-sent ne sont vraies que sur une preuve déclarée."""
	manques = []
	for nom, arg in conditions(done_when):
		f = faits.get(arg) if arg else None
		if nom not in ('pr-merged', 'issue-closed', 'ci-green'):
			manque = None if evidence else MANQUE[nom]
		elif not arg:
			manque = f'{nom} sans numéro : PR non rattachée (agence need pr <besoin> <N>)'
		elif f is None:
			manque = f'#{arg} : état inconnu'
		elif nom == 'ci-green':
			manque = None if f.get('checks') == 'SUCCESS' else 'checks inconnus' if f.get('checks') is None else MANQUE[nom]
		else:
			manque = None if f.get('state') == ATTENDU[nom] else MANQUE[nom]
		if manque:
			manques.append(manque)
	return not manques, manques
