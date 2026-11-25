#!/usr/bin/env python3
"""Harnais du benchmark par rejeu d'issues fermées (spec 011, lots 2, 3 et 6).

Python stdlib, sans modèle ni réseau hors `gh` en lecture et `claude -p` (comparer seulement). Ne lance aucune app, aucune fenêtre, aucune
installation de dépendances : l'humain ouvre lui-même son terminal ou son workspace dans le clone.

Usage : python3 benchmark.py [--racine R] [--specs S] [--depot D] COMMANDE
  select --graine N [--remplacer]  vivier éligible et tirage reproductible dans S/selection.json (jamais écrasé sans l'option)
  prepare ISSUE BRAS  clone neuf sans remote au commit parent dans R/ISSUE-BRAS/, énoncé R/ISSUE-BRAS.md, et copie du
                      harnais dans R/bin : seul chemin à donner à l'orchestrateur du clone pour debut, machine et fini
  debut ISSUE BRAS    ouvre le rejeu (un seul à la fois, seuil commité d'abord), horodaté en UTC
  fini ISSUE BRAS     horodate et lance l'arbitre : vert, rouge, non lançable ; le 4e rouge donne échec
  machine ISSUE BRAS  marque qu'un orchestrateur va envoyer un message ou lancer `fini` : à poser juste avant, pour que
                      ce geste ne compte pas comme du temps actif de l'humain (30 s après la marque, au plus)
  controle ISSUE BRAS contamination : appels d'outil des journaux du clone qui citent la PR d'origine ou le dépôt D
  mesure ISSUE BRAS [--usage-json F]  résultat en nombres dans S/resultats/ISSUE-BRAS.json (F : `cate agent usage --json`)
  revue               revue à l'aveugle des diffs (ordre tiré par la graine), remarques saisies au clavier
  rapport             verdict de couche 1 contre S/seuil.json commité, écrit dans S/rapport-benchmark.md ;
                      « verdict impossible » (code 2) s'il manque des issues valides dans les deux bras
  comparer --avant REF --apres REF  économie de jetons : pilotes et issue de comparaison rejoués en `claude -p`
                      avec l'outil à chaque ref ; « annuler » (code 1) si un arbitre vert avant ne l'est plus après ;
                      « verdict impossible » (code 2) si un `claude -p` sort en échec
BRAS : nu ou outil. R : ~/.cache/agence-bench ; S : specs/011-mesure-benchmark ; D : ce dépôt.
Code 2 : refus (message sur la sortie d'erreur) ou verdict impossible. Tant que la source de seuil.json dit « hypothèse »,
debut, mesure et rapport refusent : l'humain confirme les valeurs et change la source.
"""
import argparse
import hashlib
import json
import os
import random
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attente_mesure  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
BRAS = ('nu', 'outil')
TAILLES = (('pilotes', 2), ('campagne', 10), ('reserve', 5))
REPRISES = 3
LOCK = 'package-lock.json'
OUTIL = ('skills', 'tools/agence', 'CLAUDE.md')  # l'outil que `comparer` pose à chaque ref
SEUIL = ('source', 'temps_actif_max', 'jetons_max', 'non_conclusif', 'plafond_s', 'remarques_marge')
TEST = re.compile(r'(\.test\.tsx?|(^|/)test_[^/]*\.py)$')


class Refus(Exception):
	pass


def maintenant():
	return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def lire(path):
	with open(path, encoding='utf-8') as f:
		return json.load(f)


def ecrire(path, data):
	os.makedirs(os.path.dirname(path), exist_ok=True)
	with open(path, 'w', encoding='utf-8') as f:
		f.write(json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + '\n')


def gh(cwd, *args):
	r = subprocess.run(['gh', *args], cwd=cwd, capture_output=True, text=True)
	if r.returncode:
		raise Refus('gh a échoué : ' + r.stderr.strip()[:200])
	return json.loads(r.stdout)


def git(cwd, *args, **kw):
	return subprocess.run(['git', *args], cwd=cwd, capture_output=True, check=True, **kw).stdout


def taille(pr):
	return sum(f.get('additions', 0) + f.get('deletions', 0) for f in pr['files'])


