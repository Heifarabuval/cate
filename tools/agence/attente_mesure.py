#!/usr/bin/env python3
"""Mesure où part le coût en jetons d'une session orchestrateur (spec 006, lot 1).

Lit les journaux de session Claude Code d'un dossier (`~/.claude/projects/<projet>/`),
sans rien écrire, sans réseau, et rend des nombres seulement : jamais un texte de
conversation, un identifiant de session ou un chemin.

Usage : python3 -I attente_mesure.py DOSSIER [--usage-json FICHIER|-] [--days N] [--json]
  --usage-json : sortie de `cate agent usage --json` ; seuls les panneaux `claude-code`
                 sont lus, les autres comptent « non mesurés ». Sans lui : tous les journaux.
  --days N     : sans --usage-json, ignore les journaux modifiés il y a plus de N jours.

Méthode (specs/006-cout-attente-orchestrateur/mesure.md) : un tour = un message `assistant`
avec `usage`, dédoublonné par `message.id` ; jetons lus = `cache_read_input_tokens` ; cause =
le message utilisateur qui précède ; passage d'attente = le tour qui suit un appel Bash
contenant `agent wait`.
"""
import argparse
import json
import os
import re
import statistics
import sys
import time
from datetime import datetime

CAUSES = ('outil', 'stop_hook', 'agent', 'autre')
WAIT = re.compile(r'\bagent\s+wait\b')
TIMEOUT = re.compile(r'--wait-timeout[ =]+(\d+)')


class Refus(Exception):
	pass


def cause(msg):
	c = msg.get('content')
	if isinstance(c, list):
		if any(isinstance(b, dict) and b.get('type') == 'tool_result' for b in c):
			return 'outil'
		c = ''.join(b.get('text', '') for b in c if isinstance(b, dict))
	c = c.lstrip() if isinstance(c, str) else ''
	if c.startswith('Stop hook feedback'):
		return 'stop_hook'
	if c.startswith(('<task-notification>', 'Another Claude session sent')):
		return 'agent'
	return 'autre'


def instant(ts):
	try:
		return datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
	except (AttributeError, ValueError):
		return None


def lire(path, seen, acc):
	"""Ajoute à acc les tours (cause, jetons lus, passage), les appels d'attente et les durées."""
	cur, pending, waits = 'autre', False, {}
	with open(path, encoding='utf-8', errors='replace') as f:
		for line in f:
			try:
				d = json.loads(line)
			except ValueError:
				continue
			m = d.get('message') if isinstance(d, dict) else None
			if not isinstance(m, dict):
				continue
			blocs = m.get('content') if isinstance(m.get('content'), list) else []
			if d.get('type') == 'user':
				cur = cause(m)
				for b in blocs:
					t0 = waits.pop(b.get('tool_use_id'), None) if isinstance(b, dict) else None
					t1 = instant(d.get('timestamp'))
					if t0 is not None and t1 is not None:
						acc['duree_s'] += max(0, t1 - t0)
			elif d.get('type') == 'assistant':
				u, mid = m.get('usage'), m.get('id')
				if isinstance(u, dict) and mid and mid not in seen:
					seen.add(mid)
					acc['tours'].append((cur, u.get('cache_read_input_tokens') or 0, pending))
					acc['sortie'] += u.get('output_tokens') or 0
					pending = False
				for b in blocs:
					cmd = b.get('input', {}).get('command') if isinstance(b, dict) and b.get('name') == 'Bash' else None
					if isinstance(cmd, str) and WAIT.search(cmd) and b.get('id') not in acc['appels']:
						to = TIMEOUT.search(cmd)
						acc['appels'][b['id']] = to.group(1) if to else 'sans'
						waits[b['id']] = instant(d.get('timestamp'))
						pending = True


def journal(dossier, sid):
	"""Chemin du journal `sid`, ou None s'il est absent ; Refus s'il sort du dossier."""
	racine = os.path.realpath(dossier)
	path = os.path.realpath(os.path.join(racine, sid + '.jsonl'))
	if os.path.basename(sid) != sid or os.path.dirname(path) != racine:
		raise Refus('chemin hors du dossier de sessions refusé')
	return path if os.path.isfile(path) else None


