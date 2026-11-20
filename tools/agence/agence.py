#!/usr/bin/env python3
"""agence : l'univers d'un projet orchestré sur le canvas Cate.

Seule cette CLI écrit l'état <repo>/.cate/tmp/agence/state.json (verrou fcntl,
écriture atomique). L'humain qui valide s'appelle `agence nom` : AGENCE_NOM, sinon
la clé gitconfig agence.nom, sinon le premier mot de user.name, sinon « L'humain ».

  agence start [--no-notify] [--max-agents N]  canvas « Agence : <repo> » + orchestrateur (idempotent) ; --no-notify coupe les notifications système du projet ; --max-agents règle le plafond d'agents vivants (défaut 4)
  agence boot [--from ID]            par l'orchestrateur : régisseur + page de suivi, reliés
  agence need add|panel|done|drop|list   add --model <id> --effort <niveau> : réglages voulus, passés par l'orchestrateur à cate agent start ; le suivi montre ceux que cate agent list rend
  agence need log ID "<décision>"    journal daté du besoin ; need show ID le rend, boot rend celui des besoins ouverts
  agence draft new|edit|show|sent|drop  brouillons ; seul le bouton Envoyer de la page valide
  agence ask "question" --option "label|effet"... [--merge owner/repo#N]
  agence watch                       régisseur : boucle de suivi + pages (127.0.0.1:<port>)
  agence doctor [--relance]          peut-on relancer Cate sans rien perdre ? oui ou non en première ligne, puis les raisons (lecture seule ; code 0 oui, 1 non)
  agence doctor --prerequis [--hors-cate] [--json] ce qui manque pour orchestrer, une ligne par point avec la commande qui règle (code 1 si un bloquant manque)
  agence guard [--mode send|pages]   hook PreToolUse (JSON sur stdin) ; send échoue fermé (ask), pages échoue ouvert
  agence hooks install|uninstall|status [--settings F] [--json]   gardes dans ~/.claude/settings.json (sur commande de l'humain)
  agence url                         adresse de la page de suivi
  agence nom                         nom de l'humain et sa source

Codes : 0 ok, 1 refus métier, 2 environnement.
"""
import argparse
import contextlib
import fcntl
import glob
import hashlib
import html
import http.client
import http.server
import json
import math
import os
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

MAX_AGENTS = 4  # plafond par défaut d'agents vivants (en plein tour ou en attente) ; agence start --max-agents le change pour le projet
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')  # ceux que cate agent start --effort déclare
KINDS = ('task', 'cmd', 'pr', 'issue', 'file', 'draft', 'human')
CIBLE_RE = re.compile(r'^(slack:[A-Z0-9]+|mail:[^@\s]+@[^@\s]+|issue:[\w.-]+/[\w.-]+'
                      r'|pr:[\w.-]+/[\w.-]+:[\w./-]+:[\w./-]+|comment:[\w.-]+/[\w.-]+#\d+)$')
ORCH_PROMPT = '/orchestrateur'
CSS = 'https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css'
PAGES = True  # faux sous --token-stdin : le panneau agence de Cate tient l'interface, plus aucune page ni jeton dans un corps
TOKEN = secrets.token_urlsafe(18)  # jeton des formulaires, en mémoire du régisseur seulement


class Refus(Exception):
	code = 1


class Incertain(Refus):
	"""Issue inconnue d'un envoi : le message est peut-être parti, ne jamais renvoyer sans confirmation."""


class Env(Exception):
	code = 2


def _run(cmd, input=None, timeout=120):
	try:
		p = subprocess.run(cmd, input=input, capture_output=True, text=True, timeout=timeout)
	except (OSError, subprocess.TimeoutExpired) as e:
		return 127, '', str(e)
	return p.returncode, p.stdout, p.stderr


RUN = _run
# ponytail: valeur stockée de owner, lue telle quelle par le panneau (src/panels/agence/contract/suivi.ts) ;
# jamais affichée. Passe à 'humain' avec le panneau (spec 006, L2-05 et L2-15).
OWNER_HUMAIN = 'heifara'