def select(a):
	"""Vivier : PR mergées qui ferment une issue et touchent un test unitaire hors e2e (spec, Clarifications)."""
	if os.path.exists(os.path.join(a.specs, 'selection.json')) and not a.remplacer:
		raise Refus('selection.json existe : le tirage est figé avant le premier rejeu (--remplacer pour le refaire)')
	depot = gh(a.depot, 'repo', 'view', '--json', 'nameWithOwner')['nameWithOwner']
	prs = gh(a.depot, 'pr', 'list', '-R', depot, '--state', 'merged', '--limit', '200',
		'--json', 'number,closingIssuesReferences,files,baseRefOid,headRefOid')
	vivier, vus = [], set()
	for p in sorted(prs, key=lambda p: p['number']):
		tests = sorted(f['path'] for f in p['files'] if TEST.search(f['path']) and not f['path'].startswith('e2e/'))
		issue = p['closingIssuesReferences'][0]['number'] if p['closingIssuesReferences'] else None
		if issue and tests and issue not in vus:
			vus.add(issue)
			vivier.append({'issue': issue, 'pr': p['number'], 'base': p['baseRefOid'], 'head': p['headRefOid'],
				'tests': tests, 'taille': taille(p)})
	besoin = sum(n for _, n in TAILLES) + 1
	if len(vivier) < besoin:
		raise Refus('vivier de %d issues, il en faut %d : il en manque %d' % (len(vivier), besoin, besoin - len(vivier)))
	rng = random.Random(a.graine)
	tires = rng.sample(vivier, besoin - 1)
	sel, i = {'graine': a.graine, 'depot': depot, 'vivier': vivier}, 0
	for k, n in TAILLES:
		sel[k] = [{'issue': v['issue'], 'premier': rng.choice(BRAS)} for v in tires[i:i + n]]
		i += n
	reste = [v for v in vivier if v not in tires]
	sel['comparaison'] = {'issue': min(reste, key=lambda v: (v['taille'], v['issue']))['issue']}
	ecrire(os.path.join(a.specs, 'selection.json'), sel)
	print('vivier : %d issues ; tirées : 2 pilotes, 10 de campagne, 5 de réserve, 1 de comparaison' % len(vivier))
	return 0


def rejeu(a):
	"""(entrée du vivier, sélection) de l'issue demandée."""
	sel = lire(os.path.join(a.specs, 'selection.json'))
	v = next((v for v in sel['vivier'] if v['issue'] == a.issue), None)
	if not v:
		raise Refus('issue %d absente du vivier' % a.issue)
	return v, sel


def nom(a):
	return '%d-%s' % (a.issue, a.bras)


def etat_path(a):
	return os.path.join(a.racine, nom(a) + '.json')


def ouvert(a):
	p = os.path.join(a.racine, 'ouvert.json')
	return lire(p)['rejeu'] if os.path.exists(p) else None


def copier_node_modules(src, dst):
	cmd = ['cp', '-c', '-R'] if sys.platform == 'darwin' else ['cp', '-R', '--reflink=auto']
	subprocess.run(cmd + [src, dst], check=True, capture_output=True)


def contenu(path):
	if not os.path.isfile(path):
		return None
	with open(path, 'rb') as f:
		return f.read()


def cloner(depot, clone, base):
	"""Clone neuf sans remote au commit base ; node_modules du dépôt copiés si le lockfile est le même. Rend l'état des
	dépendances : aucune, clonées, à installer."""
	os.makedirs(clone)
	try:
		git(clone, 'init', '-q')
		git(clone, '-c', 'uploadpack.allowAnySHA1InWant=true', 'fetch', '-q', '--no-tags', '--depth', '1',
			'file://' + os.path.abspath(depot), base)
		git(clone, 'checkout', '-q', '-b', 'rejeu', base)
		os.remove(os.path.join(clone, '.git', 'FETCH_HEAD'))  # il nomme le chemin du dépôt d'origine
	except subprocess.CalledProcessError as e:
		shutil.rmtree(clone)
		raise Refus('clone impossible au commit parent : ' + e.stderr.decode(errors='replace').strip()[:200])
	lock = contenu(os.path.join(clone, LOCK))
	modules = os.path.join(depot, 'node_modules')
	if lock is None:
		return 'aucune'
	if lock == contenu(os.path.join(depot, LOCK)) and os.path.isdir(modules):
		copier_node_modules(modules, os.path.join(clone, 'node_modules'))
		return 'clonées'
	return 'à installer'


def enonce_issue(depot, nom_depot, issue):
	"""Titre et corps de l'issue, sans commentaires (FR-004)."""
	x = gh(depot, 'issue', 'view', str(issue), '-R', nom_depot, '--json', 'title,body')
	return '# %s\n\n%s\n' % (x['title'], x.get('body') or '')


def poser_harnais(a):
	"""Copie du harnais sous R/bin, avec le lien vers racine, specs et dépôt (#258). C'est le seul chemin que l'orchestrateur
	du clone reçoit pour `debut`, `machine` et `fini` : le dépôt d'origine, la sélection (sha, PR) et le checkout ne figurent
	dans aucune commande tapée, donc dans aucun appel d'outil que `controle` lit."""
	bin_ = os.path.join(a.racine, 'bin')
	os.makedirs(bin_, exist_ok=True)
	for f in ('benchmark.py', 'attente_mesure.py'):
		shutil.copy(os.path.join(HERE, f), os.path.join(bin_, f))
	ecrire(os.path.join(bin_, 'lien.json'), {'racine': a.racine, 'specs': a.specs, 'depot': a.depot})
	return os.path.join(bin_, 'benchmark.py')