def ratio(a, b):
	return round(a / b, 4) if b else None


def resume(acc, sessions):
	tours = acc['tours']
	lus = lambda ts: sum(t[1] for t in ts)
	passages = [t for t in tours if t[2]]
	hors = [t for t in tours if not t[2]]
	stop = [t for t in tours if t[0] == 'stop_hook']
	par_timeout = {}
	for to in acc['appels'].values():
		par_timeout[to] = par_timeout.get(to, 0) + 1
	duree = round(acc['duree_s'])
	moy = lambda ts: round(statistics.mean(t[1] for t in ts)) if ts else None
	med = lambda ts: statistics.median(t[1] for t in ts) if ts else None
	total = lus(tours)
	return {
		'sessions': sessions,
		'tours': len(tours),
		'jetons_lus': total,
		'jetons_sortie': acc['sortie'],
		'causes': {c: {'tours': sum(1 for t in tours if t[0] == c), 'jetons_lus': lus([t for t in tours if t[0] == c])} for c in CAUSES},
		'passages_attente': {'tours': len(passages), 'jetons_lus': lus(passages), 'moyenne': moy(passages), 'mediane': med(passages), 'part': ratio(lus(passages), total)},
		'appels_attente': {'total': len(acc['appels']), 'par_timeout': par_timeout, 'duree_s': duree, 'passages_par_10min': ratio(len(passages) * 600, duree)},
		'stop_hook': {'tours': len(stop), 'jetons_lus': lus(stop), 'part': ratio(lus(stop), total)},
		'contexte': {'mediane': med(tours), 'moyenne': moy(tours), 'hors_attente': {'tours': len(hors), 'mediane': med(hors), 'moyenne': moy(hors)}}
	}


def mesurer(dossier, panneaux=None, days=None):
	sessions = {'lues': 0, 'non_lues': 0, 'non_mesurees': 0}
	if panneaux is None:
		chemins = []
		for nom in sorted(os.listdir(dossier)):
			if nom.endswith('.jsonl'):
				p = journal(dossier, nom[:-6])
				if p and (days is None or os.stat(p).st_mtime >= time.time() - days * 86400):
					chemins.append(p)
	else:
		chemins = []
		for pan in panneaux:
			ids = pan.get('sessionIds') or []
			if pan.get('agentId') != 'claude-code':
				sessions['non_mesurees'] += len(ids)
				continue
			for sid in ids:
				p = journal(dossier, sid)
				if p:
					chemins.append(p)
				else:
					sessions['non_lues'] += 1
	acc, seen = {'tours': [], 'appels': {}, 'duree_s': 0, 'sortie': 0}, set()
	for p in chemins:
		lire(p, seen, acc)
	sessions['lues'] = len(chemins)
	return resume(acc, sessions)


def texte(d, prefixe=''):
	for k, v in d.items():
		if isinstance(v, dict):
			yield from texte(v, prefixe + k + '.')
		else:
			yield '%s%s: %s' % (prefixe, k, v)


def main(argv=None):
	ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
	ap.add_argument('dossier')
	ap.add_argument('--usage-json', metavar='FICHIER')
	ap.add_argument('--days', type=int)
	ap.add_argument('--json', action='store_true')
	a = ap.parse_args(argv)
	try:
		if not os.path.isdir(a.dossier):
			raise Refus('dossier de sessions introuvable')
		panneaux = None
		if a.usage_json:
			with (sys.stdin if a.usage_json == '-' else open(a.usage_json)) as f:
				panneaux = json.load(f)
		res = mesurer(a.dossier, panneaux, a.days)
	except Refus as e:
		print(e, file=sys.stderr)
		return 2
	if a.json:
		print(json.dumps(res, indent=1, sort_keys=True))
	else:
		if not res['sessions']['lues']:
			print('non mesuré : aucun journal claude-code lu')
		print('\n'.join(texte(res)))
	return 0


if __name__ == '__main__':
	sys.exit(main())