def _propre(v):
	"""Nom d'humain : une ligne, sans caractère de contrôle, espaces réduits, 40 caractères au plus.
	Le gitconfig agence.nom est commun aux worktrees (un agent peut l'écrire) et le nom part dans les notify."""
	return ' '.join(re.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', v).split())[:40].strip()


def nom_source():
	"""(nom de l'humain, source), relu à chaque appel : AGENCE_NOM > gitconfig agence.nom > premier mot de user.name > « L'humain ».
	Une valeur vide après nettoyage passe à la source suivante. Par _run, pas RUN : c'est de la configuration,
	pas une commande que les tests simulent."""
	v = _propre(os.environ.get('AGENCE_NOM', ''))
	if v:
		return v, 'AGENCE_NOM'
	for key in ('agence.nom', 'user.name'):
		code, out, _ = _run(['git', 'config', '--get', key], timeout=5)
		v = _propre(out if key == 'agence.nom' else (_propre(out).split() or [''])[0]) if code == 0 else ''
		if v:
			return v, f'git {key}'
	return "L'humain", 'défaut'


def nom():
	return nom_source()[0]


def qui(n):
	"""owner tel que la CLI l'écrit et le lit : « humain » pour la valeur stockée OWNER_HUMAIN."""
	return 'humain' if n['owner'] == OWNER_HUMAIN else n['owner']


def now_iso():
	return datetime.now(timezone.utc).isoformat(timespec='seconds')


def sha(text):
	return hashlib.sha256(text.encode()).hexdigest()


# ---------- état ----------

def root():
	r = os.environ.get('AGENCE_ROOT')
	if r:
		return r
	return main_repo(os.getcwd()) or os.getcwd()


def main_repo(path):
	"""Racine du dépôt principal, même depuis un worktree (l'état est partagé par tous les agents)."""
	code, out, _ = RUN(['git', '-C', path, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
	d = out.strip()
	return os.path.dirname(d) if code == 0 and d.startswith('/') and os.path.basename(d) == '.git' else None


def state_file(base=None):
	return os.path.join(base or root(), '.cate', 'tmp', 'agence', 'state.json')


def adir(base=None):
	d = os.path.dirname(state_file(base))
	os.makedirs(os.path.join(d, 'drafts'), exist_ok=True)
	return d


def draft_path(did):
	return os.path.join(adir(), 'drafts', f'{did}.md')


def empty():
	return {'repo': os.path.basename(root()), 'ghRepo': None, 'panels': {}, 'port': None, 'seq': 0,
	        'needs': [], 'drafts': [], 'questions': [], 'notified': [], 'agentsActive': 0, 'agentsWaiting': 0, 'titles': {}, 'notify': True,
	        'orphanVus': {}, 'orphanGardes': [], 'humain': "L'humain", 'garde': None}


def plafond(st):
	return st.get('maxAgents', MAX_AGENTS)  # clé absente d'un état ancien : plafond par défaut


def load(path=None):
	try:
		with open(path or state_file()) as f:
			st = json.load(f)
	except FileNotFoundError:
		return empty()
	for k, v in empty().items():
		st.setdefault(k, v)
	return st


@contextlib.contextmanager
def tx(base=None):
	"""Lit l'état sous verrou ; l'écrit seulement si le bloc finit sans exception.
	Les effets de apply() (cate, git) sont joués après, verrou libre : un cate lent ne bloque ni clics ni régisseur."""
	d = adir(base)
	with open(os.path.join(d, '.lock'), 'w') as lock:
		fcntl.flock(lock, fcntl.LOCK_EX)
		st = load(state_file(base))
		yield st
		after = st.pop('_after', [])
		dump(st, base)
	if after:
		run_after(after, base)


def dump(st, base=None):
	"""Écrit l'état (atomique). Appelé sous verrou ; tx le fait à la sortie, un clic peut le faire avant un appel externe."""
	fd, tmp = tempfile.mkstemp(dir=adir(base), prefix='tmp-state-')
	with os.fdopen(fd, 'w') as f:
		json.dump({k: v for k, v in st.items() if k != '_after'}, f, ensure_ascii=False, indent=1)
	os.replace(tmp, state_file(base))


def new_id(st, prefix):
	st['seq'] += 1
	return f"{prefix}{st['seq']}"


def find(st, coll, oid):
	for x in st[coll]:
		if x['id'] == oid:
			return x
	raise Refus(f'{oid} introuvable dans {coll}')


def add_need(st, kind, title, ref=None, owner='agent', blocking=False, unblocks=None, source=None,
             panels=(), done_when=None, acceptance=None, budget=None, model=None, effort=None, budget_usd=None):
	"""Ajoute un besoin ; un besoin ouvert de même (kind, ref) est rendu tel quel (FR-006)."""
	if kind not in KINDS:
		raise Refus(f'kind inconnu : {kind} ({", ".join(KINDS)})')
	ref = None if ref is None else str(ref)
	if ref is not None:
		for n in st['needs']:
			if n['status'] == 'open' and n['kind'] == kind and n['ref'] == ref:
				n['panels'] += [p for p in panels if p not in n['panels']]
				return n, False
	n = {'id': new_id(st, 'n'), 'kind': kind, 'title': title, 'ref': ref, 'owner': owner, 'blocking': blocking,
	     'unblocks': unblocks, 'source': source, 'panels': list(panels), 'doneWhen': done_when,
	     'acceptance': acceptance, 'budgetMin': budget, 'budgetUsd': budget_usd, 'model': model, 'effort': effort, 'evidence': None, 'status': 'open',
	     'closeFailed': False, 'agentBlocked': False, 'overBudget': False,
	     'created': now_iso(), 'createdTs': time.time(), 'updated': now_iso()}
	st['needs'].append(n)
	return n, True


def note(n, text, by):
	"""Ligne datée au journal d'un besoin (by : 'clic' écrit par la CLI sur un clic de l'humain, 'cli' dit par un agent).
	Les états écrits avant ce champ n'en ont pas : toujours lire par n.get('journal', [])."""
	text = ' '.join(text.split())  # une ligne, sans tabulation : un texte d'agent ne forge pas une ligne « clic »
	n.setdefault('journal', []).append({'ts': now_iso(), 'by': by, 'text': text})


def cout_valide(c):
	return isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c) and c >= 0


def cout_besoin(n):
	"""Dépense cumulée des panneaux du besoin (dollars), None tant qu'aucun coût n'a été lu."""
	lus = [c for c in (n.get('costByPanel') or {}).values() if c is not None]
	return sum(lus) if lus else None


def cout_projet(st):
	"""(total, partiel) des panneaux de tous les besoins : maximum lu par panneau, un panneau partagé n'étant compté qu'une fois."""
	par_panneau = {}
	for n in st['needs']:
		for p, c in (n.get('costByPanel') or {}).items():
			if c is not None or p not in par_panneau:
				par_panneau[p] = c if c is None else max(c, par_panneau.get(p) or 0)
	lus = [c for c in par_panneau.values() if c is not None]
	return (sum(lus) if lus else None), len(lus) < len(par_panneau)


def cout_texte(total, partiel):
	return ('au moins ' if partiel else '') + dollars(total)


def dollars(c):
	return f'{c:.2f}'.replace('.', ',') + ' $'


def need_text(n):
	"""Besoin et son journal, une ligne chacun."""
	head = f"{n['id']}\t{n['status']}\t{n['kind']}\t{qui(n)}\t{n['title']}"
	voulu = ' '.join(f'--{k} {n[k]}' for k in ('model', 'effort') if n.get(k))  # à passer à cate agent start
	return '\n'.join([head] + ([f'\tréglages : {voulu}'] if voulu else []) + [f"\t{j['ts']}\t{j['by']}\t{j['text']}" for j in n.get('journal', [])])


def close_need(st, nid, status, evidence=None):
	n = find(st, 'needs', nid)
	if n['status'] != 'open':
		raise Refus(f"{nid} est déjà {n['status']}")
	if status == 'done' and not (evidence or n['evidence']):
		raise Refus('preuve requise pour passer en fait : --evidence (sortie de test, lien, SHA)')
	n.update(status=status, evidence=evidence or n['evidence'], updated=now_iso())
	return n


# ---------- cate et gh ----------

def require_cate():
	if not os.environ.get('CATE_SOCKET'):
		raise Env('à lancer depuis un terminal Cate (CATE_SOCKET absent)')


def cate(*args, timeout=120):
	code, out, err = RUN(['cate', *map(str, args), '--json'], timeout=timeout)
	if code != 0:
		raise Refus(f"cate {' '.join(map(str, args[:2]))} : {(err or out).strip()}")
	out = out.strip()
	try:
		return json.loads(out) if out else {}
	except ValueError:  # sortie non JSON : un refus comme les autres, que le tour du régisseur attrape
		raise Refus(f"cate {' '.join(map(str, args[:2]))} : sortie illisible")


def live_rows():
	"""Panneaux vivants par id ; None si la réponse est illisible (le régisseur saute alors son tour)."""
	rows = cate('panel', 'list')
	if not isinstance(rows, list) or not all(isinstance(r, dict) and 'panelId' in r for r in rows):
		return None
	return {r['panelId']: r for r in rows}


def sous_panneau_agence(st):
	"""Vrai si l'orchestrateur du projet est un panneau agence : il affiche lui-même brouillons et questions (q20)."""
	rows = live_rows()  # ponytail: un cate panel list par draft ou ask ; cache dans le régisseur si on en crée des dizaines par minute
	return bool(rows) and (rows.get(st['panels'].get('orchestrator')) or {}).get('type') == 'agence'


def caller_panel():
	"""Panneau du terminal qui appelle la CLI : cate ne le donne pas, on le trouve en le renommant une seconde, puis on rétablit."""
	with contextlib.suppress(Refus):
		rows = live_rows() or {}
		pid = (cate('panel', 'title', f'agence-{secrets.token_hex(4)}') or {}).get('panelId')
		if pid in rows:
			title(pid, rows[pid].get('title') or '')
		return pid if pid in rows else None


def caller_is_orchestrator():
	me = caller_panel()  # None (sonde en échec) ou orchestrateur absent ne prouvent rien
	return me is not None and me == load()['panels'].get('orchestrator')


def launch(n, panels):
	"""Panneaux enregistrés comme lancés pour ce besoin par l'orchestrateur : les seuls qu'on force à la fermeture."""
	n['launched'] = n.get('launched', []) + [p for p in panels if p in n['panels'] and p not in n.get('launched', [])]


def title(panel, text):
	with contextlib.suppress(Refus):
		cate('panel', 'title', '--panel', panel, text)


def link(frm, to, kind='context', label=None):
	if not frm or not to:
		return
	args = ['panel', 'link', frm, to, '--kind', kind] + (['--label', label] if label else [])
	try:
		cate(*args)
	except Refus as e:
		log(f'lien {frm} -> {to} refusé : {e}')


def notify(panel, msg):
	if not panel:
		return
	try:
		cate('agent', 'send', '--panel', panel, msg)
	except Refus as e:
		log(f'message à {panel} non remis : {e}')


RAPPEL = 300  # secondes sans réponse avant l'unique rappel
TOAST = ['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
         '-e', 'end run', '--']  # script constant : titre et texte passent en arguments, jamais dans le script


def toast(titre, texte):
	"""Notification système macOS, sans dépendance. La CLI cate n'en offre pas. Un échec est loggé, jamais levé.
	Limite : osascript ne sait pas attacher d'action au clic (il ouvre l'éditeur de scripts), donc rien n'ouvre la ligne."""
	titre, texte = ' '.join(titre.split())[:60], ' '.join(texte.split())[:200]  # titres et besoins viennent d'agents
	code, _, err = RUN([*TOAST, titre, texte], timeout=5)
	if code != 0:
		log(f'notification non envoyée : {err.strip()}')


def attend(n):
	"""Ligne ouverte qui attend l'humain : sections « À faire par <nom> » ou « Bloquant » du suivi."""
	return n['status'] == 'open' and (n['owner'] == OWNER_HUMAIN or n['blocking'] or n['overBudget']
	                                  or n['agentBlocked'] or n['closeFailed'])


def action_attendue(st, n):
	perm = n.get('perm') or {}
	if perm.get('choix'):
		return f"Oui ou Non : {perm['commande']}"
	if n['agentBlocked']:
		return f"à traiter dans le panneau {st['titles'].get(n.get('blockedPanel')) or ''}".strip() + (f" : {perm['commande']}" if perm.get('commande') else '')
	if n.get('worktree'):
		return 'garder ou supprimer le worktree'
	if n.get('orphan'):
		return 'fermer ou garder le panneau'
	if n['kind'] == 'draft':
		return 'lire et envoyer le brouillon'
	if n['kind'] == 'human' and (n['ref'] or '').startswith('q'):
		return 'répondre'
	return 'budget dépassé' if n['overBudget'] else 'fermeture refusée' if n['closeFailed'] else 'à faire'


def log(msg):
	print(f"{time.strftime('%H:%M:%S')} {msg}", file=sys.stderr, flush=True)


def url(st, path):
	return f"http://127.0.0.1:{st['port']}{path}"


def gh_repo(st):
	if not st.get('ghRepo'):
		code, out, _ = RUN(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
		st['ghRepo'] = out.strip() if code == 0 and out.strip() else None
	return st['ghRepo']


def free_port():
	with socket.socket() as s:
		s.bind(('127.0.0.1', 0))
		return s.getsockname()[1]


# ---------- démarrage ----------

def dollars_positifs(v):
	try:
		c = float(v)
	except ValueError:
		c = None
	if c is None or not math.isfinite(c) or c <= 0:
		raise argparse.ArgumentTypeError(f'montant en dollars > 0 attendu (ni 0, ni négatif, ni NaN, ni infini), reçu {v!r}')
	return c


def entier_positif(v):
	if not v.isdigit() or int(v) < 1:
		raise argparse.ArgumentTypeError(f'entier >= 1 attendu, reçu {v!r}')
	return int(v)


def cmd_start(a):
	require_cate()
	live = live_rows()
	if live is None:
		raise Refus('cate panel list illisible')
	with tx() as st:
		if a.notify is not None:
			st['notify'] = a.notify
		if a.max_agents is not None:
			st['maxAgents'] = a.max_agents
		p = st['panels']
		orch = p.get('orchestrator')
		if orch not in live:
			try:  # Cate avec le type de panneau agence : un seul panneau remplace canvas, orchestrateur, régisseur et suivi
				p['orchestrator'] = cate('panel', 'create', 'agence')['panelId']
			except Refus as err:
				if 'agence' not in str(err):  # autre refus : on ne le masque pas
					raise
			else:
				title(p['orchestrator'], f"Agence : {st['repo']}")
				print(f"panneau agence {p['orchestrator']}")
				return 0
		elif live[orch].get('type') == 'agence':
			print(f'panneau agence {orch}')
			return 0
		if p.get('canvas') not in live:
			titre = f"Agence : {st['repo']}"
			p['canvas'] = adopt(live, titre, 'canvas') or cate('panel', 'create', 'canvas')['panelId']
			title(p['canvas'], titre)
	with tx() as st:  # le canvas est enregistré avant l'orchestrateur : un démarrage en échec se relance sans doublon
		p = st['panels']
		if p.get('orchestrator') not in live:
			r = cate('agent', 'start', '--canvas', p['canvas'], '--agent', 'claude-code', '--title', 'Orchestrateur',
			         ORCH_PROMPT)
			p['orchestrator'] = r['panelId']
		print(f"canvas {p['canvas']}, orchestrateur {p['orchestrator']}")
	return 0


SETTINGS_HINT = ("réglages CLI du workspace à activer dans Cate : panneaux (cliPanelReadEnabled, cliPanelControlEnabled), "
                 "agents (cliAgentReadEnabled, cliAgentControlEnabled), terminaux (cliTerminalReadEnabled, cliTerminalInputEnabled)")


def adopt(live, title_, kind):
	"""Panneau vivant de ce titre et de ce type, laissé par un boot interrompu."""
	return next((p for p, r in live.items() if r.get('title') == title_ and r.get('type', kind) == kind), None)


def cmd_boot(a):
	"""Chaque panneau est enregistré dès sa création : un boot interrompu se reprend sans doublon."""
	require_cate()
	live = live_rows()
	if live is None:
		raise Refus('cate panel list illisible')
	me = caller_panel() if a.frm else None
	if me is not None and me != a.frm:
		raise Refus(f"--from {a.frm} n'est pas le panneau qui appelle ({me}) : l'orchestrateur se déclare depuis son propre panneau")
	with tx() as st:
		p = st['panels']
		if a.frm:
			if p.get('orchestrator') not in (None, a.frm) and p['orchestrator'] in live:
				raise Refus(f"un orchestrateur vivant est déjà enregistré ({p['orchestrator']}) : --from {a.frm} refusé")
			p['orchestrator'] = a.frm
		orch = p.get('orchestrator')
		for n in st['needs']:  # reprise après /clear : ce qui a été décidé
			if n['status'] == 'open':
				print(need_text(n))
		if not st['port']:
			st['port'] = free_port()
		if orch in live and live[orch].get('type') == 'agence':  # le panneau tient lui-même régisseur et suivi
			print('régisseur tenu par le panneau agence')
			return 0
		reg = p.get('regisseur') if p.get('regisseur') in live else adopt(live, 'Régisseur', 'terminal')
		fresh = reg is None
		if fresh:
			reg = cate('panel', 'create', 'terminal')['panelId']
			title(reg, 'Régisseur')
			link(orch, reg, 'context', 'Tient le suivi')
		p['regisseur'] = reg
		port = st['port']
	if fresh or not regisseur_up(port):
		try:
			cate('terminal', 'type', '--panel', reg, f"cd {shq(root())} && agence watch")
			cate('terminal', 'press', '--panel', reg, 'Enter')
		except Refus as err:
			if 'terminal-input-disabled' in str(err):
				raise Refus(f'Cate refuse la saisie dans le terminal du régisseur ; {SETTINGS_HINT}. Puis relance « agence boot ».')
			raise
	with tx() as st:
		p = st['panels']
		if p.get('suivi') not in live:
			b = adopt(live, 'Suivi', 'browser') or cate('panel', 'create', 'browser', url(st, '/'))['panelId']
			title(b, 'Suivi')
			p['suivi'] = b
			link(p.get('orchestrator'), b, 'context', 'Suivi')
		print(url(st, '/'))
	return 0


def regisseur_up(port):
	with socket.socket() as s:
		s.settimeout(0.3)
		return s.connect_ex(('127.0.0.1', port)) == 0


def shq(s):
	return "'" + s.replace("'", "'\\''") + "'"


# ---------- besoins ----------

def cmd_need(a):
	if a.action == 'add':
		by_orch = bool(a.panel) and caller_is_orchestrator()
		with tx() as st:
			owner = OWNER_HUMAIN if a.owner == 'humain' else a.owner
			n, _ = add_need(st, a.kind, a.title, ref=a.ref, owner=owner, blocking=a.blocking, unblocks=a.unblocks,
			                source=a.frm, panels=a.panel or (), done_when=a.done_when, acceptance=a.acceptance,
			                budget=a.budget, model=a.model, effort=a.effort, budget_usd=a.budget_usd)
			if by_orch:
				launch(n, a.panel)
		print(n['id'])
	elif a.action == 'panel':
		by_orch = caller_is_orchestrator()
		with tx() as st:
			n = find(st, 'needs', a.id)
			if a.panel_id not in n['panels']:
				n['panels'].append(a.panel_id)
			if by_orch:
				launch(n, [a.panel_id])
	elif a.action in ('done', 'drop'):
		me = caller_panel() if a.close else None  # jamais fermé par son propre appel, ni plus tard par le régisseur
		with tx() as st:
			n = close_need(st, a.id, 'done' if a.action == 'done' else 'dropped', a.evidence)
			n['closeSkip'] = me
			apply(st, [('close', p, n['id']) for p in n['panels'] if p != me] if a.close else [])
	elif a.action == 'log':
		if not a.text.strip():
			raise Refus('décision vide')
		with tx() as st:
			note(find(st, 'needs', a.id), a.text.strip(), 'cli')
	elif a.action == 'show':
		print(need_text(find(load(), 'needs', a.id)))
	else:
		st = load()
		for n in st['needs']:
			if a.open and n['status'] != 'open':
				continue
			print(need_text(n).split('\n')[0])
	return 0


# ---------- brouillons ----------

def cmd_draft(a):
	if a.action == 'new':
		require_cate()
		if not CIBLE_RE.match(a.cible or ''):
			raise Refus('cible invalide : slack:<canal>, mail:<adresse>, issue:<owner/repo>, '
			            'pr:<owner/repo>:<base>:<head>, comment:<owner/repo>#<N>')
		texte = sys.stdin.read() if a.texte == '-' else a.texte
		with tx() as st:
			if not st['port']:
				raise Refus("régisseur non démarré : l'orchestrateur lance d'abord « agence boot »")
			did = new_id(st, 'd')
			with open(draft_path(did), 'w') as f:
				f.write(texte.strip() + '\n')
			kind = a.cible.split(':', 1)[0]
			label = a.titre or texte.strip().splitlines()[0][:60]
			n, _ = add_need(st, 'draft', f'Valider le brouillon ({kind}) « {label} »', ref=did, owner=OWNER_HUMAIN,
			                blocking=True, unblocks=a.unblocks, source=a.frm, done_when=f'draft-sent:{did}')
			if not sous_panneau_agence(st):
				b = cate('panel', 'create', 'browser', url(st, f'/draft/{did}'))['panelId']
				title(b, f"#{n['id']} Brouillon {kind}")
				n['panels'].append(b)
				link(a.frm or st['panels'].get('orchestrator'), b, 'context', 'À valider')
			st['drafts'].append({'id': did, 'needId': n['id'], 'cible': a.cible, 'titre': a.titre, 'statut': 'à valider',
			                     'texte': None, 'hash': None, 'url': None, 'agent': a.frm})
		print(did)
	elif a.action == 'edit':
		texte = (sys.stdin.read() if a.texte == '-' else a.texte).strip()
		if not texte:
			raise Refus('texte vide')
		with tx() as st:
			d = find(st, 'drafts', a.id)
			if d['statut'] != 'à valider':
				raise Refus(f"{a.id} est « {d['statut']} » : seul un brouillon à valider se modifie")
			with open(draft_path(a.id), 'w') as f:
				f.write(texte + '\n')
			d['titre'] = a.titre or d['titre']
			d['modifie'] = time.strftime('%H:%M')
			label = d['titre'] or texte.splitlines()[0][:60]
			find(st, 'needs', d['needId'])['title'] = f"Valider le brouillon ({d['cible'].split(':', 1)[0]}) « {label} »"
	elif a.action == 'show':
		d = find(load(), 'drafts', a.id)
		print(json.dumps({k: d[k] for k in ('cible', 'titre', 'statut', 'texte')}, ensure_ascii=False, indent=1))
	elif a.action == 'sent':
		with tx() as st:
			d = find(st, 'drafts', a.id)
			if d['statut'] != 'envoyer':
				raise Refus(f"{a.id} est « {d['statut']} » : seul le bouton Envoyer de la page le valide")
			d.update(statut='envoyé', url=a.evidence)
			n = close_need(st, d['needId'], 'done', a.evidence)
			apply(st, [('close', p, n['id']) for p in n['panels']])
	elif a.action == 'drop':
		with tx() as st:
			drop_draft(st, a.id)
	return 0


def drop_draft(st, did):
	d = find(st, 'drafts', did)
	if d['statut'] not in ('à valider', 'envoyer'):
		raise Refus(f"{did} est déjà « {d['statut']} »")
	d['statut'] = 'abandonné'
	n = close_need(st, d['needId'], 'dropped')
	apply(st, [('close', p, n['id']) for p in n['panels']])


def slack_token():
	"""SLACK_USER_TOKEN de Hermes (~/.hermes/.env), jamais affiché ni copié."""
	path = os.environ.get('HERMES_ENV') or os.path.expanduser('~/.hermes/.env')
	try:
		with open(path) as f:
			for line in f:
				if line.startswith('SLACK_USER_TOKEN='):
					return line.split('=', 1)[1].strip().strip('"\'')
	except OSError:
		pass
	raise Refus(f'SLACK_USER_TOKEN absent de {path}')


def _slack(method, payload, token):
	req = urllib.request.Request(f'https://slack.com/api/{method}', data=urllib.parse.urlencode(payload).encode(),
	                             headers={'Authorization': f'Bearer {token}'})
	try:
		with urllib.request.urlopen(req, timeout=30) as r:
			return json.load(r)
	except urllib.error.HTTPError as e:
		raise (Refus if e.code < 500 else Incertain)(f'Slack : HTTP {e.code}')  # 4xx : refusé, rien posté
	except urllib.error.URLError as e:
		if isinstance(e.reason, (socket.gaierror, ConnectionRefusedError)):  # rien n'a été émis
			raise Refus(f'Slack injoignable : {e.reason.__class__.__name__}')
		raise Incertain(f'Slack injoignable : {e.reason.__class__.__name__}')
	except (OSError, ValueError, http.client.HTTPException) as e:  # délai, coupure, réponse tronquée ou illisible
		raise Incertain(f'Slack injoignable : {e.__class__.__name__}')


SLACK = _slack


def send_slack(d):
	"""Poste le texte figé avec le token utilisateur de Hermes (le connecteur MCP ajoute « Envoyé avec Claude ») ; rend le lien."""
	channel = d['cible'].split(':', 1)[1]
	token = slack_token()
	r = SLACK('chat.postMessage', {'channel': channel, 'text': d['texte'], 'unfurl_links': 'false', 'unfurl_media': 'false'}, token)
	if not isinstance(r, dict):
		raise Incertain('Slack : réponse illisible')
	if not r.get('ok'):
		err = r.get('error', 'réponse sans ok')
		# internal_error et fatal_error : Slack dit qu'une partie de l'opération a pu réussir
		raise (Incertain if err in ('internal_error', 'fatal_error') else Refus)(f'Slack : {err}')
	link_url = None
	with contextlib.suppress(Refus):
		link_url = SLACK('chat.getPermalink', {'channel': r.get('channel', channel), 'message_ts': r.get('ts', '')}, token).get('permalink')
	return link_url or f"slack:{channel}:{r.get('ts', '')}"


def send_gh(d):
	"""Envoie par gh le texte figé ; rend l'URL créée."""
	kind, rest = d['cible'].split(':', 1)
	body = d['texte'] + '\n'
	if kind == 'issue':
		cmd = ['gh', 'issue', 'create', '-R', rest, '--title', d['titre'] or d['texte'].splitlines()[0][:80],
		       '--body-file', '-']
	elif kind == 'pr':
		repo, base, head = rest.split(':')
		cmd = ['gh', 'pr', 'create', '-R', repo, '--base', base, '--head', head,
		       '--title', d['titre'] or d['texte'].splitlines()[0][:80], '--body-file', '-']
	else:
		repo, num = rest.split('#')
		cmd = ['gh', 'issue', 'comment', num, '-R', repo, '--body-file', '-']
	code, out, err = RUN(cmd, input=body)
	if code != 0:
		raise Refus(f'gh : {(err or out).strip()}')
	return out.strip().splitlines()[-1] if out.strip() else ''


# ---------- questions ----------

MERGE_OPTIONS = [{'label': 'Merger (rebase)', 'detail': 'gh pr merge --rebase'},
                 {'label': 'Demander des changements', 'detail': "l'agent reprend la PR"}]
CONFLIT = 'conflit avec la base'
MOTIFS = {'DIRTY': CONFLIT, 'BLOCKED': 'revue ou checks requis', 'UNSTABLE': 'checks non verts'}
CHECK_ECHEC = ('FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED')
GH_TIMEOUT = 10  # secondes : un gh lent ne doit pas tenir le régisseur
GH_PERIME = 300  # secondes : au-delà, l'état GitHub relevé est ignoré


def gh_frais(q):
	"""État GitHub relevé de la question s'il a moins de GH_PERIME secondes, sinon None (état inconnu)."""
	g = q.get('gh') or {}
	return g if time.time() - g.get('ts', 0) <= GH_PERIME else None


def nom_check(nom):
	"""Nom de check (texte de tiers) : sans caractères de contrôle, 60 caractères au plus."""
	return re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f\x7f-\x9f]', ' ', str(nom))).strip()[:60]


def resume_checks(rollup):
	"""statusCheckRollup -> {'fail': [noms], 'done': terminés, 'total': n} ; None si le champ manque."""
	if not isinstance(rollup, list):
		return None
	fail, done = [], 0
	for c in rollup:
		if not isinstance(c, dict):
			continue
		if 'state' in c:  # StatusContext : SUCCESS, FAILURE, ERROR, PENDING, EXPECTED
			etat, fini = c.get('state'), c.get('state') not in ('PENDING', 'EXPECTED')
		else:  # CheckRun : sans conclusion = pas fini
			etat, fini = c.get('conclusion'), bool(c.get('conclusion'))
		done += fini
		if etat in CHECK_ECHEC:
			fail.append(nom_check(c.get('name') or c.get('context') or '?'))
	return {'fail': fail, 'done': done, 'total': len([c for c in rollup if isinstance(c, dict)])}


def merge_motif(q):
	"""Motif GitHub pour lequel la PR n'est pas mergeable (état frais seulement), sinon None."""
	g = gh_frais(q) or {}
	if g.get('mergeable') == 'CONFLICTING':
		return CONFLIT
	motif, ck = MOTIFS.get(g.get('mergeStateStatus')), g.get('checks')
	if g.get('mergeStateStatus') == 'UNSTABLE' and ck:
		if ck['fail']:
			plus = len(ck['fail']) - 3
			return 'checks en échec : ' + ', '.join(ck['fail'][:3]) + (f' et {plus} autres' if plus > 0 else '')
		if ck['done'] < ck['total']:
			return f"checks en cours ({ck['done']} sur {ck['total']} terminés)"
	return motif


def vise_pr(texte, repo, num, projet):
	"""Le texte cite-t-il la PR repo#num ? « owner/repo#N » et « repo#N » ne visent que ce dépôt ; « #N » et « PR N » nus, celui du projet."""
	for m in re.finditer(rf'(?:(?:([\w.-]+)/)?([\w.-]+))?#{num}(?!\d)|\bPR\s*{num}(?!\d)', texte, re.I):
		owner, name = m.groups()
		if name:
			if (f'{owner}/{name}' if owner else name).lower() == (repo if owner else repo.split('/')[1]).lower():
				return True
		elif projet is None or projet.lower() == repo.lower():
			return True
	return False


def merge_locks(st, q):
	"""Raisons de griser Merger : besoins ouverts qui visent la PR (--unblocks ou --ref), puis motif GitHub."""
	repo, num = q['action'][len('merge:'):].split('#')
	locks = [f"{n['id']} : {n['title']}" for n in st['needs']
	         if n['status'] == 'open' and n['id'] != q['needId']
	         and ((n['kind'] in ('pr', 'issue') and n['ref'] == num and st['ghRepo'] in (None, repo))
	              or vise_pr(n['unblocks'] or '', repo, num, st['ghRepo']))]
	motif = merge_motif(q)
	return locks + [motif] if motif else locks


def merge_fetch(st):
	"""État GitHub des PR proposées au merge ({question: état}), lu HORS transaction ; un échec n'écrase rien."""
	res = {}
	for q in st['questions']:
		if not q['action'] or q['answer'] is not None:
			continue
		repo, num = q['action'][len('merge:'):].split('#')
		code, out, err = RUN(['gh', 'pr', 'view', num, '-R', repo, '--json', 'mergeable,mergeStateStatus,statusCheckRollup'], timeout=GH_TIMEOUT)
		try:
			etat = json.loads(out)
			ck = resume_checks(etat.pop('statusCheckRollup', None))
			res[q['id']] = {**etat, 'ts': time.time(), **({'checks': ck} if ck else {})}
		except (ValueError, TypeError, AttributeError):
			log(f'gh pr view {repo}#{num} : {(err or out).strip()}')
	return res


def merge_apply(st, states):
	for q in st['questions']:
		if q['id'] in states and q['answer'] is None:
			q['gh'] = states[q['id']]


def lire_github(st):
	"""Tout ce que le tour du régisseur lit sur GitHub, hors transaction : (états des besoins, états de merge)."""
	return gh_states(st, gh_needed(st)), merge_fetch(st)


def cmd_ask(a):
	require_cate()
	if a.merge:
		if not re.match(r'^[\w.-]+/[\w.-]+#\d+$', a.merge):
			raise Refus('--merge attend owner/repo#N')
		options = MERGE_OPTIONS
	else:
		options = [dict(zip(('label', 'detail'), (o.split('|', 1) + [''])[:2])) for o in a.option or []]
		if not 2 <= len(options) <= 4:
			raise Refus('2 à 4 options --option "label|effet", la recommandée en premier')
	with tx() as st:
		if not st['port']:
			raise Refus("régisseur non démarré : l'orchestrateur lance d'abord « agence boot »")
		agent = a.frm or st['panels'].get('orchestrator')
		qid = new_id(st, 'q')
		n, _ = add_need(st, 'human', a.question, ref=qid, owner=OWNER_HUMAIN, blocking=True, unblocks=a.unblocks,
		                source=agent)
		if not sous_panneau_agence(st):
			b = cate('panel', 'create', 'browser', url(st, f'/ask/{qid}'))['panelId']
			title(b, f"#{n['id']} Question")
			n['panels'].append(b)
			link(agent, b, 'context', 'Question')
		st['questions'].append({'id': qid, 'needId': n['id'], 'agent': agent, 'question': a.question,
		                        'options': options, 'action': f'merge:{a.merge}' if a.merge else None, 'answer': None})
	print(qid)
	return 0


# ---------- clics (pages du régisseur) ----------

def token_ok(form):
	return secrets.compare_digest((form.get('token') or [''])[0], TOKEN)


def incertain_msg(st, did):
	return ("Envoi Slack incertain : Slack n'a pas répondu clairement, le message est peut-être parti : vérifie le canal avant de renvoyer. "
	        f"Pour renvoyer, ouvre la page du brouillon {url(st, f'/draft/{did}')} : « Envoyer quand même » demande une confirmation distincte.")


def click(path, form):
	"""Effet d'un bouton. Rend (code HTTP, redirection ou message). Le jeton est vérifié par le serveur."""
	m = re.match(r'^/draft/(d\d+)/(send|drop|edit)$', path)
	if m:
		did, action = m.groups()
		with tx() as st:
			d = find(st, 'drafts', did)
			if action == 'edit':
				e = cate('panel', 'create', 'editor', '--file', draft_path(did))['panelId']
				title(e, f"#{d['needId']} Brouillon (texte)")
				find(st, 'needs', d['needId'])['panels'].append(e)
				return 303, f'/draft/{did}'
			if d['statut'] != 'à valider':
				return 409, f"Ce brouillon est déjà « {d['statut']} »."
			if find(st, 'needs', d['needId'])['status'] != 'open':
				return 409, 'Ce brouillon n\'est plus attendu (besoin clos).'
			if action == 'drop':
				drop_draft(st, did)
				note(find(st, 'needs', d['needId']), f'brouillon {did} abandonné', 'clic')
				notify(d['agent'] or st['panels'].get('orchestrator'), f'{nom()} a abandonné le brouillon {did}.')
				return 303, '/'
			with open(draft_path(did)) as f:
				texte = f.read().strip()
			if (form.get('h') or [''])[0] != sha(texte):
				return 409, 'Le texte a changé depuis son affichage : recharge la page, relis, puis Envoyer.'
			kind = d['cible'].split(':', 1)[0]
			if kind == 'slack' and d.get('incertain') and (form.get('confirme') or [''])[0] != '1':
				return 409, incertain_msg(st, did)
			avant = bool(d.get('incertain'))
			if kind == 'slack':  # marqueur écrit AVANT l'appel : un régisseur tué pendant l'appel laisse le brouillon incertain
				d.update(texte=texte, hash=sha(texte), allowed=False, incertain=True)
				dump(st)
			else:
				d.update(statut='envoyer', texte=texte, hash=sha(texte), allowed=False)
			if kind == 'mail':
				note(find(st, 'needs', d['needId']), f"Envoyer cliqué sur {did} ({d['cible']})", 'clic')
				notify(st['panels'].get('orchestrator'),
				       f"{nom()} a cliqué Envoyer sur le brouillon {did} ({d['cible']}). Envoie-le maintenant par l'outil MCP "
				       f"avec exactement le texte de « agence draft show {did} », puis « agence draft sent {did} --evidence <lien> ».")
				return 303, '/'
			try:
				link_url = send_slack(d) if kind == 'slack' else send_gh(d)
			except Refus as e:
				d.update(statut='à valider', texte=None, hash=None)
				if kind != 'slack':
					return 409, f"Envoi refusé, brouillon laissé à valider : {e}"
				if not (isinstance(e, Incertain) or avant):  # issue certaine : le marqueur tombe ; un envoi incertain d'avant reste
					d.pop('incertain', None)
				elif not avant:  # envoi devenu incertain : le régisseur ouvre la page de sortie (un agent ne le peut pas : agence-guard)
					with contextlib.suppress(Refus):
						b = cate('panel', 'create', 'browser', url(st, f'/draft/{did}'))['panelId']
						title(b, f"#{d['needId']} Envoi Slack incertain")
						find(st, 'needs', d['needId'])['panels'].append(b)
						link(st['panels'].get('orchestrator'), b, 'context', 'Envoi incertain')
				note(find(st, 'needs', d['needId']), f"{did} : envoi Slack " + (f'incertain ({e}) : vérifie le canal avant de renvoyer'
				     if isinstance(e, Incertain) else f'refusé ({e})'), 'clic')
				return 409, incertain_msg(st, did) if isinstance(e, Incertain) else f"Envoi refusé, brouillon laissé à valider : {e}"
			d.pop('incertain', None)
			d.update(statut='envoyé', url=link_url)
			note(find(st, 'needs', d['needId']), f'{did} envoyé : {link_url}', 'clic')
			n = close_need(st, d['needId'], 'done', link_url or 'envoyé')
			apply(st, [('close', p, n['id']) for p in n['panels']])
			notify(d['agent'] or st['panels'].get('orchestrator'), f'Brouillon {did} envoyé par {nom()} : {link_url}')
			return 303, '/'
	m = re.match(r'^/wt/(n\d+)/(remove|keep)$', path)
	if m:
		nid, action = m.groups()
		n = find(load(), 'needs', nid)
		wt = n.get('worktree')
		if n['status'] != 'open' or not wt:
			return 409, "Cette proposition n'est plus attendue."
		if action == 'remove':  # git hors transaction ; sans --force, il refuse un worktree modifié ; la branche reste
			if not worktree_ok(gh_repo(load()), wt['path'], wt['branch']):
				return 409, "Le worktree a changé (modifié, ou plus de PR mergée sur son dernier commit) : rien supprimé."
			code, out, err = RUN(['git', '-C', root(), 'worktree', 'remove', wt['path']])
			if code != 0:
				return 409, f"Suppression refusée par git : {(err or out).strip()}"
		with tx() as st:
			n = find(st, 'needs', nid)
			if n['status'] != 'open':
				return 409, "Cette proposition n'est plus attendue."
			if action == 'remove':
				for x in (n, *(x for x in st['needs'] if x['id'] == n['source'])):
					note(x, f"worktree {wt['path']} supprimé (branche {wt['branch']} gardée)", 'clic')
				close_need(st, nid, 'done', f"worktree supprimé : {wt['path']}")
			else:
				note(n, f"worktree {wt['path']} gardé", 'clic')
				close_need(st, nid, 'dropped')
		return 303, '/'
	m = re.match(r'^/orphan/(n\d+)/(close|keep)$', path)
	if m:
		nid, action = m.groups()
		n = find(load(), 'needs', nid)
		o = n.get('orphan')
		if n['status'] != 'open' or not o:
			return 409, "Cette proposition n'est plus attendue."
		if action == 'close':  # sans --discard : Cate refuse un panneau qui perdrait du travail, et le besoin reste ouvert
			try:
				cate('panel', 'close', o['panel'])
			except Refus as err:
				return 409, f'Fermeture refusée par Cate : {err}'
		with tx() as st:
			n = find(st, 'needs', nid)
			if n['status'] != 'open':
				return 409, "Cette proposition n'est plus attendue."
			if action == 'close':
				note(n, f"panneau {o['panel']} fermé", 'clic')
				close_need(st, nid, 'done', f"panneau fermé : {o['panel']}")
			else:
				note(n, f"panneau {o['panel']} gardé", 'clic')
				close_need(st, nid, 'dropped')
				st['orphanGardes'].append(o['panel'])
		return 303, '/'
	m = re.match(r'^/ask/(q\d+)$', path)
	if m:
		qid = m.group(1)
		with tx() as st:
			q = find(st, 'questions', qid)
			if q['answer'] is not None:
				return 409, 'Question déjà répondue.'
			libre = (form.get('libre') or [''])[0].strip()
			choice = (form.get('choice') or [''])[0]
			if choice == 'rebase' and q['action'] and not libre:  # conflit : l'orchestrateur fait rebaser, pas de merge
				q['answer'] = 'Demander le rebase'
				n = close_need(st, q['needId'], 'done', f"réponse : {q['answer']}")
				note(n, f"Demander le rebase cliqué ({merge_motif(q) or 'à jour'})", 'clic')
				apply(st, [('close', p, n['id']) for p in n['panels']])
				notify(st['panels'].get('orchestrator'), f"{nom()} demande le rebase de {q['action'][len('merge:'):]} "
				       f"({merge_motif(q) or 'à jour'}) : fais-la rebaser par un agent, puis repose agence ask --merge.")
				return 303, '/'
			if libre:
				answer = libre
			elif choice.isdigit() and int(choice) < len(q['options']):
				answer = q['options'][int(choice)]['label']
			else:
				return 400, 'Écris une réponse ou choisis une option.'
			evidence = f'réponse : {answer}'
			forced = None
			if q['action'] and choice == '0' and not libre:
				locks = merge_locks(st, q)
				if locks and (form.get('force') or [''])[0] != '1':
					return 409, 'Merge grisé : ' + ' ; '.join(locks) + ' (« Merger quand même » pour passer outre).'
				forced = locks
				repo, num = q['action'][len('merge:'):].split('#')
				code, out, err = RUN(['gh', 'pr', 'merge', num, '-R', repo, '--rebase'])
				if code != 0:
					return 409, f"Merge refusé : {(err or out).strip()}"
				evidence = f'https://github.com/{repo}/pull/{num}'
			q['answer'] = answer
			n = close_need(st, q['needId'], 'done', evidence)
			note(n, f"réponse à « {q['question']} » : {answer}", 'clic')
			if forced:
				note(n, 'Merger quand même malgré : ' + ' ; '.join(forced), 'clic')
			apply(st, [('close', p, n['id']) for p in n['panels']])
			msg = f"Réponse de {nom()} à « {q['question']} » : {answer}"
			notify(q['agent'], msg)
			orch = st['panels'].get('orchestrator')
			if orch and orch != q['agent']:  # l'orchestrateur garde la décision après un /clear
				notify(orch, f"{msg} (question de {st['titles'].get(q['agent'], q['agent'])})")
			return 303, '/'
	m = re.match(r'^/perm/(n\d+)/(oui|non)$', path)
	if m:
		return click_perm(*m.groups())
	return 404, 'Action inconnue.'


def click_perm(nid, rep):
	"""Oui ou Non à la demande d'un agent bloqué. L'écran est relu (hors transaction) juste avant d'appuyer :
	si la demande a changé ou disparu, rien ne part ; une demande ne reçoit qu'une réponse."""
	n = find(load(), 'needs', nid)
	perm = n.get('perm')
	if n['status'] != 'open' or not n['agentBlocked'] or not perm or not perm['choix']:
		return 409, "Pas de demande à laquelle répondre d'ici : réponds dans le panneau de l'agent."
	panel, sig, oui = perm['panel'], perm_sig(perm), rep == 'oui'
	if n.get('permAnswered') == sig:
		return 409, 'Demande déjà répondue.'
	try:  # d'abord l'état de l'agent : une réponse illisible ne marque rien
		attend = agent_attend(panel)
	except Refus as err:
		return 409, str(err)
	if not attend:
		return 409, "L'agent n'attend plus de permission : rien n'est envoyé."
	with tx() as st:  # la réponse est marquée avant la frappe : un second clic, même pendant la frappe, est refusé
		n = find(st, 'needs', nid)
		if n['status'] != 'open' or not n.get('perm') or perm_sig(n['perm']) != sig or n.get('permAnswered') == sig:
			return 409, 'Demande déjà répondue ou changée.'
		n['permAnswered'] = sig
	try:  # tout ce qui suit est hors transaction, timeouts courts ; un refus ici libère la demande (rien n'est parti)
		ecran = lire_ecran(panel)
		vu = parse_ecran(ecran) if ecran is not None else None
		if not vu or not vu['choix'] or perm_sig(vu) != sig:
			raise Refus('La demande a changé ou disparu : recharge le suivi, relis, puis réponds.')
	except Refus as err:
		with tx() as st:
			n = find(st, 'needs', nid)
			if n.get('permAnswered') == sig:
				n['permAnswered'] = None
		return 409, str(err)
	detail = ' | '.join(x for x in (vu['commande'], vu['motif']) if x)
	reponse = f"{'Oui' if oui else 'Non'} à la demande {vu['genre']} : {detail}"
	verbe, *touches = SAISIES[vu['genre']][rep]
	try:
		cate('terminal', verbe, '--panel', panel, *touches, timeout=SCREEN_TIMEOUT)
	except (Refus, ValueError) as err:  # frappe peut-être partie (même sortie illisible) : la demande reste marquée
		with tx() as st:
			n = find(st, 'needs', nid)
			n['permNonConfirmee'] = True
			note(n, f'{reponse} (frappe non confirmée : {err})', 'clic')
		return 409, f'Frappe non confirmée ({err}) : vérifie dans le panneau de l\'agent.'
	with tx() as st:
		note(find(st, 'needs', nid), reponse, 'clic')
	return 303, '/'


def agent_attend(panel):
	"""L'agent de ce panneau est-il arrêté sur une permission (même test que tick) ? Hors transaction, timeout court."""
	try:
		agents = cate('agent', 'list', timeout=SCREEN_TIMEOUT)
		agents = agents if isinstance(agents, list) else agents.get('agents', [])
		a = next((a for a in agents if a.get('panelId') == panel), None)
		return bool(a) and a.get('state') == 'waitingForInput' and not a.get('canReceivePrompt', True)
	except (ValueError, KeyError, TypeError, AttributeError):  # JSON inattendu de cate
		raise Refus("État de l'agent illisible : rien n'est envoyé.")


# ---------- pages ----------

_md_cache = {}


def render_md(text):
	if text in _md_cache:
		return _md_cache[text]
	code, out, _ = RUN(['gh', 'api', 'markdown', '-f', f'text={text}', '-f', 'mode=gfm'])
	res = out if code == 0 and out.strip() else f'<pre>{html.escape(text)}</pre>'
	if code == 0:
		_md_cache[text] = res
	return res


def e(s):
	return html.escape(str(s)) if s is not None else ''


def layout(heading, body, refresh=False):
	meta = '<meta http-equiv="refresh" content="10">' if refresh else ''
	return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">{meta}
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(heading)}</title>
<link rel="stylesheet" href="{CSS}">
<style>
body{{background:#fff;margin:0;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2328}}
main{{max-width:860px;margin:0 auto;padding:16px}}
h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#59636e;margin-bottom:16px}}
section{{border:1px solid #d1d9e0;border-radius:6px;margin-bottom:16px}}
section>h2{{font-size:14px;margin:0;padding:8px 12px;background:#f6f8fa;border-bottom:1px solid #d1d9e0;border-radius:6px 6px 0 0}}
section.block>h2{{background:#ffebe9;color:#82071e}} section.me>h2{{background:#fff8c5}}
ul{{list-style:none;margin:0;padding:0}} li{{padding:8px 12px;border-top:1px solid #eff2f5}} li:first-child{{border-top:0}}
.meta{{color:#59636e;font-size:12px}} .empty{{color:#59636e;padding:8px 12px}}
form{{display:inline}} .btn{{font:inherit;font-weight:600;border:1px solid #d1d9e0;border-radius:6px;padding:4px 12px;
background:#f6f8fa;cursor:pointer;margin-left:6px}} .btn.go{{background:#1f883d;color:#fff;border-color:#1a7f37}}
.btn.no{{color:#d1242f}} .card{{display:block;width:100%;text-align:left;margin:8px 0;padding:12px;border:1px solid #d1d9e0;
border-radius:6px;background:#fff;cursor:pointer;font:inherit}} .card.reco{{border-color:#1f883d;box-shadow:0 0 0 1px #1f883d}}
.card.no{{color:#d1242f;border-color:#d1242f}} .btn:disabled{{opacity:.5;cursor:not-allowed}}
.card b{{display:block}} .box{{border:1px solid #d1d9e0;border-radius:6px;padding:16px;margin:12px 0}}
textarea{{width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid #d1d9e0;border-radius:6px}}
a{{color:#0969da}}
</style></head><body><main>{body}</main></body></html>"""


def btn(path, label, cls='', h=None, **fields):
	extra = f'<input type="hidden" name="h" value="{e(h)}">' if h else ''
	extra += ''.join(f'<input type="hidden" name="{e(k)}" value="{e(v)}">' for k, v in fields.items())
	return (f'<form method="post" action="{e(path)}"><input type="hidden" name="token" value="{TOKEN}">{extra}'
	        f'<button class="btn {cls}">{e(label)}</button></form>')


def need_line(st, n):
	parts = [f"<b>{e(n['title'])}</b>"]
	meta = []
	if n['kind'] in ('pr', 'issue') and n['ref'] and gh_repo_cached(st):
		path = 'pull' if n['kind'] == 'pr' else 'issues'
		meta.append(f'<a href="https://github.com/{e(st["ghRepo"])}/{path}/{e(n["ref"])}">#{e(n["ref"])}</a>')
	if n['unblocks']:
		meta.append(f"débloque {e(n['unblocks'])}")
	if n['acceptance']:
		meta.append(f"acceptation : {e(n['acceptance'])}")
	if n.get('seen'):
		m, ef = n['seen']['model'], n['seen']['effort']
		meta.append(f"modèle {e(m)}" + (f", effort {e(ef)}" if ef else '') if m else 'modèle inconnu')
	if n.get('overBudgetUsd'):
		meta.append(f"budget de {n['budgetUsd']:.2f} $ dépassé (coût {dollars(cout_besoin(n))}) : continuer, réduire ou arrêter ?")
	if n['overBudget'] and n['budgetMin'] and not n.get('overBudgetUsd'):
		meta.append(f"budget de {e(n['budgetMin'])} min dépassé : continuer, réduire ou arrêter ?")
	if n.get('seen') or n.get('costByPanel'):  # un agent est suivi : sa dépense, ou « coût inconnu » (tiret de Cate, usage illisible)
		c = cout_besoin(n)
		meta.append(f"coût {cout_texte(c, None in n['costByPanel'].values())}" if c is not None else 'coût inconnu')
	perm = n.get('perm') if n['agentBlocked'] else None  # états écrits avant ce champ : pas de demande lue
	if n['agentBlocked']:
		meta.append("agent bloqué sur une permission ou une question")
	if perm and perm['genre'] == 'hook' and not perm['commande']:
		meta.append("commande trop longue ou cadre illisible : pas de bouton")
	if perm and (perm['commande'] or perm['motif']):
		code = f"<code>{e(perm['commande'])}</code>" if perm['commande'] else ''
		meta.append('demande : ' + ' · '.join(x for x in (code, e(perm['motif'])) if x))
	if n['closeFailed']:
		meta.append("fermeture refusée (agent en plein tour ou travail non enregistré) : à fermer à la main")
	if n['status'] == 'done' and n['evidence']:
		ev = n['evidence']
		meta.append(f'preuve : <a href="{e(ev)}">{e(ev)}</a>' if ev.startswith('http') else f'preuve : {e(ev)}')
	if n['kind'] == 'draft':
		meta += [f"modifié à {e(d['modifie'])}" for d in st['drafts'] if d['id'] == n['ref'] and d.get('modifie')]
		meta += [f"envoi Slack incertain : vérifie le canal avant de renvoyer, puis « Envoyer quand même » sur {e(url(st, '/draft/' + d['id']))}"
		         for d in st['drafts'] if d['id'] == n['ref'] and d.get('incertain')]
	titles = [st['titles'].get(p) for p in n['panels'] if st['titles'].get(p)]
	if titles:
		meta.append('panneau : ' + ', '.join(e(t) for t in titles))
	actions = ''
	if n['status'] == 'open' and n['kind'] == 'draft':
		did = n['ref']
		actions = (btn(f'/draft/{did}/drop', 'Abandonner', 'no')
		           + f'<a class="btn go" href="/draft/{e(did)}">Lire et envoyer</a>')
	elif n['status'] == 'open' and n.get('worktree'):
		actions = btn(f"/wt/{n['id']}/keep", 'Garder') + btn(f"/wt/{n['id']}/remove", 'Supprimer', 'no')
	elif n['status'] == 'open' and n.get('orphan'):
		actions = btn(f"/orphan/{n['id']}/keep", 'Garder') + btn(f"/orphan/{n['id']}/close", 'Fermer', 'no')
	elif n['status'] == 'open' and n['kind'] == 'human' and (n['ref'] or '').startswith('q'):
		actions = f'<a class="btn go" href="/ask/{e(n["ref"])}">Répondre</a>'
		q = next((x for x in st['questions'] if x['id'] == n['ref']), None)
		locks = merge_locks(st, q) if q and q['action'] else []
		if q and q['action'] and not gh_frais(q):
			meta.append('état GitHub inconnu')
		if locks:
			meta.append('Merger grisé : ' + ' ; '.join(e(x) for x in locks))
			if merge_motif(q) == CONFLIT:
				actions = btn(f'/ask/{q["id"]}', 'Demander le rebase', 'go', choice='rebase') + actions
	if n['status'] == 'open' and perm and perm['choix'] and n.get('permAnswered') != perm_sig(perm):
		actions += btn(f"/perm/{n['id']}/non", 'Non', 'no') + btn(f"/perm/{n['id']}/oui", 'Oui', 'go')
	elif n['status'] == 'open' and n['agentBlocked'] and n.get('blockedPanel'):  # sans bouton prouvé : le panneau en texte
		if perm and n.get('permNonConfirmee') and n.get('permAnswered') == perm_sig(perm):
			meta.append('réponse envoyée, non confirmée')
		meta.append(f"à traiter dans le panneau « {e(st['titles'].get(n['blockedPanel']) or n['blockedPanel'])} »")
	head = f'<div style="display:flex;justify-content:space-between;gap:8px"><span>{" ".join(parts)}</span><span>{actions}</span></div>'
	return f'<li>{head}<div class="meta">{" · ".join(meta)}</div></li>'


def gh_repo_cached(st):
	return st.get('ghRepo')


def section(st, name, needs, cls=''):
	items = ''.join(need_line(st, n) for n in needs) or '<div class="empty">Rien.</div>'
	return f'<section class="{cls}"><h2>{e(name)} ({len(needs)})</h2><ul>{items}</ul></section>'


def page_suivi(st):
	opened = [n for n in st['needs'] if n['status'] == 'open']
	mine = [n for n in opened if n['owner'] == OWNER_HUMAIN]
	block = [n for n in opened if n['owner'] != OWNER_HUMAIN and attend(n)]
	rest = [n for n in opened if n not in mine and n not in block]
	done = sorted([n for n in st['needs'] if n['status'] == 'done'], key=lambda n: n['updated'], reverse=True)[:20]
	total, partiel = cout_projet(st)
	body = (f"<h1>{e(st['repo'])}</h1><div class=\"sub\">Agents : {st['agentsActive']} en cours, {st['agentsWaiting']} en attente (plafond {plafond(st)}) · "
	        f"dépense des agents : {cout_texte(total, partiel) if total is not None else 'coût inconnu'} · "
	        f"mis à jour {time.strftime('%H:%M:%S')}</div>"
	        + section(st, 'Bloquant', block, 'block') + section(st, f'À faire par {nom()}', mine, 'me')
	        + section(st, 'Fait', done) + section(st, 'Reste à faire', rest))
	return layout(f"Suivi : {st['repo']}", body, refresh=True)


def page_draft(st, did):
	d = find(st, 'drafts', did)
	with open(draft_path(did)) as f:
		texte = f.read()
	kind = d['cible'].split(':', 1)[0]
	label = {'issue': 'Issue', 'pr': 'Pull request', 'comment': 'Commentaire', 'slack': 'Message Slack', 'mail': 'Mail'}[kind]
	actions = ''
	if d['statut'] == 'à valider':
		actions = (btn(f'/draft/{did}/edit', 'Modifier') + btn(f'/draft/{did}/drop', 'Abandonner', 'no')
		           + (btn(f'/draft/{did}/send', 'Envoyer quand même (canal vérifié)', 'no', h=sha(texte.strip()), confirme='1')
		              if d.get('incertain') else btn(f'/draft/{did}/send', 'Envoyer', 'go', h=sha(texte.strip()))))
		if d.get('incertain'):
			actions = '<p class="meta"><b>Envoi incertain : vérifie le canal avant de renvoyer.</b></p>' + actions
	link_html = f' · <a href="{e(d["url"])}">{e(d["url"])}</a>' if d['url'] else ''
	body = (f'<div class="sub"><a href="/">Suivi</a> · {label} · {e(d["cible"])} · {e(d["statut"])}{link_html}</div>'
	        f'<h1>{e(d["titre"] or "")}</h1><div class="box markdown-body">{render_md(texte)}</div>'
	        f'<div style="text-align:right">{actions}</div>'
	        '<p class="meta">Modifier ouvre le texte dans un éditeur ; enregistrer puis recharger cette page. '
	        'Seul le bouton Envoyer fait partir ce texte.</p>')
	return layout(f'Brouillon {did}', body)


def page_ask(st, qid):
	q = find(st, 'questions', qid)
	if q['answer'] is not None:
		cards = f'<p>Répondu : <b>{e(q["answer"])}</b></p>'
	else:
		locks = merge_locks(st, q) if q['action'] else []
		inconnu = '<p class="meta">état GitHub inconnu</p>' if q['action'] and not gh_frais(q) else ''
		FORCE = '<input type="hidden" name="force" value="1">'

		def card(i, o):
			# Merger verrouillé : le bouton « quand même » prend la place de l'option, mêmes dimensions, verrous au-dessus.
			force = i == 0 and locks
			confirm = ' onsubmit="return confirm(' + e(json.dumps('Merger quand même, malgré :\n' + '\n'.join(f'- {x}' for x in locks), ensure_ascii=False)) + ')"'
			reco = '' if force else ' reco' if i == 0 else ''
			label = 'Merger quand même (rebase)' if force else o['label'] + (' (Recommandé)' if i == 0 else '')
			return ((('<p class="meta">Merger grisé :</p><ul>' + ''.join(f'<li>{e(x)}</li>' for x in locks) + '</ul>') if force else '')
			        + f'<form method="post" action="/ask/{qid}" style="display:block"{confirm if force else ""}><input type="hidden" name="token" value="{TOKEN}">'
			        f'<input type="hidden" name="choice" value="{i}">{FORCE if force else ""}'
			        f'<button class="card{" no" if force else reco}"><b>{e(label)}</b><span class="meta">{e(o["detail"])}</span></button></form>')
		cards = inconnu + ''.join(card(i, o) for i, o in enumerate(q['options']))
		if locks and merge_motif(q) == CONFLIT:
			cards += btn(f'/ask/{qid}', 'Demander le rebase', 'go', choice='rebase')
		cards += (f'<form method="post" action="/ask/{qid}" style="display:block"><input type="hidden" name="token" value="{TOKEN}">'
		          '<textarea name="libre" rows="3" placeholder="Autre réponse"></textarea>'
		          '<div style="text-align:right"><button class="btn">Répondre</button></div></form>'
		          # Actif sans JavaScript (le serveur refuse le vide) ; le script le grise tant que le champ est vide,
		          # au chargement et au retour arrière (pageshow), où le navigateur restaure le texte sans événement input.
		          '<script>(function(){var f=document.currentScript.previousElementSibling,t=f.querySelector("textarea"),b=f.querySelector("button");'
		          'function s(){b.disabled=!t.value.trim()}t.oninput=s;addEventListener("pageshow",s);s()})()</script>')
	body = (f'<div class="sub"><a href="/">Suivi</a> · question de {e(st["titles"].get(q["agent"], q["agent"]))}</div>'
	        f'<h1>{e(q["question"])}</h1>{cards}')
	return layout('Question', body)


def page_erreur(path, msg):
	back = f'<a href="{e(path)}">Retour à la question</a> · ' if re.match(r'^/ask/q\d+$', path) else ''
	return layout('Action', f'<p>{e(msg)}</p><p>{back}<a href="/">Suivi</a></p>')


class Pages(http.server.BaseHTTPRequestHandler):
	def send(self, code, body, location=None, ctype='text/html'):
		data = body.encode()
		try:  # le navigateur a pu fermer avant la réponse : l'action est déjà faite, seule la réponse ne part plus
			self.send_response(code)
			if location:
				self.send_header('Location', location)
			self.send_header('Content-Type', f'{ctype}; charset=utf-8')
			self.send_header('Content-Length', str(len(data)))
			self.end_headers()
			self.wfile.write(data)
		except (BrokenPipeError, ConnectionResetError):
			log(f'client parti avant la réponse : {self.command} {self.path}')

	def do_GET(self):
		if not PAGES:
			return self.send(404, 'Introuvable', ctype='text/plain')
		st = load()
		path = urllib.parse.urlparse(self.path).path
		try:
			if path == '/':
				return self.send(200, page_suivi(st))
			m = re.match(r'^/draft/(d\d+)$', path)
			if m:
				return self.send(200, page_draft(st, m.group(1)))
			m = re.match(r'^/ask/(q\d+)$', path)
			if m:
				return self.send(200, page_ask(st, m.group(1)))
		except (Refus, FileNotFoundError) as err:
			return self.send(404, layout('Introuvable', f'<p>{e(err)}</p><p><a href="/">Suivi</a></p>'))
		self.send(404, layout('Introuvable', '<p><a href="/">Suivi</a></p>'))

	def do_POST(self):
		size = int(self.headers.get('Content-Length') or 0)
		form = urllib.parse.parse_qs(self.rfile.read(size).decode())
		as_json = 'application/json' in (self.headers.get('Accept') or '')  # panneau agence de Cate : pas de page
		if not token_ok(form):
			if as_json:
				return self.send(403, json.dumps({'code': 403, 'message': 'Jeton invalide'}), ctype='application/json')
			return self.send(403, layout('Refusé', '<p>Jeton invalide : recharge la page.</p>'))
		try:
			code, msg = click(urllib.parse.urlparse(self.path).path, form)
		except Refus as err:
			code, msg = 409, str(err)
		if as_json:
			return self.send(200 if code == 303 else code, json.dumps({'code': code, 'message': msg}, ensure_ascii=False),
			                 ctype='application/json')
		if code == 303:
			return self.send(303, '', msg)
		self.send(code, page_erreur(urllib.parse.urlparse(self.path).path, msg))

	def log_message(self, fmt, *args):
		pass


# ---------- régisseur ----------

def gh_needed(st):
	nums = set()
	for n in st['needs']:
		if n['status'] != 'open':
			continue
		if n['kind'] in ('pr', 'issue') and (n['ref'] or '').isdigit():
			nums.add(n['ref'])
		m = re.match(r'^(pr-merged|issue-closed):(\d+)$', n['doneWhen'] or '')
		if m:
			nums.add(m.group(2))
	return sorted(nums, key=int)


def gh_states(st, nums):
	repo = gh_repo(st)
	if not nums or not repo:
		return {}
	owner, name = repo.split('/')
	fields = ' '.join(f'n{x}: issueOrPullRequest(number:{x}){{... on PullRequest{{state url}} ... on Issue{{state url}}}}'
	                  for x in nums)
	query = f'query{{repository(owner:"{owner}",name:"{name}"){{{fields}}}}}'
	code, out, err = RUN(['gh', 'api', 'graphql', '-f', f'query={query}'], timeout=GH_TIMEOUT)
	if code != 0:
		log(f'gh graphql : {err.strip()}')
		return {}
	data = (json.loads(out).get('data') or {}).get('repository') or {}
	return {k[1:]: v for k, v in data.items() if v}


# ---------- demandes de permission d'un agent bloqué ----------

BORDURES = '─│┃╭╮╰╯ '
SEP_RE = re.compile(r'^╌+$')
HOOK_RE = re.compile(r'^Hook \S+ requires confirmation')
BOUTONS_RE = re.compile(r'^\[\s*Cancel\s*\]\s*\[\s*Proceed\s*\]')
CASE_RE = re.compile(r'^\d+\.\s*\[[ xX✔]?\]')
PIED = 6  # lignes utiles tolérées sous une demande (pied de page, barre d'état) ; au-delà elle est dans l'historique, périmée
SCREEN_TIMEOUT = 5  # secondes : un terminal qui ne répond pas ne tient ni le régisseur ni un clic
# Réponse à un menu « 1. Yes / 2. No » dont le curseur est sur 1 (relevé le 17/11 sur les écrans réels).
# Oui : Entrée, vérifié à la main sur « Switch model? ». Non : Échap, annoncé à l'écran (« Esc to cancel »), non éprouvé.
# Seuls hook et modèle ont des boutons : blast-radius (hotkeys y et c dans son panneau, pas prouvés depuis un terminal) et
# les questions à cases restent en affichage seul.
SAISIES = {g: {'oui': ('press', 'enter'), 'non': ('press', 'escape')} for g in ('hook', 'modele')}


def parse_ecran(text):
	"""Demande affichée au bas d'un écran de terminal : {genre, commande, motif, choix} ou None.
	genre : hook (confirmation d'un hook), modele (Switch model?), blast (blast-radius) et question (cases à cocher),
	ces deux derniers sans bouton. choix : ['oui', 'non'] si l'humain peut répondre d'un bouton (menu dont le curseur
	est sur « 1. »), [] sinon."""
	pairs = []  # (ligne préfixée par « │ », curseur ❯, texte) ; les lignes vides ou faites de bordures sont écartées
	for l in text.splitlines():
		s = l.strip()
		barre = s.startswith('│')  # le contenu d'un cadre porte la barre ; les séparateurs du cadre n'en portent pas
		s = s.lstrip('│').strip()
		row = ' '.join(s.lstrip('❯').split())
		if row.strip(BORDURES):
			pairs.append((barre, s.startswith('❯'), row))
	bar, cur, rows = [p[0] for p in pairs], [p[1] for p in pairs], [p[2] for p in pairs]

	def last(pred):
		return next((i for i in range(len(rows) - 1, -1, -1) if pred(rows[i])), None)

	def menu(i):  # « 1. Yes… » puis « 2. No… » à partir de rows[i] : index de « 2. No », sinon None
		return i + 1 if i + 1 < len(rows) and rows[i].startswith('1. Yes') and rows[i + 1].startswith('2. No') else None

	oui_non = lambda i: ['oui', 'non'] if cur[i] else []  # Entrée valide la ligne sous le curseur : sur 2, elle dirait Non
	found = []
	i = last(HOOK_RE.match)
	j = None if i is None else next((k for k in range(i + 1, len(rows)) if rows[k].startswith('Do you want to proceed')), None)
	if j is not None and j + 1 < len(rows) and menu(j + 1):
		# Le cadre : « Bash command », description, pointillés, commande, pointillés, « Hook ... ». Seuls des pointillés SANS
		# barre sont des séparateurs : une ligne « │ ╌╌╌ » est du contenu de la commande. Cadre incomplet (haut hors de
		# l'écran lu, en-tête ou séparateur absent, commande vide ou ligne sans barre) : commande '' et pas de bouton.
		sep = lambda k: bool(SEP_RE.match(rows[k])) and not bar[k]
		s2, cmd = i - 1, ''
		if s2 >= 0 and sep(s2):
			entete = lambda k: rows[k] == 'Bash command' and not bar[k]
			h = next((k for k in range(s2 - 1, -1, -1) if entete(k)), None)
			seps = [] if h is None else [k for k in range(h + 1, s2) if sep(k)]  # un seul séparateur entre l'en-tête et le bas
			if len(seps) == 1 and not (h and entete(h - 1)) and seps[0] + 1 < s2 and all(bar[seps[0] + 1:s2]):
				cmd = ' '.join(rows[seps[0] + 1:s2])
		motif = ' '.join(r for r in rows[i + 1:j] if not r.endswith('to update hooks'))
		found.append((j + 2, {'genre': 'hook', 'commande': cmd, 'motif': re.sub(r'\s*\[settings\]', '', motif),
		                      'choix': oui_non(j + 1) if cmd else []}))
	i = last(lambda r: r.startswith('Switch model?'))
	y = None if i is None else next((k for k in range(i + 1, min(i + 6, len(rows))) if menu(k)), None)
	if y is not None:
		found.append((y + 1, {'genre': 'modele', 'commande': re.sub(r'^1\.\s*Yes,?\s*', '', rows[y]),
		                      'motif': ' '.join(rows[i:i + 2]), 'choix': oui_non(y)}))
	i = last(BOUTONS_RE.match)
	if i:
		above = rows[max(0, i - 2):i]
		found.append((i, {'genre': 'blast', 'commande': above[-1], 'motif': above[0] if len(above) == 2 else '', 'choix': []}))
	i = last(CASE_RE.match)
	if i is not None and 'Submit' in rows[i + 1:]:
		found.append((i + 1 + rows[i + 1:].index('Submit'), {'genre': 'question', 'commande': '', 'motif': '', 'choix': []}))
	if not found:
		return None
	end, perm = max(found, key=lambda f: f[0])
	return perm if len(rows) - 1 - end <= PIED else None


def perm_sig(perm):
	"""Empreinte d'une demande (le compte à rebours de blast-radius n'en fait pas partie)."""
	return sha('\x1f'.join((perm['genre'], perm['commande'], perm['motif'])))[:16]


def lire_ecran(panel):
	"""Bas de l'écran d'un terminal, ou None si la lecture échoue. Toujours hors transaction."""
	code, out, _ = RUN(['cate', 'terminal', 'read', '--panel', panel, '--lines', '200'], timeout=SCREEN_TIMEOUT)  # 40 perdait le haut du cadre d'une longue commande
	return out if code == 0 else None


def ecrans_a_lire(snap, agents):
	"""Panneaux d'agents bloqués (même test que tick) portés par un besoin ouvert."""
	ouverts = {p for n in snap['needs'] if n['status'] == 'open' for p in n['panels']}
	return [a['panelId'] for a in agents
	        if a['panelId'] in ouverts and a['state'] == 'waitingForInput' and not a.get('canReceivePrompt', True)]


def set_perm(n, panel, text):
	"""Demande lue à l'écran du panneau bloqué. Lecture échouée (None) : on garde ce qu'on savait."""
	if text is None:
		return
	perm = parse_ecran(text)
	n['perm'] = dict(perm, panel=panel) if perm else None
	if n.get('permAnswered') and (not perm or perm_sig(perm) != n['permAnswered']):
		n['permAnswered'] = n['permNonConfirmee'] = None


def orphelins(st, rows, agents):
	"""Terminaux sans agent que l'humain voudra peut-être fermer : {panneau: titre}. Un seul critère (décision n271) :
	terminal titré « #n<chiffres> » sans agent vivant (ni running ni waitingForInput). Jamais : panneau du projet ou
	d'un besoin ouvert, gardé, terminal qui appelle."""
	vivants = {a['panelId'] for a in agents if a.get('state') in ('running', 'waitingForInput')}
	return {p: r['title'] for p, r in rows.items()
	        if r.get('type') == 'terminal' and re.match(r'^#n\d+ ', r.get('title') or '') and p not in vivants
	        and not r.get('caller') and p not in st['orphanGardes'] and not protege(st, p, None)}


def tick(st, live, agents, gh, now, screens=None, panneaux=None, usage=None):
	"""Un tour du régisseur : met l'état à jour, rend les effets ('close', panneau, besoin) et ('notify', panneau, texte).
	screens : écran lu de chaque agent bloqué ({panneau: texte}), pour afficher sa demande.
	panneaux : lignes de cate panel list par id ; sans elles, pas de balayage des orphelins."""
	screens = screens or {}
	orch = st['panels'].get('orchestrator')
	effects = []
	notified = set(st['notified'])

	def once(key, panel, msg):
		if key not in notified:
			notified.add(key)
			effects.append(('notify', panel, msg))

	for n in st['needs']:  # fermeture voulue (apply) mais interrompue avant ses effets : on la reprend, idempotent
		if n['status'] == 'done' and n.get('closing'):
			todo = [p for p in n['panels'] if p in live and p != n.get('closeSkip') and not protege(st, p, n['id'])]
			if todo and not n['closeFailed']:
				effects += [('close', p, n['id']) for p in todo]
			elif not todo:
				n['closing'] = False  # plus rien d'éligible : la fermeture voulue est finie

	by_panel = {a['panelId']: a for a in agents}
	for n in st['needs']:
		if n['status'] != 'open':
			continue
		ref_state = gh.get(n['ref'] or '') if n['kind'] in ('pr', 'issue') else None
		m = re.match(r'^(pr-merged|issue-closed):(\d+)$', n['doneWhen'] or '')
		cond = gh.get(m.group(2)) if m else None
		done_by = None
		if ref_state and n['kind'] == 'pr' and ref_state['state'] == 'CLOSED':
			close_need(st, n['id'], 'dropped')
			effects += [('close', p, n['id']) for p in n['panels'] if p in live]
			effects.append(('notify', orch, f"PR #{n['ref']} fermée sans merge : {n['title']} abandonné."))
			continue
		if ref_state and ref_state['state'] in ('MERGED', 'CLOSED'):
			done_by = ref_state
		elif cond and cond['state'] == ('MERGED' if m.group(1) == 'pr-merged' else 'CLOSED'):
			done_by = cond
		if done_by:
			close_need(st, n['id'], 'done', done_by.get('url') or done_by['state'])
			effects += [('close', p, n['id']) for p in n['panels'] if p in live]
			if n['owner'] == OWNER_HUMAIN:
				effects.append(('notify', orch, f"Fait par {nom()} : {n['title']} ({done_by['state']})."))
			continue
		in_flight = n['kind'] == 'draft' and any(d['id'] == n['ref'] and (d['statut'] == 'envoyer' or d.get('incertain')) for d in st['drafts'])
		if n['panels'] and not any(p in live for p in n['panels']) and not in_flight:
			close_need(st, n['id'], 'dropped')
			if n['kind'] == 'draft':
				with contextlib.suppress(Refus):
					d = find(st, 'drafts', n['ref'])
					if d['statut'] == 'à valider':
						d['statut'] = 'abandonné'
			continue
		blocked, seen = [], False  # panneaux d'agents bloqués du besoin : un seul libre ne le débloque pas
		for p in n['panels']:
			a = by_panel.get(p)
			if not a:
				continue
			seen = True
			if a['state'] == 'waitingForInput' and not a.get('canReceivePrompt', True):
				blocked.append(p)
				once(f"blocked:{p}:{n['id']}", orch, f"Agent {a.get('title') or p} bloqué (permission ou question) sur {n['id']}.")
			if a['state'] == 'finished':
				once(f"finished:{p}", orch, f"Agent {a.get('title') or p} a fini ({n['id']}) : lis son rapport, puis agence need done {n['id']} --evidence ...")
		if seen:
			n['agentBlocked'] = bool(blocked)
			if blocked:
				lus = [(p, screens[p]) for p in blocked if screens.get(p) is not None]
				p, texte = next((x for x in lus if parse_ecran(x[1])), lus[0] if lus else (blocked[0], None))  # la première demande trouvée
				n['blockedPanel'] = p
				set_perm(n, p, texte)
			else:
				n['perm'] = n['permAnswered'] = n['permNonConfirmee'] = None
		agent = next((by_panel[p] for p in n['panels'] if p in by_panel), None)
		if agent:  # lus dans cate agent list ; absents tant que l'app n'a pas le build qui les rend
			n['seen'] = {'model': agent.get('model'), 'effort': agent.get('effort')}
		for p in n['panels']:  # dernier coût lu par panneau : un panneau fermé ne le fait pas retomber
			c = (usage or {}).get(p)
			if cout_valide(c):
				n.setdefault('costByPanel', {})[p] = c
			elif p in (usage or {}):  # agent connu de Cate sans coût lisible (tiret, négatif, NaN) : inconnu, sans effacer un coût déjà lu
				n.setdefault('costByPanel', {}).setdefault(p, None)
		c = cout_besoin(n)
		if n.get('budgetUsd') and c is not None and c > n['budgetUsd'] and not n.get('overBudgetUsd'):
			n['overBudget'] = n['overBudgetUsd'] = True
			once(f"budget-usd:{n['id']}", orch, f"Budget de {n['budgetUsd']:.2f} $ dépassé (coût {dollars(c)}) : {n['title']} ({n['id']}).")
		if n['budgetMin'] and now - n.get('createdTs', now) > n['budgetMin'] * 60:
			n['overBudget'] = True
			once(f"budget:{n['id']}", orch, f"Budget de {n['budgetMin']} min dépassé : {n['title']} ({n['id']}).")
	if panneaux is not None:  # un orphelin n'est proposé qu'au 2e tour ; l'offre se clôt si le panneau meurt ou n'en est plus un
		candidats = orphelins(st, panneaux, agents)
		st['orphanVus'] = {p: st['orphanVus'].get(p, 0) + 1 for p in candidats}
		st['orphanGardes'] = [p for p in st['orphanGardes'] if p in panneaux]
		for n in st['needs']:
			if n['status'] == 'open' and n.get('orphan') and n['orphan']['panel'] not in candidats:
				close_need(st, n['id'], 'dropped')
		for p, titre in candidats.items():
			if st['orphanVus'][p] >= 2:
				n, neuf = add_need(st, 'human', f'Fermer le panneau « {titre} » (sans agent) ?', ref=f'orphan:{p}', owner=OWNER_HUMAIN)
				if neuf:
					n['orphan'] = {'panel': p, 'title': titre}
	for n in st['needs']:  # une notification par ligne qui attend, un rappel, puis rien ; le réglage se relit à chaque tour
		if not attend(n):
			n.pop('notifTs', None)  # la ligne repart de zéro si elle attend de nouveau
			n.pop('notifRappel', None)
		elif st['notify']:
			if 'notifTs' not in n:
				n['notifTs'], prefixe = now, ''
			elif not n.get('notifRappel') and now - n['notifTs'] >= RAPPEL:
				n['notifRappel'], prefixe = True, 'Rappel : '
			else:
				continue
			effects.append(('toast', n['id'], (st['repo'], f"{prefixe}{n['id']} {n['title']} : {action_attendue(st, n)}")))
	mine = [a for a in agents if a['panelId'] not in (orch, st['panels'].get('regisseur'))]
	active = len([a for a in mine if a.get('state') == 'running'])
	waiting = len([a for a in mine if a.get('state') == 'waitingForInput'])
	vivants = active + waiting
	if st['agentsActive'] + st['agentsWaiting'] >= plafond(st) > vivants:
		effects.append(('notify', orch, f'Une place est libre : {vivants} en cours sur {plafond(st)}.'))
	st['agentsActive'] = active
	st['agentsWaiting'] = waiting
	st['notified'] = sorted(notified)
	return effects


def apply(st, effects):
	"""File les effets ('close', panneau, besoin) et ('notify', panneau, texte) ; tx() les joue après son verrou.
	La fermeture voulue est écrite avec l'état (need['closing']) : un arrêt avant les effets est repris par tick()."""
	for kind, _, arg in effects:
		if kind == 'close':
			with contextlib.suppress(Refus):
				find(st, 'needs', arg)['closing'] = True
	st.setdefault('_after', []).extend(effects)


def agents_by_panel():
	with contextlib.suppress(Refus):
		rows = cate('agent', 'list')
		return {a['panelId']: a for a in (rows if isinstance(rows, list) else rows.get('agents', []))}
	return {}


def protege(st, panel, nid):
	"""Panneau du projet (orchestrateur, régisseur, suivi) ou rattaché à un autre besoin ouvert : jamais forcé."""
	return panel in st['panels'].values() or any(
		n['id'] != nid and n['status'] == 'open' and panel in n['panels'] for n in st['needs'])


def forcable(snap, panel, nid):
	"""--discard seulement pour un panneau lancé pour CE besoin par l'orchestrateur (état, pas titre) et clos avec preuve.
	Un panneau rattaché par un autre appelant, ou dans un état écrit avant ce champ, n'est jamais forcé."""
	need = next((n for n in snap['needs'] if n['id'] == nid), None)
	if not need or need['status'] != 'done' or protege(snap, panel, nid) or panel not in need.get('launched', []):
		return False
	a = agents_by_panel().get(panel)  # état de CET agent à l'instant, pas celui du début du lot
	return bool(a and a.get('state') == 'waitingForInput' and a.get('canReceivePrompt', True))


def run_after(effects, base=None):
	"""Joue les effets hors transaction. Ferme sans --discard ; sur refus, un agent qui attend une saisie à cet instant
	et que rien ne protège se ferme avec --discard ; le reste (plein tour, éditeur non enregistré) reste : closeFailed."""
	snap = load(state_file(base))
	failed, closed = set(), []
	for kind, panel, arg in effects:
		if kind == 'toast':
			toast(*arg)
			continue
		if kind == 'notify':
			notify(panel, arg)
			continue
		if panel in snap['panels'].values():
			continue
		try:
			cate('panel', 'close', panel)
		except Refus as err:
			if 'dirty' in str(err) or '--discard' in str(err):
				try:
					if '--discard' not in str(err) or not forcable(snap, panel, arg):
						raise Refus('reste')
					cate('panel', 'close', panel, '--discard')
				except Refus:
					failed.add(arg)
			elif 'gone' not in str(err):
				log(f'fermeture de {panel} : {err}')
		if arg not in closed:
			closed.append(arg)
	live = live_rows() or {}
	offers = [o for nid in closed for o in worktree_offers(snap, nid, live, base)]
	if failed or offers:
		with tx(base) as st:
			for nid in failed:
				with contextlib.suppress(Refus):
					find(st, 'needs', nid)['closeFailed'] = True
			for nid, path, branch in offers:
				n, _ = add_need(st, 'human', f'Supprimer le worktree {os.path.basename(path)} (branche {branch} mergée) ?',
				                ref=f'wt:{path}', owner=OWNER_HUMAIN, source=nid)
				n['worktree'] = {'path': path, 'branch': branch}


def worktree_ok(repo, path, branch):
	"""Preuve positive qu'on peut proposer ou supprimer : worktree sans modification, et une PR mergée dont la tête est
	le SHA actuel de la branche. « git branch --merged » ne prouve rien (une branche neuve, tip = base, y est)."""
	code, tip, _ = RUN(['git', '-C', path, 'rev-parse', 'HEAD'])
	code2, dirty, _ = RUN(['git', '-C', path, 'status', '--porcelain'])
	return bool(repo and code == 0 and code2 == 0 and not dirty.strip() and pr_mergee(repo, branch, tip.strip()))


def worktree_offers(snap, nid, live, base=None):
	"""Worktrees du besoin (nom « <besoin>-<rôle> », voir le skill) à proposer à l'humain : [(besoin, chemin, branche)].
	Jamais tant qu'un panneau vivant du besoin existe, jamais supprimés ici."""
	need = next((n for n in snap['needs'] if n['id'] == nid), None)
	if not need or any(p in live for p in need['panels']):
		return []
	code, out, _ = RUN(['git', '-C', base or root(), 'worktree', 'list', '--porcelain'])
	if code != 0:
		return []
	found = []
	for block in out.strip().split('\n\n')[1:]:  # le premier est le dépôt principal
		f = dict(line.split(' ', 1) for line in block.splitlines() if ' ' in line)
		path, branch = f.get('worktree'), (f.get('branch') or '').removeprefix('refs/heads/')
		if path and branch and os.path.basename(path).startswith(f'{nid}-'):
			found.append((path, branch))
	repo = gh_repo(snap) if found else None
	return [(nid, p, b) for p, b in found if worktree_ok(repo, p, b)]


def pr_mergee(repo, branch, tip):
	"""Une PR mergée a cette branche pour tête et ce SHA pour dernier commit (un merge en rebase laisse la branche hors de
	« git branch --merged » ; une branche repartie après le merge n'est pas mergée)."""
	code, out, _ = RUN(['gh', 'pr', 'list', '-R', repo, '--head', branch, '--state', 'merged', '--json', 'number,headRefOid',
	                    '--limit', '5'], timeout=GH_TIMEOUT)
	try:
		return code == 0 and bool(tip) and any(p.get('headRefOid') == tip for p in json.loads(out))
	except (ValueError, TypeError, AttributeError):
		return False


def pluriel(n, mot):
	return f"{n} {mot}{'s' if n > 1 else ''}"


def verdict_relance(faits):
	"""(oui, lignes) : peut-on relancer Cate sans rien perdre ? Pure : les faits sont déjà lus par lire_faits_relance.
	Les lignes « non » viennent avant les lignes « info » ; sans cause bloquante, la première ligne est « oui »."""
	non, info = [], []
	if faits['running']:
		non.append(f"{pluriel(len(faits['running']), 'agent')} en plein tour ({', '.join(faits['running'])})")
	for nom_wt, sale, ahead in faits['worktrees']:
		raisons = (['modifications non commitées'] if sale else []) + ([pluriel(ahead, 'commit') + ' non poussé' + 's' * (ahead > 1)] if ahead else [])
		if raisons:
			non.append(f"worktree {nom_wt} : {', '.join(raisons)}")
	non += [f'{source} illisible ({err})' for source, err in faits['illisibles']]
	if faits['waiting']:
		info.append(f"{pluriel(len(faits['waiting']), 'agent')} en attente de saisie ({', '.join(faits['waiting'])})")
	info += [f'PR ouverte #{num} {titre}' for num, titre in faits['prs']]  # une PR ne se perd pas au redémarrage
	if faits['daemon'] and faits['daemon'][0] != faits['daemon'][1]:
		info.append(f"daemon à redémarrer (build {faits['daemon'][0]}, app {faits['daemon'][1]}) : terminaux et agents arrêtés")
	lignes = [f'non : {x}' for x in non] if non else ['oui']
	return not non, lignes + [f'info : {x}' for x in info]


def repo_origin(base):
	"""owner/repo du remote origin, formes ssh et https ; ValueError si origin est absent ou pas sur GitHub."""
	code, out, err = RUN(['git', '-C', base, 'remote', 'get-url', 'origin'])
	m = re.search(r'github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$', out.strip()) if code == 0 else None
	if not m:
		raise ValueError(f"remote origin illisible : {(err or out).strip() or 'vide'}")
	return m.group(1)


def lire_faits_relance(st, base=None):
	"""Lit, sans rien écrire, ce que verdict_relance juge. Une lecture en échec s'ajoute à « illisibles » (jamais un faux oui)."""
	base = base or root()
	faits = {'running': [], 'waiting': [], 'worktrees': [], 'prs': [], 'daemon': None, 'illisibles': []}

	def illisible(source, err):
		faits['illisibles'].append((source, ' '.join(str(err).split()) or 'sortie vide'))

	try:
		agents = cate('agent', 'list')
		agents = agents if isinstance(agents, list) else agents.get('agents', [])
		rows = cate('panel', 'list')
		ignores = set(st['panels'].values()) | {r['panelId'] for r in rows if r.get('caller')}
		for a in agents:
			if a['panelId'] not in ignores:
				cible = faits['running'] if a.get('state') == 'running' else faits['waiting'] if a.get('state') == 'waitingForInput' else None
				if cible is not None:
					cible.append(a.get('title') or a['panelId'])
	except (Refus, ValueError, TypeError, KeyError, AttributeError) as err:
		illisible('cate', err)

	code, out, err = RUN(['git', '-C', base, 'worktree', 'list', '--porcelain'])
	if code != 0:
		illisible('git', err or out)
	else:
		for block in out.strip().split('\n\n')[1:]:  # le premier est le dépôt principal
			f = dict((line.split(' ', 1) + [''])[:2] for line in block.splitlines())
			path = f.get('worktree')
			if not path or 'prunable' in f:  # dossier disparu : rien à perdre, git worktree prune le retire
				continue
			c1, dirty, e1 = RUN(['git', '-C', path, 'status', '--porcelain'])
			c2, ahead, e2 = RUN(['git', '-C', path, 'rev-list', '--count', '@{u}..HEAD'])
			if c2 != 0:  # sans upstream : les commits qu'aucune branche distante ne porte
				c2, ahead, e2 = RUN(['git', '-C', path, 'rev-list', '--count', 'HEAD', '--not', '--remotes'])
			try:
				if c1 != 0 or c2 != 0:
					raise ValueError(e1 or e2)
				faits['worktrees'].append((os.path.basename(path), bool(dirty.strip()), int(ahead)))
			except ValueError as err:
				illisible('git', f'{os.path.basename(path)} : {err}')

	try:
		repo = repo_origin(base)  # le dépôt du fork : le défaut de gh (gh repo view) vise l'upstream
		code, out, err = RUN(['gh', 'pr', 'list', '-R', repo, '--state', 'open', '--json', 'number,title,headRefName'], timeout=GH_TIMEOUT)
		if code != 0:
			raise ValueError(err or out)
		faits['prs'] = [(p['number'], p['title']) for p in json.loads(out)]
	except (ValueError, TypeError, KeyError) as err:
		illisible('gh', err)

	home = os.environ.get('CATE_HOME') or os.path.expanduser('~/.cate')
	try:
		build = None
		for f in glob.glob(os.path.join(home, 'workspaces', '*', 'runtime.json')):
			with contextlib.suppress(OSError, ValueError, AttributeError):
				with open(f) as fh:
					j = json.load(fh)
				if os.path.realpath(j['root']) == os.path.realpath(base):
					build = j['build']
					break
		if not build:
			raise ValueError('runtime.json de ce projet introuvable ou illisible')
		with open(os.path.join(home, 'runtime', 'current')) as fh:
			faits['daemon'] = (build, fh.read().strip())
	except (OSError, ValueError) as err:
		illisible('daemon', err)
	return faits


PYTHON_MIN = (3, 9)
# Réglages CLI du workspace que l'orchestrateur emploie, et leur défaut dans Cate (src/kernel/api/contract/settings.ts).
CLI_REGLAGES = {'cliEnabled': True, 'cliPanelReadEnabled': True, 'cliPanelControlEnabled': True, 'cliAgentReadEnabled': True,
                'cliAgentControlEnabled': True, 'cliTerminalReadEnabled': True, 'cliTerminalInputEnabled': False,
                'cliSkillInstallEnabled': True}
INPUT_TERMINAL = "Réglages de Cate > Workspace > CLI : cocher Terminal, colonne control (cliTerminalInputEnabled, coupé par défaut)"
MAJ_CATE = "attendre la mise à jour automatique (cate-fork-update), ou recoller la ligne d'amorçage"
# Points qui exigent un terminal Cate ou un Cate déjà démarré : `info` sous --hors-cate (l'amorçage ne lance jamais Cate).
DANS_CATE = ('terminal Cate', 'CLI livrée', 'agent start --model', 'agent usage', 'type agence', 'réglages CLI', 'skill')


def prerequis(hors_cate=False):
	"""Points de `doctor --prerequis` : (point, état ok|manque|info, bloquant, détail, commande qui règle). Lecture seule.
	hors_cate : les points de DANS_CATE sortent en `info` et `cate` n'est jamais lancé."""
	points = []

	def point(nom_, ok, bloquant, detail, commande, info=False):
		points.append({'point': nom_, 'etat': 'ok' if ok else 'info' if info else 'manque', 'bloquant': bloquant,
		               'detail': detail, 'commande': None if ok else commande})

	def aide(*args):
		if hors_cate:
			return 1, ''
		code, out, err = RUN(['cate', *args, '--help'], timeout=10)
		return code, out + err

	v = sys.version_info
	point('python3', v[:2] >= PYTHON_MIN, True, f'{v[0]}.{v[1]}.{v[2]} (3.9 au moins)', 'xcode-select --install')
	sock = os.environ.get('CATE_SOCKET')
	joignable = False
	if sock:
		with contextlib.suppress(OSError), socket.socket(socket.AF_UNIX) as s:
			s.settimeout(2)
			s.connect(sock)
			joignable = True
	point('terminal Cate', joignable, True, f'socket {sock} ' + ('joignable' if joignable else 'injoignable') if sock else 'CATE_SOCKET absent',
	      'ouvrir un terminal Cate')
	runtime = os.path.join(os.environ.get('CATE_HOME') or os.path.expanduser('~/.cate'), 'runtime')
	try:
		with open(os.path.join(runtime, 'current')) as f:
			build = f.read().strip()
	except OSError:
		build = ''
	livree = bool(build) and os.path.isfile(os.path.join(runtime, build, 'agence', 'agence'))
	point('CLI livrée', livree, True, f"agence/ dans l'install {build or '(runtime/current absent)'}", MAJ_CATE)
	code, out = aide('agent', 'start')
	point('agent start --model', code == 0 and '--model' in out, True, 'cate agent start --help cite --model', MAJ_CATE)
	code, out = aide('agent', 'usage')
	point('agent usage', code == 0, True, f'cate agent usage --help : code {code}', MAJ_CATE)
	code, out = aide('panel', 'create')
	point('type agence', code == 0 and re.search(r'\bagence\b', out) is not None, True, 'cate panel create --help cite le type agence', MAJ_CATE)
	fichier = os.path.join(os.path.dirname(sock), 'settings.json') if sock else None
	try:
		if not fichier:
			raise ValueError('hors terminal Cate')
		try:
			with open(fichier) as f:
				lus = json.load(f)
		except FileNotFoundError:
			lus = {}
		if not isinstance(lus, dict):
			raise ValueError('objet attendu')
		coupes = [k for k, d in CLI_REGLAGES.items() if lus.get(k, d) is not True]
		detail = 'à false : ' + ', '.join(coupes) if coupes else 'tous actifs'
		commande = '; '.join(([SETTINGS_HINT] if set(coupes) - {'cliTerminalInputEnabled'} else [])
		                     + ([INPUT_TERMINAL] if 'cliTerminalInputEnabled' in coupes else []))
	except (OSError, ValueError) as err:
		coupes, detail, commande = [None], f'{fichier or "réglages du workspace"} illisible : {err}', SETTINGS_HINT
	point('réglages CLI', not coupes, True, detail, commande)
	code, _, err = RUN(['gh', 'auth', 'status'], timeout=10)
	point('gh', code == 0, True, 'gh auth status' + ('' if code == 0 else f' : {" ".join(err.split())[:120]}'), 'gh auth login')
	code, out, _ = RUN(['claude', '--version'], timeout=10)
	point('claude', code == 0, True, f'claude --version : {out.strip() or "code " + str(code)}',
	      'installeur officiel de Claude Code : curl -fsSL https://claude.ai/install.sh | bash')
	statut = hooks_statut()
	point('gardes', statut == 'actif', True, f'gardes agence {statut} ({settings_defaut()})', 'agence hooks install')
	skill = os.path.join(root(), '.claude', 'skills', 'orchestrateur', 'SKILL.md')
	point('skill', os.path.isfile(skill), False, skill, "créer .claude/ dans le dépôt puis rouvrir le workspace dans Cate")
	n, source = nom_source()
	point('nom', source != 'défaut', False, f'{n} ({source})', 'git config --global agence.nom <Prénom>', info=True)
	point('Slack, Gmail', False, False, 'non lisible depuis la CLI', 'brancher les connecteurs dans Claude Code', info=True)
	for p in points if hors_cate else ():
		if p['point'] in DANS_CATE:
			p.update(etat='info', detail='à vérifier dans un terminal Cate', commande='agence doctor --prerequis')
	return points


def cmd_doctor(a):
	if a.prerequis:
		points = prerequis(a.hors_cate)
		ok = not any(p['bloquant'] and p['etat'] == 'manque' for p in points)
		if a.json:
			print(json.dumps({'ok': ok, 'points': points}, ensure_ascii=False))
		else:
			for p in points:
				print('\t'.join([p['etat'], p['point'], p['detail']] + ([f"→ {p['commande']}"] if p['commande'] else [])))
		return 0 if ok else 1
	require_cate()
	oui, lignes = verdict_relance(lire_faits_relance(load()))
	print('\n'.join(lignes))
	return 0 if oui else 1


def read_token_stdin():
	"""Jeton des formulaires donné par le processus parent : première ligne de stdin, 24 caractères au moins."""
	token = sys.stdin.readline().strip()
	if len(token) < 24:
		raise Env('--token-stdin : jeton d\'au moins 24 caractères attendu sur la première ligne de stdin')
	return token


def lire_usage():
	"""Coût (dollars équivalent API) par panneau d'agent vivant, de cate agent usage ; None si refusé ou illisible."""
	try:
		rows = cate('agent', 'usage')
	except Refus:
		return None
	if not isinstance(rows, list):
		return None
	return {r['panelId']: r.get('costUsd') for r in rows if isinstance(r, dict) and 'panelId' in r}


def un_tour():
	rows = live_rows()
	if rows is None:
		raise Refus('cate panel list illisible : tour sauté')
	agents = cate('agent', 'list')
	agents = agents if isinstance(agents, list) else agents.get('agents', [])
	snap = load()
	gh, merges = lire_github(snap)  # hors transaction : un gh lent ne bloque ni la boucle ni les clics
	# ponytail: lecture en série, 5 s au pire par agent bloqué (6 au plus) ; en parallèle si ça gêne
	screens = {p: lire_ecran(p) for p in ecrans_a_lire(snap, agents)}  # hors transaction aussi
	usage = lire_usage()  # idem : une lecture par tour, None si Cate la refuse
	garde = hooks_statut()  # gardes du HOME courant, lus hors transaction ; le panneau affiche une bannière sauf « actif »
	with tx() as st:
		st['titles'] = {p: r.get('title') or '' for p, r in rows.items()}
		st['ghRepo'] = st['ghRepo'] or snap['ghRepo']
		st['humain'] = nom()  # le panneau titre « À faire par <nom> » avec
		merge_apply(st, merges)
		st['garde'] = garde
		effects = tick(st, set(rows), agents, gh, time.time(), screens, rows, usage)
		apply(st, effects)
	for eff in effects:
		log(f'{eff[0]} {eff[1]} {eff[2]}')


def cmd_watch(a):
	global TOKEN, PAGES
	require_cate()
	st = load()
	if not st['port']:
		raise Refus("pas de port : l'orchestrateur lance d'abord « agence boot »")
	if a.token_stdin:
		TOKEN = read_token_stdin()
		PAGES = False
	try:
		server = http.server.ThreadingHTTPServer(('127.0.0.1', st['port']), Pages)
	except OSError as err:
		raise Env(f"régisseur déjà actif sur {st['port']} ({err.strerror})")
	threading.Thread(target=server.serve_forever, daemon=True).start()
	stop = threading.Event()
	if a.token_stdin:  # fin de stdin = le parent est mort : on s'arrête avec lui
		threading.Thread(target=lambda: (sys.stdin.read(), stop.set()), daemon=True).start()
	log(f"régisseur sur http://127.0.0.1:{st['port']}/ (Ctrl-C pour arrêter)")
	while not stop.is_set():
		try:
			un_tour()
		except Refus as err:
			log(str(err))
		stop.wait(a.interval)
	server.shutdown()
	return 0


# ---------- garde (hook PreToolUse) ----------

def decision(kind, reason):
	return {'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': kind,
	                               'permissionDecisionReason': reason}}


FETCH_RE = re.compile(r'\b(curl|wget|http|https|xh|nc|python3?|node|ruby|perl|open|osascript)\b')
WRITE_RE = re.compile(r'(>|sed -i|\btee\b|\bmv\b|\bcp\b|\brm\b|python|perl|truncate|\bjq\b.*>)')
PAGE_DENY = "Les pages du régisseur sont pour l'humain : un agent ne clique pas à sa place."
STATE_DENY = "state.json s'écrit seulement par la CLI agence."


def send_match(st, tool, ti):
	"""Brouillon cliqué, pas encore utilisé, besoin ouvert, dont la cible et le texte sont exactement ceux de l'envoi."""
	for d in st['drafts']:
		if d['statut'] != 'envoyer' or d.get('allowed') or d['texte'] is None:
			continue
		with contextlib.suppress(Refus):
			if find(st, 'needs', d['needId'])['status'] != 'open':
				continue
		if d['cible'].startswith('mail:'):
			if (ti.get('to') == [d['cible'][5:]] and not ti.get('cc') and not ti.get('bcc') and not ti.get('htmlBody')
					and not ti.get('draftId') and not ti.get('attachments')
					and d['texte'] == (ti.get('body') or '').strip() and (not d['titre'] or d['titre'] == ti.get('subject'))):
				return d
	return None


def est_envoi(tool):
	return tool.endswith('slack_send_message') or tool.endswith('Gmail__send_message')


def envoi_ask(tool):
	return decision('ask', f'Envoi au nom de {nom()} ({tool}) : brouillon seulement, {nom()} confirme chaque envoi '
	                       "(seul un brouillon agence cliqué, cible et texte identiques, passe sans question).")


def guard(payload, mode=None):
	"""Décision PreToolUse ou None. mode 'send' : jamais None (ask sauf brouillon cliqué identique, aucune exception
	de canal) ; 'pages' : pages du régisseur et state.json seulement ; None : les deux, sans ask (hooks d'avant le lot 3)."""
	tool = payload.get('tool_name') or ''
	ti = payload.get('tool_input') or {}
	refus = envoi_ask(tool) if mode == 'send' else None
	if mode and (mode == 'send') != est_envoi(tool):
		return refus
	base = os.environ.get('CLAUDE_PROJECT_DIR') or payload.get('cwd') or os.getcwd()
	if not os.path.isfile(state_file(base)):
		base = main_repo(base) or base
	if not os.path.isfile(state_file(base)):
		return refus
	st = load(state_file(base))
	if est_envoi(tool):
		d = send_match(st, tool, ti)
		if not d:
			return refus
		with tx(base) as cur:  # une autorisation par clic : la suivante redemande
			d = send_match(cur, tool, ti)
			if not d:
				return refus
			d['allowed'] = True
		return decision('allow', f"Brouillon {d['id']} validé par le clic de {nom()} (cible et texte identiques).")
	port = st.get('port')
	local = re.compile(rf'(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):{port}\b') if port else None
	if tool == 'Bash':
		cmd = ti.get('command') or ''
		if local and local.search(cmd):
			return decision('deny', PAGE_DENY)
		if FETCH_RE.search(cmd) and ('agence url' in cmd or re.search(r'127\.0\.0\.1|localhost', cmd)):
			return decision('deny', PAGE_DENY)
		if re.search(r'\bcate\s+browser\b', cmd):
			pages = [p for n in st['needs'] if n['status'] == 'open' and n['kind'] in ('draft', 'human') for p in n['panels']]
			pages += [st['panels'].get('suivi')] if st['panels'].get('suivi') else []
			if any(p and p in cmd for p in pages) or re.search(r'/(draft|ask)/', cmd):
				return decision('deny', PAGE_DENY)
		if 'state.json' in cmd and WRITE_RE.search(cmd) and ('agence' in cmd or '.cate/tmp/agence' in (payload.get('cwd') or '')):
			return decision('deny', STATE_DENY)
		return None
	if tool == 'WebFetch' and local and local.search(ti.get('url') or ''):
		return decision('deny', PAGE_DENY)
	if tool in ('Write', 'Edit', 'MultiEdit') and (ti.get('file_path') or '').endswith('.cate/tmp/agence/state.json'):
		return decision('deny', STATE_DENY)
	return None


def cmd_guard(a):
	if a.mode == 'send':  # échec fermé : toute erreur rend ask (agence-hook rend aussi ask si ce processus échoue)
		try:
			payload = json.loads(sys.stdin.read())
			res = guard(payload, 'send') if isinstance(payload, dict) else envoi_ask('?')
		except Exception as err:  # noqa: BLE001 : aucune exception ne doit laisser passer un envoi
			res = decision('ask', f'garde agence en échec ({type(err).__name__}) : envoi à confirmer')
		print(json.dumps(res, ensure_ascii=False))
		return 0
	try:
		payload = json.loads(sys.stdin.read() or '{}')
	except json.JSONDecodeError:
		return 0
	res = guard(payload, a.mode) if isinstance(payload, dict) else None
	if res:
		print(json.dumps(res, ensure_ascii=False))
	return 0


# ---------- gardes dans ~/.claude/settings.json (agence hooks) ----------
# Écrites seulement sur la commande de l'humain (ou de l'amorçage qu'il a collé) ; Cate ne lance jamais agence hooks.
# Texte figé : contracts/hooks.md de la spec 002, comparé par test_hooks.py à fixtures/settings/settings-attendu.json.

HOOK_MARQUE = 'agence-hook'  # une entrée agence se reconnaît à sa commande, rien d'autre n'est lu ni modifié
_HOOK_SH = 'sh -c \'f="$HOME/.cate/runtime/$(cat "$HOME/.cate/runtime/current" 2>/dev/null)/agence/agence-hook"; [ -x "$f" ] && exec "$f" %s\''
ASK_INTROUVABLE = "garde agence introuvable : envoi à confirmer"
HOOK_ENTREES = [
	{'matcher': 'mcp__.*(slack_send_message|slack_schedule_message|Gmail__(send_message|reply|forward))$',
	 'hooks': [{'type': 'command', 'command': _HOOK_SH % ('send; printf %s "{\\"hookSpecificOutput\\":{\\"hookEventName\\":\\"PreToolUse\\",'
	                                                       '\\"permissionDecision\\":\\"ask\\",\\"permissionDecisionReason\\":\\"' + ASK_INTROUVABLE + '\\"}}"')}]},
	{'matcher': 'Bash|WebFetch|Write|Edit|MultiEdit',
	 'hooks': [{'type': 'command', 'command': _HOOK_SH % 'pages; exit 0'}]},
]


def settings_defaut():
	return os.path.join(os.path.expanduser('~'), '.claude', 'settings.json')


def _sans_doublon(paires):
	d = {}
	for k, v in paires:
		if k in d:
			raise ValueError(f'clé « {k} » en double')
		d[k] = v
	return d


def lire_settings(path):
	"""settings.json lu strictement : None si absent ; Env (code 2, rien écrit) si illisible ou de forme inattendue."""
	try:
		with open(path, encoding='utf-8-sig') as f:
			data = json.load(f, object_pairs_hook=_sans_doublon)
	except FileNotFoundError:
		return None
	except (OSError, UnicodeDecodeError, ValueError) as err:
		raise Env(f'{path} illisible, rien écrit (JSON strict attendu : ni commentaire ni virgule finale, clés uniques) : {err}')
	hooks = data.get('hooks', {}) if isinstance(data, dict) else None
	pre = hooks.get('PreToolUse', []) if isinstance(hooks, dict) else None
	if not isinstance(pre, list) or not all(isinstance(e, dict) and isinstance(e.get('hooks', []), list) for e in pre):
		raise Env(f'{path} : forme inattendue (objet, hooks objet, hooks.PreToolUse tableau d\'entrées), rien écrit')
	return data


def _est_agence(h):
	return isinstance(h, dict) and HOOK_MARQUE in str(h.get('command', ''))


def garde_statut(data):
	"""actif : les deux entrées du contrat telles quelles et aucune autre commande agence-hook ; inactif : aucune ; partiel sinon."""
	pre = ((data or {}).get('hooks') or {}).get('PreToolUse') or []
	agence_ = [h for e in pre for h in e.get('hooks', []) if _est_agence(h)]
	if not agence_:
		return 'inactif'
	return 'actif' if all(e in pre for e in HOOK_ENTREES) and len(agence_) == len(HOOK_ENTREES) else 'partiel'


def sans_gardes(data):
	"""Copie sans les commandes agence-hook ; une entrée vidée par ce retrait part, puis PreToolUse et hooks s'ils sont vides."""
	data = json.loads(json.dumps(data))
	hooks = data.get('hooks')
	if not isinstance(hooks, dict) or 'PreToolUse' not in hooks:
		return data
	pre = []
	for e in hooks['PreToolUse']:
		garde_ = [h for h in e.get('hooks', []) if not _est_agence(h)]
		if len(garde_) != len(e.get('hooks', [])):
			if not garde_:
				continue
			e = dict(e, hooks=garde_)
		pre.append(e)
	if pre:
		hooks['PreToolUse'] = pre
	else:
		del hooks['PreToolUse']
		if not hooks:
			del data['hooks']
	return data


def ecrire_settings(path, data, avant):
	"""Écrit data dans la cible de path (lien résolu), atomiquement, mode conservé ; sauvegarde datée si le fichier existait.
	Refus (Env, rien écrit) si le fichier ou un dossier à écrire n'est pas inscriptible. Rend le chemin de la sauvegarde."""
	cible = os.path.realpath(path)
	dossier, lien_dossier = os.path.dirname(cible), os.path.dirname(os.path.abspath(path))
	existe = avant is not None
	if existe and not os.access(cible, os.W_OK):
		raise Env(f'{cible} non inscriptible, rien écrit')
	try:
		os.makedirs(dossier, exist_ok=True)
	except OSError as err:
		raise Env(f'{dossier} : création impossible, rien écrit ({err.strerror})')
	for d in {dossier, lien_dossier} if existe else {dossier}:
		if not os.access(d, os.W_OK):
			raise Env(f'{d} non inscriptible, rien écrit')
	mode = stat.S_IMODE(os.stat(cible).st_mode) if existe else 0o600
	sauvegarde = None
	if existe:  # à côté du chemin nommé (~/.claude), pas dans le dossier d'un lien
		base = os.path.join(lien_dossier, f"{os.path.basename(path)}.bak-agence-{time.strftime('%Y%m%d-%H%M%S')}")
		sauvegarde, i = base, 1
		while os.path.lexists(sauvegarde):
			sauvegarde, i = f'{base}-{i}', i + 1
		try:
			with open(cible, 'rb') as src, open(sauvegarde, 'xb') as dst:
				shutil.copyfileobj(src, dst)
				dst.flush()
				os.fsync(dst.fileno())
			os.chmod(sauvegarde, mode)
		except OSError as err:
			with contextlib.suppress(OSError):
				os.remove(sauvegarde)
			raise Env(f'sauvegarde {sauvegarde} impossible, rien écrit ({err.strerror})')
	fd, tmp = tempfile.mkstemp(dir=dossier, prefix='.tmp-settings-')
	try:
		with os.fdopen(fd, 'w', encoding='utf-8') as f:
			json.dump(data, f, ensure_ascii=False, indent=2)
			f.write('\n')
			f.flush()
			os.fsync(f.fileno())
		os.chmod(tmp, mode)
		os.replace(tmp, cible)
	except BaseException as err:
		with contextlib.suppress(OSError):
			os.remove(tmp)
		if isinstance(err, OSError):
			raise Env(f'{cible} : écriture impossible, rien écrit ({err.strerror})')
		raise
	return sauvegarde


def hooks_statut(path=None):
	"""Statut des gardes du HOME courant, sans exception : un settings.json illisible ne branche aucun garde (inactif)."""
	try:
		return garde_statut(lire_settings(path or settings_defaut()))
	except Env:
		return 'inactif'


def cmd_hooks(a):
	path = a.settings or settings_defaut()
	if a.action == 'status':
		try:
			statut, detail = garde_statut(lire_settings(path)), None
		except Env as err:
			statut, detail = 'inactif', str(err)
		out = {'settings': path, 'statut': statut, 'detail': detail}
		print(json.dumps(out, ensure_ascii=False) if a.json else f"{statut} ({path}{' : ' + detail if detail else ''})")
		return 0 if statut == 'actif' else 1
	avant = lire_settings(path)
	if a.action == 'install':
		apres = avant if garde_statut(avant) == 'actif' else sans_gardes(avant or {})
		if apres is not avant:
			apres.setdefault('hooks', {}).setdefault('PreToolUse', []).extend(json.loads(json.dumps(HOOK_ENTREES)))
	else:
		apres = None if avant is None else sans_gardes(avant)
	ecrit = apres != avant
	sauvegarde = ecrire_settings(path, apres, avant) if ecrit else None
	out = {'settings': path, 'statut': garde_statut(apres), 'ecrit': ecrit, 'sauvegarde': sauvegarde}
	print(json.dumps(out, ensure_ascii=False) if a.json else
	      f"{out['statut']} ({path}) : " + (f'écrit, sauvegarde {sauvegarde}' if sauvegarde else 'écrit' if ecrit else 'rien à changer'))
	return 0


def cmd_url(a):
	st = load()
	if not st['port']:
		raise Refus('pas encore de page : agence boot')
	print(url(st, '/'))
	return 0


def cmd_preview(a):
	"""Aperçu d'un fichier que l'éditeur refuse (hors workspace) : page statique, URL file:// à ouvrir dans un panneau navigateur."""
	try:
		with open(a.fichier, encoding='utf-8') as f:
			texte = f.read()
	except OSError as err:
		raise Refus(f'lecture impossible : {err}')
	titre = html.escape(a.titre or os.path.basename(a.fichier))
	d = os.path.join(tempfile.gettempdir(), 'agence-preview')
	os.makedirs(d, exist_ok=True)
	out = os.path.join(d, hashlib.sha1(os.path.abspath(a.fichier).encode()).hexdigest()[:12] + '.html')
	with open(out, 'w', encoding='utf-8') as f:
		f.write('<!doctype html><meta charset="utf-8"><title>%s</title>'
		        '<body style="font:14px system-ui;max-width:780px;margin:24px auto;padding:0 20px">'
		        '<pre style="white-space:pre-wrap">%s</pre>' % (titre, html.escape(texte)))
	print('file://' + urllib.parse.quote(out))
	return 0


# ---------- CLI ----------

def version():
	"""Le build du runtime qui livre cette CLI (`<install>/BUILD`), `dev` hors install."""
	# Jamais d'echec a cause de BUILD : 200 octets au plus, decodage tolerant, % echappes pour argparse.
	try:
		with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, 'BUILD'), 'rb') as f:
			return f.read(200).decode('utf-8', 'replace').strip().replace('%', '%%') or 'dev'
	except (OSError, ValueError):
		return 'dev'


def parser():
	p = argparse.ArgumentParser(prog='agence', description=__doc__.split('\n\n')[0])
	p.add_argument('--version', action='version', version=version())
	sub = p.add_subparsers(dest='cmd', required=True)
	s = sub.add_parser('start')
	s.add_argument('--notify', action=argparse.BooleanOptionalAction, default=None,
	               help="notification système quand une ligne attend l'humain (activée par défaut ; --no-notify la coupe pour ce projet, relue à chaque tour)")
	s.add_argument('--max-agents', type=entier_positif, metavar='N',
	               help=f"plafond d'agents vivants pour ce projet (défaut {MAX_AGENTS} ; les agents en attente de saisie comptent, l'orchestrateur et le régisseur non)")
	s.set_defaults(fn=cmd_start)
	b = sub.add_parser('boot')
	b.add_argument('--from', dest='frm')
	b.set_defaults(fn=cmd_boot)

	n = sub.add_parser('need')
	ns = n.add_subparsers(dest='action', required=True)
	add = ns.add_parser('add')
	add.add_argument('title')
	add.add_argument('--kind', default='task', choices=KINDS)
	add.add_argument('--ref')
	add.add_argument('--owner', default='agent', choices=('agent', 'humain'), help="humain : la ligne attend l'humain (agence nom)")
	add.add_argument('--blocking', action='store_true')
	add.add_argument('--unblocks')
	add.add_argument('--panel', action='append')
	add.add_argument('--from', dest='frm')
	add.add_argument('--done-when')
	add.add_argument('--acceptance')
	add.add_argument('--budget', type=int)
	add.add_argument('--budget-usd', type=dollars_positifs, help="budget en dollars (la devise de cate agent usage, sans conversion) : le besoin passe en Bloquant au dépassement")
	add.add_argument('--model', help="modèle voulu pour l'agent du besoin (id ou alias de l'agent CLI), que l'orchestrateur passe à cate agent start --model")
	add.add_argument('--effort', choices=EFFORTS, help="niveau d'effort voulu (Claude Code), passé à cate agent start --effort")
	pa = ns.add_parser('panel')
	pa.add_argument('id')
	pa.add_argument('panel_id')
	for name in ('done', 'drop'):
		x = ns.add_parser(name)
		x.add_argument('id')
		x.add_argument('--evidence')
		x.add_argument('--close', action='store_true', help="fermer aussi ses panneaux (agent en attente de saisie : --discard ; en plein tour ou éditeur non enregistré : reste) et proposer de supprimer ses worktrees mergés")
	lg = ns.add_parser('log')
	lg.add_argument('id')
	lg.add_argument('text', metavar='décision')
	ns.add_parser('show').add_argument('id')
	li = ns.add_parser('list')
	li.add_argument('--open', action='store_true')
	n.set_defaults(fn=cmd_need)

	d = sub.add_parser('draft')
	ds = d.add_subparsers(dest='action', required=True)
	new = ds.add_parser('new')
	new.add_argument('texte', help='texte, ou - pour stdin')
	new.add_argument('--cible', required=True)
	new.add_argument('--titre')
	new.add_argument('--unblocks')
	new.add_argument('--from', dest='frm')
	ed = ds.add_parser('edit')
	ed.add_argument('id')
	ed.add_argument('texte', help='nouveau texte, ou - pour stdin')
	ed.add_argument('--titre')
	for name in ('show', 'drop'):
		ds.add_parser(name).add_argument('id')
	se = ds.add_parser('sent')
	se.add_argument('id')
	se.add_argument('--evidence', required=True)
	d.set_defaults(fn=cmd_draft)

	q = sub.add_parser('ask')
	q.add_argument('question')
	q.add_argument('--option', action='append')
	q.add_argument('--merge')
	q.add_argument('--unblocks')
	q.add_argument('--from', dest='frm')
	q.set_defaults(fn=cmd_ask)

	w = sub.add_parser('watch')
	w.add_argument('--interval', type=int, default=30)
	w.add_argument('--token-stdin', action='store_true', help='jeton des formulaires lu sur stdin ; arrêt à la fin de stdin')
	w.set_defaults(fn=cmd_watch)
	d = sub.add_parser('doctor', help="peut-on relancer Cate sans rien perdre ? (lecture seule ; 0 oui, 1 non)")
	d.add_argument('--relance', action='store_true', help='contrôle de relance (sans option, même résultat)')
	d.add_argument('--prerequis', action='store_true', help="prérequis de l'orchestrateur, une ligne par point avec la commande qui règle (0 tout ok, 1 un point bloquant manque)")
	d.add_argument('--json', action='store_true', help='avec --prerequis : sortie JSON')
	d.add_argument('--hors-cate', action='store_true', help="avec --prerequis : hors d'un terminal Cate (amorçage), les points de Cate sortent en info")
	d.set_defaults(fn=cmd_doctor)
	g = sub.add_parser('guard', help='hook PreToolUse (JSON sur stdin)')
	g.add_argument('--mode', choices=('send', 'pages'),
	               help="send : envois Slack et Gmail, ask sauf brouillon cliqué identique ; pages : pages du régisseur et state.json ; sans : les deux (hooks d'avant le lot 3)")
	g.set_defaults(fn=cmd_guard)
	h = sub.add_parser('hooks', help='gardes agence dans ~/.claude/settings.json (sur commande de l\'humain ; Cate ne la lance jamais)')
	h.add_argument('action', choices=('install', 'uninstall', 'status'))
	h.add_argument('--settings', help='fichier à lire ou écrire (défaut : ~/.claude/settings.json)')
	h.add_argument('--json', action='store_true')
	h.set_defaults(fn=cmd_hooks)
	v = sub.add_parser('preview', help="aperçu d'un fichier hors workspace : imprime une URL file://")
	v.add_argument('fichier')
	v.add_argument('titre', nargs='?')
	v.set_defaults(fn=cmd_preview)
	sub.add_parser('url').set_defaults(fn=cmd_url)
	sub.add_parser('nom', help="nom de l'humain et sa source").set_defaults(fn=lambda a: print('%s (%s)' % nom_source()))
	return p


def main(argv=None):
	a = parser().parse_args(argv)
	try:
		return a.fn(a) or 0
	except (Refus, Env) as err:
		print(f'agence : {err}', file=sys.stderr)
		return err.code


if __name__ == '__main__':
	sys.exit(main())