def prepare(a):
	v, sel = rejeu(a)
	if ouvert(a):
		raise Refus('rejeu %s ouvert : fini avant d\'en préparer un autre' % ouvert(a))
	clone = os.path.join(a.racine, nom(a))
	if os.path.exists(clone):
		raise Refus('%s existe déjà : un rejeu part d\'un clone neuf' % clone)
	deps = cloner(a.depot, clone, v['base'])
	enonce = os.path.join(a.racine, nom(a) + '.md')
	with open(enonce, 'w', encoding='utf-8') as f:
		f.write(enonce_issue(a.depot, sel['depot'], a.issue))
	ecrire(etat_path(a), {'issue': a.issue, 'bras': a.bras, 'dependances': deps, 'debut': None, 'finis': []})
	harnais = poser_harnais(a)
	print('clone : %s\nénoncé : %s\ndépendances : %s\nharnais : python3 %s' % (clone, enonce, deps, harnais))
	if deps == 'à installer':
		print('lockfile différent de celui du dépôt : dépendances à installer par l\'humain dans le clone')
	return 0


def debut(a):
	if not os.path.exists(etat_path(a)):
		raise Refus('rejeu %s non préparé' % nom(a))
	seuil(a)
	if ouvert(a):
		raise Refus('rejeu %s déjà ouvert' % ouvert(a))
	etat = lire(etat_path(a))
	if etat['debut']:
		raise Refus('rejeu %s déjà commencé' % nom(a))
	try:  # création exclusive : deux `debut` en course, un seul prend la place
		fd = os.open(os.path.join(a.racine, 'ouvert.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
	except FileExistsError:
		raise Refus('rejeu %s déjà ouvert' % ouvert(a))
	with os.fdopen(fd, 'w', encoding='utf-8') as f:
		f.write(json.dumps({'rejeu': nom(a)}, indent=1, sort_keys=True) + '\n')
	etat['debut'] = maintenant()
	ecrire(etat_path(a), etat)
	print('début %s : %s' % (nom(a), etat['debut']))
	return 0


def arbitre(depot, clone, v):
	"""Copie les tests de la PR (à headRefOid) dans le clone, les lance seuls, les retire ; rien n'est affiché."""
	try:
		git(depot, 'cat-file', '-e', v['head'] + '^{commit}')
	except subprocess.CalledProcessError:
		raise Refus('commit de la PR %d absent du dépôt : git fetch origin pull/%d/head' % (v['pr'], v['pr']))
	tests = [t for t in v['tests'] if subprocess.run(['git', 'cat-file', '-e', '%s:%s' % (v['head'], t)],
		cwd=depot, capture_output=True).returncode == 0]
	ts = [t for t in tests if t.endswith(('.ts', '.tsx'))]
	py = [t[:-3].replace('/', '.') for t in tests if t.endswith('.py')]
	vitest = './node_modules/.bin/vitest'
	if not tests or (ts and not os.access(os.path.join(clone, vitest), os.X_OK)):
		return 'non lançable'
	avant, crees = {}, []
	try:
		for t in tests:
			p = os.path.join(clone, t)
			avant[p] = contenu(p)
			d, haut = os.path.dirname(p), None
			while not os.path.isdir(d):
				haut, d = d, os.path.dirname(d)
			if haut:
				crees.append(haut)
			os.makedirs(os.path.dirname(p), exist_ok=True)
			with open(p, 'wb') as f:
				f.write(git(depot, 'show', '%s:%s' % (v['head'], t)))
		cmds = ([[vitest, 'run', *ts]] if ts else []) + ([[sys.executable, '-m', 'unittest', *py]] if py else [])
		env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
		ok = all(subprocess.run(c, cwd=clone, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
			stdin=subprocess.DEVNULL).returncode == 0 for c in cmds)
		return 'vert' if ok else 'rouge'
	finally:
		for p, c in avant.items():
			if c is None:
				if os.path.exists(p):
					os.remove(p)
			else:
				with open(p, 'wb') as f:
					f.write(c)
		for d in crees:
			shutil.rmtree(d, ignore_errors=True)


def fini(a):
	if ouvert(a) != nom(a):
		raise Refus('rejeu %s non ouvert : debut d\'abord' % nom(a))
	v, _ = rejeu(a)
	t = maintenant()
	res = arbitre(a.depot, os.path.join(a.racine, nom(a)), v)
	etat = lire(etat_path(a))
	etat['finis'].append({'instant': t, 'arbitre': res})
	rouges = sum(1 for f in etat['finis'] if f['arbitre'] == 'rouge')
	ferme = res == 'vert' or rouges > REPRISES
	ecrire(etat_path(a), etat)
	if ferme:
		os.remove(os.path.join(a.racine, 'ouvert.json'))
	if res == 'rouge':
		print('rouge : échec après %d tours de reprise' % REPRISES if ferme else
			'rouge : reprise possible (%d sur %d)' % (rouges, REPRISES))
	else:
		print('%s (%s)' % (res, t))
	return 0 if res == 'vert' else 1


def machine(a):
	if ouvert(a) != nom(a):
		raise Refus('rejeu %s non ouvert : debut d\'abord' % nom(a))
	etat = lire(etat_path(a))
	etat.setdefault('machine', []).append(maintenant())
	ecrire(etat_path(a), etat)
	return 0


def motifs(depot, checkout, v):
	"""depot : nom GitHub ; checkout : chemin local du dépôt d'origine, qui contient la solution."""
	chemins = {os.path.abspath(checkout), os.path.realpath(checkout)}
	return [re.compile(re.escape(depot), re.I), re.compile(r'/pull/%d\b' % v['pr']),
		re.compile(r'\bgh\s+pr\b.*\b%d\b' % v['pr'], re.S), re.compile(r'\b' + re.escape(v['head'][:7]))] + [
		re.compile(re.escape(c) + r'(?![\w.-])') for c in chemins]


def contamination(chemins, depot, checkout, v):
	"""Nombre d'appels d'outil (dédoublonnés par id) qui citent le dépôt d'origine, son checkout, la PR ou son sha (FR-008)."""
	res, vus = motifs(depot, checkout, v), set()
	for p in chemins:
		for _, m, _ in attente_mesure.evenements(p):
			for b in m.get('content') if isinstance(m.get('content'), list) else []:
				if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('id') not in vus:
					s = json.dumps(b.get('input'), ensure_ascii=False)
					if any(r.search(s) for r in res):
						vus.add(b.get('id'))
	return len(vus)


def dossiers_du_clone(a):
	return dossiers_de(os.path.join(a.racine, nom(a)))


def dossiers_de(clone):
	"""Dossiers de journaux Claude Code du clone et de ses worktrees."""
	base = os.path.join(os.path.expanduser('~'), '.claude', 'projects')
	prefixe = re.sub(r'[^A-Za-z0-9]', '-', os.path.abspath(clone))
	return attente_mesure.dossiers_du_prefixe(base, prefixe) if os.path.isdir(base) else []


def controle(a):
	v, sel = rejeu(a)
	chemins = attente_mesure.journaux(dossiers_du_clone(a))
	n = contamination(chemins, sel['depot'], a.depot, v)
	print('invalide : %d appel(s) d\'outil citent la PR d\'origine' % n if n else
		'valide : aucun appel d\'outil ne cite la PR d\'origine (%d journaux lus)' % len(chemins))
	return 1 if n else 0


def premier_debut(a):
	"""Instant du premier rejeu commencé : états des rejeux sous R et résultats sous S."""
	d = os.path.join(a.specs, 'resultats')
	etats = [os.path.join(a.racine, n) for n in os.listdir(a.racine)] if os.path.isdir(a.racine) else []
	etats += [os.path.join(d, n) for n in os.listdir(d)] if os.path.isdir(d) else []
	ts = [attente_mesure.instant(lire(p).get('debut')) for p in etats if re.search(r'/\d+-(nu|outil)\.json$', p)]
	return min((t for t in ts if t is not None), default=None)


def seuil(a):
	"""(seuil, empreinte SHA-256) ; Refus si seuil.json est absent, pas commité tel quel, ou commité après le premier
	rejeu (FR-003)."""
	p = os.path.join(a.specs, 'seuil.json')
	if not os.path.isfile(p):
		raise Refus('seuil.json absent : le fixer et le commiter avant le premier rejeu')
	suivi = subprocess.run(['git', 'ls-files', '--error-unmatch', 'seuil.json'], cwd=a.specs, capture_output=True)
	modif = subprocess.run(['git', 'status', '--porcelain', '--', 'seuil.json'], cwd=a.specs, capture_output=True, text=True)
	if suivi.returncode or modif.returncode or modif.stdout.strip():
		raise Refus('seuil.json non commité : le commiter tel quel avant de rejouer, de mesurer ou de rendre un verdict')
	date = subprocess.run(['git', 'log', '-1', '--format=%ct', '--', 'seuil.json'], cwd=a.specs, capture_output=True,
		text=True).stdout.strip()
	premier = premier_debut(a)
	if premier is not None and int(date) > premier:
		raise Refus('seuil.json commité après le premier rejeu : le seuil est fixé avant (rejeux à refaire)')
	with open(p, 'rb') as f:
		octets = f.read()
	try:
		s = json.loads(octets)
	except ValueError:
		raise Refus('seuil.json illisible : JSON invalide')
	manque = [k for k in SEUIL if not isinstance(s, dict) or k not in s]
	if manque:
		raise Refus('seuil.json : clé manquante : %s' % ', '.join(sorted(manque)))
	sans_accent = ''.join(c for c in unicodedata.normalize('NFD', str(s['source']).lower()) if not unicodedata.combining(c))
	if 'hypothese' in sans_accent:
		raise Refus("seuil.json : source « %s », une hypothèse : l'humain confirme les valeurs et change la source" % s['source'])
	return s, hashlib.sha256(octets).hexdigest()


def clics(clone):
	"""Instants des notes `clic` de l'état agence du clone, tous besoins confondus (un seul rejeu ouvert à la fois)."""
	p = os.path.join(clone, '.cate', 'tmp', 'agence', 'state.json')
	st = lire(p) if os.path.isfile(p) else {}
	return st, [attente_mesure.instant(j['ts']) for n in st.get('needs', []) for j in n.get('journal', []) if j.get('by') == 'clic']


MARQUE_S = 30  # un geste annoncé par `machine` arrive dans les secondes qui suivent la marque
# ponytail: une frappe humaine dans ces 30 s compte machine ; marques consommées une à une si cela arrive


def temps_actif(evts, plafond):
	"""Σ, sur les événements humains, du délai depuis l'événement précédent (quel qu'il soit), plafonné.

	Écart assumé avec la lettre du plan (« depuis la dernière sortie du système ») : deux gestes humains de suite
	compteraient deux fois le même intervalle. À calibrer au pilote (SC-005)."""
	total, avant = 0, None
	for t, k in sorted(evts):
		if k == 'humain' and avant is not None:
			total += min(t - avant, plafond)
		avant = t
	return round(total)


def mesure(a):
	"""Résultat en nombres du rejeu dans S/resultats/ISSUE-BRAS.json (FR-005, FR-006, FR-015)."""
	s, empreinte = seuil(a)
	v, sel = rejeu(a)
	etat = lire(etat_path(a))
	clone = os.path.join(a.racine, nom(a))
	dossiers = dossiers_du_clone(a)
	panneaux = None
	if a.usage_json:
		with open(a.usage_json, encoding='utf-8') as f:
			panneaux = json.load(f)
	m = attente_mesure.mesurer(dossiers, panneaux)
	st, ts_clics = clics(clone)
	regisseur = None
	if panneaux is not None:
		reg = st.get('panels', {}).get('regisseur')
		regisseur = attente_mesure.mesurer(dossiers, [p for p in panneaux if p.get('panelId') == reg])['jetons_total']
	finis, chemins = etat['finis'], attente_mesure.journaux(dossiers)
	n = contamination(chemins, sel['depot'], a.depot, v)
	acheve = bool(etat['debut'] and finis and ouvert(a) != nom(a))
	ta = mur = humains = None
	if acheve:  # fenêtre [debut, dernier fini] : debut et chaque fini sont des gestes humains
		bornes = [attente_mesure.instant(x) for x in [etat['debut']] + [f['instant'] for f in finis]]
		marques = [attente_mesure.instant(x) for x in etat.get('machine', [])]
		evts = attente_mesure.interventions(chemins) + [(t, 'humain') for t in bornes]
		evts = [(t, 'machine' if k == 'humain' and any(0 <= t - m <= MARQUE_S for m in marques) else k) for t, k in evts]
		evts = [e for e in evts + [(t, 'humain') for t in ts_clics] if bornes[0] <= e[0] <= bornes[-1]]
		ta, mur, humains = temps_actif(evts, s['plafond_s']), round(bornes[-1] - bornes[0]), sum(1 for _, k in evts if k == 'humain')
	res = {
		'issue': a.issue, 'bras': a.bras, 'outil': outil_sha(a.depot), 'seuil': empreinte, 'debut': etat['debut'], 'finis': finis,
		'temps_actif_s': ta, 'temps_mural_s': mur, 'interventions': humains, 'reprises': max(len(finis) - 1, 0),
		'remarques': None, 'rouge_interface': None,
		'jetons': jetons(m),
		'jetons_regisseur': regisseur, 'sessions': m['sessions'], 'contamination': n,
		'etat': 'invalide' if n else 'valide' if acheve else 'inachevé'
	}
	ecrire(os.path.join(a.specs, 'resultats', nom(a) + '.json'), res)
	print('%s : %s ; temps actif %s s ; temps mural %s s ; jetons %s%s' % (nom(a), res['etat'], ta, mur,
		'inconnus' if res['jetons']['total'] is None else res['jetons']['total'], ' (partiel)' if res['jetons']['partiel'] else ''))
	return 0


def jetons(m):
	"""Jetons par poste ; aucun journal lu : inconnus (None), pas 0."""
	s = m['sessions']
	postes = {'entree': 'jetons_entree', 'cache_cree': 'jetons_cache_cree', 'lus': 'jetons_lus', 'sortie': 'jetons_sortie',
		'total': 'jetons_total'}
	j = {k: m[v] if s['lues'] else None for k, v in postes.items()}
	j['partiel'] = bool(s['non_mesurees'] or s['non_lues'] or not s['lues'])
	return j


def outil_sha(depot):
	r = subprocess.run(['git', 'rev-parse', '--short=12', 'HEAD'], cwd=depot, capture_output=True, text=True)
	return r.stdout.strip() or None


def resultats(a):
	d = os.path.join(a.specs, 'resultats')
	return {n[:-5]: lire(os.path.join(d, n)) for n in sorted(os.listdir(d)) if n.endswith('.json')} if os.path.isdir(d) else {}


def revue(a):
	"""Revue à l'aveugle : diffs des rejeux valides pas encore revus, ordre tiré par la graine, sans bras ni clone."""
	sel = lire(os.path.join(a.specs, 'selection.json'))
	base = {v['issue']: v['base'] for v in sel['vivier']}
	res = resultats(a)
	noms = [k for k, r in res.items() if r.get('etat') == 'valide' and r.get('remarques') is None
		and os.path.isdir(os.path.join(a.racine, k))]
	if not noms:
		print('aucune diff à revoir')
		return 0
	random.Random(sel['graine']).shuffle(noms)
	for i, k in enumerate(noms, 1):
		clone = os.path.join(a.racine, k)
		git(clone, 'add', '-A', '-N')  # fichiers nouveaux visibles dans le diff
		print('--- diff %d/%d ---\n%s' % (i, len(noms), git(clone, 'diff', base[res[k]['issue']]).decode(errors='replace')))
		saisie = input('remarques (nombre) : ').strip()
		if not saisie.isdigit():
			raise Refus('remarques : un nombre entier attendu, %r refusé' % saisie[:20])
		r = dict(res[k], remarques=int(saisie),
			rouge_interface=input('rouge par interface (o/n) : ').strip().lower().startswith('o'))
		ecrire(os.path.join(a.specs, 'resultats', k + '.json'), r)
	return 0


def nombre(x):
	return ('%.2f' % x).replace('.', ',')


def mediane(xs):
	xs = [x for x in xs if x is not None]
	return statistics.median(xs) if xs else None


def rapport(a):
	"""Agrège les résultats de campagne et de réserve, rend le verdict contre le seuil (FR-009, FR-010)."""
	s, empreinte = seuil(a)
	sel = lire(os.path.join(a.specs, 'selection.json'))
	res = resultats(a)
	if any(r.get('seuil') != empreinte for r in res.values()):
		raise Refus('empreinte du seuil différente de celle des résultats : seuil.json a changé après le premier rejeu')
	groupes = {k: [t['issue'] for t in sel[k]] for k in ('campagne', 'reserve')}
	rejeux = [res[k] for k in ('%d-%s' % (i, b) for g in groupes.values() for i in g for b in BRAS) if k in res]
	issues = [i for g in groupes.values() for i in g if all(res.get('%d-%s' % (i, b), {}).get('etat') == 'valide' for b in BRAS)]
	if not issues:
		raise Refus('aucune issue jouée et valide dans les deux bras')
	r = {(i, b): res['%d-%s' % (i, b)] for i in issues for b in BRAS}
	premier = lambda x: x['finis'][0]['arbitre'] if x['finis'] else '-'
	bras = {}
	for b in BRAS:
		xs = [r[i, b] for i in issues]
		rem = [x['remarques'] for x in xs]
		bras[b] = {'ta': mediane(x['temps_actif_s'] for x in xs), 'mur': mediane(x['temps_mural_s'] for x in xs),
			'verts': sum(1 for x in xs if premier(x) == 'vert'), 'reprises': sum(x['reprises'] for x in xs),
			'remarques': None if None in rem else sum(rem), 'jetons': mediane(x['jetons']['total'] for x in xs)}
	ratio = lambda k: mediane(r[i, 'outil'][k] / r[i, 'nu'][k] if r[i, 'nu'][k] else None for i in issues)
	ta, mur = ratio('temps_actif_s'), ratio('temps_mural_s')
	jet = mediane(r[i, 'outil']['jetons']['total'] / r[i, 'nu']['jetons']['total']
		if r[i, 'nu']['jetons']['total'] and r[i, 'outil']['jetons']['total'] is not None else None for i in issues)
	partiels = sum(1 for x in r.values() if x['jetons']['partiel'])
	nu, ou = bras['nu'], bras['outil']
	qualite = ou['verts'] >= nu['verts'] and ou['reprises'] <= nu['reprises'] and (
		nu['remarques'] is None or ou['remarques'] is None or ou['remarques'] <= nu['remarques'] * (1 + s['remarques_marge']))
	bas, haut = s['non_conclusif']
	manque = [nom for nom, ok in (('temps actif', ta is not None and ta <= s['temps_actif_max']), ('qualité', qualite),
		('jetons', jet is not None and jet <= s['jetons_max'])) if not ok]
	zone = ta is not None and bas <= ta <= haut and not any(i in issues for i in groupes['reserve'])
	# 10 issues de campagne, 15 dès que la réserve est entamée (spec, Clarifications)
	entamee = any('%d-%s' % (i, b) in res for i in groupes['reserve'] for b in BRAS)
	requis = len(groupes['campagne']) + (len(groupes['reserve']) if entamee else 0)
	if len(issues) < requis:
		verdict = 'verdict impossible (%d issue%s valide%s dans les deux bras, il en faut %d)' % (
			len(issues), *(('s', 's') if len(issues) > 1 else ('', '')), requis)
	elif zone and manque in ([], ['temps actif']):  # sur 10 issues seulement : la réserve tranche (spec, Clarifications)
		verdict = 'non conclusif (temps actif %s dans la zone %s à %s) : rejouer les %d issues de réserve' % (
			nombre(ta), nombre(bas), nombre(haut), len(groupes['reserve']))
	else:
		verdict = 'ne passe pas (%s)' % ', '.join(manque) if manque else 'passe'
	reg = [x.get('jetons_regisseur') for x in r.values()]
	reg_txt = ('non attribués sur %d rejeux (sans --usage-json)' % reg.count(None) if None in reg else
		'%d (attendu 0, 009 SC-006)' % sum(reg) if sum(reg) else '0')
	ent = lambda v: '-' if v is None else '%d' % v
	lignes = [
		'# Rapport du benchmark (spec 011)', '',
		'Seuil : empreinte %s ; temps actif ≤ %s, jetons ≤ %s, zone non conclusive %s à %s, plafond %d s.' % (
			empreinte[:12], nombre(s['temps_actif_max']), nombre(s['jetons_max']), nombre(bas), nombre(haut), s['plafond_s']),
		'Issues comptées : %d (campagne %d sur %d, réserve %d sur %d). Rejeux invalidés : %d. Inachevés : %d. Jetons partiels : %d.' % (
			len(issues), sum(1 for i in issues if i in groupes['campagne']), len(groupes['campagne']),
			sum(1 for i in issues if i in groupes['reserve']), len(groupes['reserve']),
			sum(1 for x in rejeux if x['etat'] == 'invalide'), sum(1 for x in rejeux if x['etat'] == 'inachevé'), partiels), '',
		'| Issue | Bras | Temps actif (s) | Temps mural (s) | Arbitre au 1er fini | Reprises | Remarques | Jetons |',
		'|---|---|---|---|---|---|---|---|'
	] + ['| %d | %s | %s | %s | %s | %d | %s | %s |' % (i, b, ent(x['temps_actif_s']), ent(x['temps_mural_s']), premier(x),
		x['reprises'], ent(x['remarques']), ent(x['jetons']['total'])) for (i, b), x in r.items()] + [
		'', '| Bras | Temps actif médian (s) | Temps mural médian (s) | Verts au 1er fini | Reprises | Remarques | Jetons médians |',
		'|---|---|---|---|---|---|---|'
	] + ['| %s | %s | %s | %d | %d | %s | %s |' % (b, ent(x['ta']), ent(x['mur']), x['verts'], x['reprises'], ent(x['remarques']),
		ent(x['jetons'])) for b, x in bras.items()] + [
		'', 'Rapports médians outil / nu : temps actif %s ; jetons %s%s ; temps mural %s (rapporté, non bloquant).' % (
			nombre(ta) if ta is not None else '-', nombre(jet) if jet is not None else '-', ' (partiel)' if partiels else '',
			nombre(mur) if mur is not None else '-'),
		'Qualité : arbitres verts au 1er fini, tours de reprise, remarques de revue%s.' % (
			'' if None not in (nu['remarques'], ou['remarques']) else ' (revue à l\'aveugle incomplète : jugée sur les deux premiers)'),
		'Rouge par interface : %d.' % sum(1 for x in r.values() if x.get('rouge_interface')),
		'Jetons du régisseur et des détections déterministes : %s.' % reg_txt, '',
		'## Verdict', '', 'Couche 1 : %s.' % verdict, '',
		'## Limites', '',
		'- L\'humain joue les deux bras et connaît une partie des solutions d\'origine : biais commun aux deux bras.',
		'- Bugs après merge non mesurés : rien n\'est mergé dans un rejeu.',
		'- Version de l\'outil : %s.' % ', '.join(sorted({str(x.get('outil')) for x in r.values()}))
	]
	texte = '\n'.join(lignes) + '\n'
	with open(os.path.join(a.specs, 'rapport-benchmark.md'), 'w', encoding='utf-8') as f:
		f.write(texte)
	sys.stdout.write(texte)
	return 2 if verdict.startswith('verdict impossible') else 0


def poser_outil(depot, ref, clone):
	"""Skills et briefs du dépôt à `ref` posés sur le clone, par-dessus le commit de l'issue.
	ponytail: recouvre aussi ce que l'issue touche sous ces chemins ; pareil des deux côtés, la comparaison reste juste."""
	chemins = [c for c in OUTIL if subprocess.run(['git', 'cat-file', '-e', '%s:%s' % (ref, c)], cwd=depot,
		capture_output=True).returncode == 0]
	if chemins:
		tar = git(depot, 'archive', ref, '--', *chemins)
		subprocess.run(['tar', '-x', '-C', clone], input=tar, check=True, capture_output=True)


def comparer(a):
	"""Économie de jetons (FR-011) : le sous-ensemble figé (pilotes et issue de comparaison, jamais la campagne) rejoué
	en `claude -p` avec l'outil à --avant puis à --apres, même arbitre, même mesure ; « annuler » (code 1) dès qu'un
	arbitre vert avant ne l'est plus après ; « verdict impossible » (code 2) dès qu'un `claude -p` sort en échec, le
	rejeu s'arrête là. Rapport en nombres dans S/comparaisons/<date>-<apres>.md."""
	sel = lire(os.path.join(a.specs, 'selection.json'))
	refs = {}
	for cote in ('avant', 'apres'):
		r = subprocess.run(['git', 'rev-parse', '--verify', '-q', getattr(a, cote) + '^{commit}'], cwd=a.depot,
			capture_output=True, text=True)
		if r.returncode:
			raise Refus('ref inconnue : %s' % getattr(a, cote))
		refs[cote] = r.stdout.strip()
	vivier = {v['issue']: v for v in sel['vivier']}
	issues = [t['issue'] for t in sel['pilotes']] + [sel['comparaison']['issue']]
	os.makedirs(a.racine, exist_ok=True)
	base, res, echec = tempfile.mkdtemp(dir=a.racine, prefix='comparer-'), {}, None
	try:
		for i in issues:
			if echec:
				break
			enonce = enonce_issue(a.depot, sel['depot'], i)
			for cote, ref in refs.items():
				clone = os.path.join(base, '%d-%s' % (i, cote))
				cloner(a.depot, clone, vivier[i]['base'])
				poser_outil(a.depot, ref, clone)
				try:  # aucune interface : -p, sortie JSON, rien sur le terminal
					code = subprocess.run(['claude', '-p', enonce, '--output-format', 'json', '--permission-mode', 'acceptEdits'],
						cwd=clone, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
				except FileNotFoundError:
					raise Refus('claude introuvable sur le PATH')
				if code:  # un rejeu coupé ne compte pas, même si l'arbitre passe par hasard
					echec = 'claude -p a rendu le code %d sur l\'issue %d (%s)' % (code, i, cote)
					break
				res[i, cote] = (arbitre(a.depot, clone, vivier[i]), jetons(attente_mesure.mesurer(dossiers_de(clone)))['total'])
	finally:
		shutil.rmtree(base, ignore_errors=True)
	issues = [i for i in issues if (i, 'avant') in res and (i, 'apres') in res]  # rejeux complets seulement
	casse = [i for i in issues if res[i, 'avant'][0] == 'vert' and res[i, 'apres'][0] != 'vert']
	somme = lambda cote: None if any(res[i, cote][1] is None for i in issues) else sum(res[i, cote][1] for i in issues)
	ent = lambda v: 'inconnus' if v is None else '%d' % v
	verdict = ('verdict impossible : %s' % echec if echec else
		'annuler : arbitre vert avant, pas après, sur %s' % ', '.join(map(str, casse)) if casse else
		'garder : aucun arbitre vert avant ne casse après')
	texte = '\n'.join([
		'# Comparaison avant / après (spec 011, FR-011)', '',
		'Avant : %s. Après : %s.' % (refs['avant'][:12], refs['apres'][:12]), '',
		'| Issue | Arbitre avant | Arbitre après | Jetons avant | Jetons après |', '|---|---|---|---|---|'
	] + ['| %d | %s | %s | %s | %s |' % (i, res[i, 'avant'][0], res[i, 'apres'][0], ent(res[i, 'avant'][1]),
		ent(res[i, 'apres'][1])) for i in issues] + [
		'', 'Jetons : avant %s, après %s.' % (ent(somme('avant')), ent(somme('apres'))), '', 'Verdict : %s.' % verdict
	]) + '\n'
	racine, n = os.path.join(a.specs, 'comparaisons', '%s-%s' % (maintenant()[:10], refs['apres'][:12])), 1
	os.makedirs(os.path.dirname(racine), exist_ok=True)
	while True:  # même date, même ref : suffixe, jamais d'écrasement
		rapport = racine + ('-%d' % n if n > 1 else '') + '.md'
		try:
			with open(rapport, 'x', encoding='utf-8') as f:
				f.write(texte)
			break
		except FileExistsError:
			n += 1
	sys.stdout.write(texte + 'rapport : %s\n' % rapport)
	return 2 if echec else 1 if casse else 0


def main(argv=None):
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	lien = os.path.join(HERE, 'lien.json')  # présent seulement dans la copie de R/bin : ses chemins remplacent les défauts
	lien = lire(lien) if os.path.isfile(lien) else {}
	ap.add_argument('--racine', default=lien.get('racine') or os.path.join(os.path.expanduser('~'), '.cache', 'agence-bench'))
	ap.add_argument('--specs', default=lien.get('specs') or os.path.join(ROOT, 'specs', '011-mesure-benchmark'))
	ap.add_argument('--depot', default=lien.get('depot') or ROOT)
	sub = ap.add_subparsers(dest='cmd', required=True)
	p = sub.add_parser('select')
	p.add_argument('--graine', type=int, required=True)
	p.add_argument('--remplacer', action='store_true')
	for c in ('prepare', 'debut', 'fini', 'machine', 'controle', 'mesure'):
		p = sub.add_parser(c)
		p.add_argument('issue', type=int)
		p.add_argument('bras', choices=BRAS)
	p.add_argument('--usage-json', metavar='FICHIER')
	p = sub.add_parser('comparer')
	p.add_argument('--avant', required=True, metavar='REF')
	p.add_argument('--apres', required=True, metavar='REF')
	sub.add_parser('revue')
	sub.add_parser('rapport')
	a = ap.parse_args(argv)
	try:
		return {'select': select, 'prepare': prepare, 'debut': debut, 'fini': fini, 'machine': machine, 'controle': controle, 'mesure': mesure,
			'revue': revue, 'rapport': rapport, 'comparer': comparer}[a.cmd](a)
	except Refus as e:
		print(e, file=sys.stderr)
		return 2


if __name__ == '__main__':
	sys.exit(main())
