#!/usr/bin/env python3
"""Harnais du benchmark par rejeu d'issues fermées (spec 011, lot 2).

Python stdlib, sans modèle ni réseau hors `gh` en lecture. Ne lance aucune app, aucune fenêtre, aucune
installation de dépendances : l'humain ouvre lui-même son terminal ou son workspace dans le clone.

Usage : python3 benchmark.py [--racine R] [--specs S] [--depot D] COMMANDE
  select --graine N   vivier éligible et tirage reproductible dans S/selection.json
  prepare ISSUE BRAS  clone neuf sans remote au commit parent dans R/ISSUE-BRAS/, énoncé R/ISSUE-BRAS.md
  debut ISSUE BRAS    ouvre le rejeu (un seul à la fois), horodaté en UTC
  fini ISSUE BRAS     horodate et lance l'arbitre : vert, rouge, non lançable ; le 4e rouge donne échec
  controle ISSUE BRAS contamination : appels d'outil des journaux du clone qui citent la PR d'origine
BRAS : nu ou outil. R : ~/.cache/agence-bench ; S : specs/011-mesure-benchmark ; D : ce dépôt.
"""
import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import attente_mesure  # noqa: E402

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
BRAS = ('nu', 'outil')
TAILLES = (('pilotes', 2), ('campagne', 10), ('reserve', 5))
REPRISES = 3
LOCK = 'package-lock.json'
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


def prepare(a):
	v, sel = rejeu(a)
	if ouvert(a):
		raise Refus('rejeu %s ouvert : fini avant d\'en préparer un autre' % ouvert(a))
	clone = os.path.join(a.racine, nom(a))
	if os.path.exists(clone):
		raise Refus('%s existe déjà : un rejeu part d\'un clone neuf' % clone)
	os.makedirs(clone)
	try:
		git(clone, 'init', '-q')
		git(clone, '-c', 'uploadpack.allowAnySHA1InWant=true', 'fetch', '-q', '--no-tags', '--depth', '1',
			'file://' + os.path.abspath(a.depot), v['base'])
		git(clone, 'checkout', '-q', '-b', 'rejeu', v['base'])
	except subprocess.CalledProcessError as e:
		shutil.rmtree(clone)
		raise Refus('clone impossible au commit parent : ' + e.stderr.decode(errors='replace').strip()[:200])
	lock = contenu(os.path.join(clone, LOCK))
	modules = os.path.join(a.depot, 'node_modules')
	if lock is None:
		deps = 'aucune'
	elif lock == contenu(os.path.join(a.depot, LOCK)) and os.path.isdir(modules):
		copier_node_modules(modules, os.path.join(clone, 'node_modules'))
		deps = 'clonées'
	else:
		deps = 'à installer'
	issue = gh(a.depot, 'issue', 'view', str(a.issue), '-R', sel['depot'], '--json', 'title,body')
	enonce = os.path.join(a.racine, nom(a) + '.md')
	with open(enonce, 'w', encoding='utf-8') as f:
		f.write('# %s\n\n%s\n' % (issue['title'], issue.get('body') or ''))
	ecrire(etat_path(a), {'issue': a.issue, 'bras': a.bras, 'dependances': deps, 'debut': None, 'finis': []})
	print('clone : %s\nénoncé : %s\ndépendances : %s' % (clone, enonce, deps))
	if deps == 'à installer':
		print('lockfile différent de celui du dépôt : dépendances à installer par l\'humain dans le clone')
	return 0


def debut(a):
	if not os.path.exists(etat_path(a)):
		raise Refus('rejeu %s non préparé' % nom(a))
	if ouvert(a):
		raise Refus('rejeu %s déjà ouvert' % ouvert(a))
	etat = lire(etat_path(a))
	if etat['debut']:
		raise Refus('rejeu %s déjà commencé' % nom(a))
	etat['debut'] = maintenant()
	ecrire(etat_path(a), etat)
	ecrire(os.path.join(a.racine, 'ouvert.json'), {'rejeu': nom(a)})
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


def motifs(depot, v):
	return [re.compile(re.escape(depot), re.I), re.compile(r'/pull/%d\b' % v['pr']),
		re.compile(r'\bgh\s+pr\b.*\b%d\b' % v['pr'], re.S), re.compile(r'\b' + re.escape(v['head'][:7]))]


def contamination(chemins, depot, v):
	"""Nombre d'appels d'outil (dédoublonnés par id) qui citent le dépôt d'origine, la PR ou son sha (FR-008)."""
	res, vus = motifs(depot, v), set()
	for p in chemins:
		for _, m, _ in attente_mesure.evenements(p):
			for b in m.get('content') if isinstance(m.get('content'), list) else []:
				if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('id') not in vus:
					s = json.dumps(b.get('input'), ensure_ascii=False)
					if any(r.search(s) for r in res):
						vus.add(b.get('id'))
	return len(vus)


def controle(a):
	v, sel = rejeu(a)
	base = os.path.join(os.path.expanduser('~'), '.claude', 'projects')
	prefixe = re.sub(r'[^A-Za-z0-9]', '-', os.path.join(os.path.abspath(a.racine), nom(a)))
	dossiers = attente_mesure.dossiers_du_prefixe(base, prefixe) if os.path.isdir(base) else []
	chemins = attente_mesure.journaux(dossiers)
	n = contamination(chemins, sel['depot'], v)
	print('invalide : %d appel(s) d\'outil citent la PR d\'origine' % n if n else
		'valide : aucun appel d\'outil ne cite la PR d\'origine (%d journaux lus)' % len(chemins))
	return 1 if n else 0


def main(argv=None):
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('--racine', default=os.path.join(os.path.expanduser('~'), '.cache', 'agence-bench'))
	ap.add_argument('--specs', default=os.path.join(ROOT, 'specs', '011-mesure-benchmark'))
	ap.add_argument('--depot', default=ROOT)
	sub = ap.add_subparsers(dest='cmd', required=True)
	sub.add_parser('select').add_argument('--graine', type=int, required=True)
	for c in ('prepare', 'debut', 'fini', 'controle'):
		p = sub.add_parser(c)
		p.add_argument('issue', type=int)
		p.add_argument('bras', choices=BRAS)
	a = ap.parse_args(argv)
	try:
		return {'select': select, 'prepare': prepare, 'debut': debut, 'fini': fini, 'controle': controle}[a.cmd](a)
	except Refus as e:
		print(e, file=sys.stderr)
		return 2


if __name__ == '__main__':
	sys.exit(main())
