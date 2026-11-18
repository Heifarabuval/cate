#!/usr/bin/env python3
"""agence : l'univers d'un projet orchestré sur le canvas Cate.

Spec : Skills/specs/001-orchestrateur-canvas. Seule cette CLI écrit l'état
<repo>/.cate/tmp/agence/state.json (verrou fcntl, écriture atomique).

  agence start [--no-notify] [--max-agents N]  canvas « Agence : <repo> » + orchestrateur (idempotent) ; --no-notify coupe les notifications système du projet ; --max-agents règle le plafond d'agents en plein tour (défaut 8)
  agence boot [--from ID]            par l'orchestrateur : régisseur + page de suivi, reliés
  agence need add|panel|done|drop|list   add --model <id> --effort <niveau> : réglages voulus, passés par l'orchestrateur à cate agent start ; le suivi montre ceux que cate agent list rend
  agence need log ID "<décision>"    journal daté du besoin ; need show ID le rend, boot rend celui des besoins ouverts
  agence draft new|edit|show|sent|drop  brouillons ; seul le bouton Envoyer de la page valide
  agence ask "question" --option "label|effet"... [--merge owner/repo#N]
  agence watch                       régisseur : boucle de suivi + pages (127.0.0.1:<port>)
  agence guard                       hook PreToolUse (JSON sur stdin)
  agence url                         adresse de la page de suivi

Codes : 0 ok, 1 refus métier, 2 environnement.
"""
import argparse
import contextlib
import fcntl
import hashlib
import html
import http.server
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from datetime import datetime, timezone

MAX_AGENTS = 8  # plafond par défaut d'agents en plein tour ; agence start --max-agents le change pour le projet
EFFORTS = ('low', 'medium', 'high', 'xhigh', 'max')  # ceux que cate agent start --effort déclare
KINDS = ('task', 'cmd', 'pr', 'issue', 'file', 'draft', 'human')
CIBLE_RE = re.compile(r'^(slack:[A-Z0-9]+|mail:[^@\s]+@[^@\s]+|issue:[\w.-]+/[\w.-]+'
                      r'|pr:[\w.-]+/[\w.-]+:[\w./-]+:[\w./-]+|comment:[\w.-]+/[\w.-]+#\d+)$')
ORCH_PROMPT = '/orchestrateur'
CSS = 'https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css'
TOKEN = secrets.token_urlsafe(18)  # jeton des formulaires, en mémoire du régisseur seulement


class Refus(Exception):
	code = 1


class Env(Exception):
	code = 2


def _run(cmd, input=None, timeout=120):
	try:
		p = subprocess.run(cmd, input=input, capture_output=True, text=True, timeout=timeout)
	except (OSError, subprocess.TimeoutExpired) as e:
		return 127, '', str(e)
	return p.returncode, p.stdout, p.stderr


RUN = _run


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
	        'needs': [], 'drafts': [], 'questions': [], 'notified': [], 'agentsActive': 0, 'agentsWaiting': 0, 'titles': {}, 'notify': True}


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
		fd, tmp = tempfile.mkstemp(dir=d, prefix='tmp-state-')
		with os.fdopen(fd, 'w') as f:
			json.dump(st, f, ensure_ascii=False, indent=1)
		os.replace(tmp, state_file(base))
	if after:
		run_after(after, base)


def new_id(st, prefix):
	st['seq'] += 1
	return f"{prefix}{st['seq']}"


def find(st, coll, oid):
	for x in st[coll]:
		if x['id'] == oid:
			return x
	raise Refus(f'{oid} introuvable dans {coll}')


def add_need(st, kind, title, ref=None, owner='agent', blocking=False, unblocks=None, source=None,
             panels=(), done_when=None, acceptance=None, budget=None, model=None, effort=None):
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
	     'acceptance': acceptance, 'budgetMin': budget, 'model': model, 'effort': effort, 'evidence': None, 'status': 'open',
	     'closeFailed': False, 'agentBlocked': False, 'overBudget': False,
	     'created': now_iso(), 'createdTs': time.time(), 'updated': now_iso()}
	st['needs'].append(n)
	return n, True


def note(n, text, by):
	"""Ligne datée au journal d'un besoin (by : 'clic' écrit par la CLI sur un clic de Heifara, 'cli' dit par un agent).
	Les états écrits avant ce champ n'en ont pas : toujours lire par n.get('journal', [])."""
	text = ' '.join(text.split())  # une ligne, sans tabulation : un texte d'agent ne forge pas une ligne « clic »
	n.setdefault('journal', []).append({'ts': now_iso(), 'by': by, 'text': text})


def need_text(n):
	"""Besoin et son journal, une ligne chacun."""
	head = f"{n['id']}\t{n['status']}\t{n['kind']}\t{n['owner']}\t{n['title']}"
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
	return json.loads(out) if out else {}


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
	"""Ligne ouverte qui attend Heifara : sections « À faire par Heifara » ou « Bloquant » du suivi."""
	return n['status'] == 'open' and (n['owner'] == 'heifara' or n['blocking'] or n['overBudget']
	                                  or n['agentBlocked'] or n['closeFailed'])


def action_attendue(st, n):
	perm = n.get('perm') or {}
	if perm.get('choix'):
		return f"Oui ou Non : {perm['commande']}"
	if n['agentBlocked']:
		return f"à traiter dans le panneau {st['titles'].get(n.get('blockedPanel')) or ''}".strip() + (f" : {perm['commande']}" if perm.get('commande') else '')
	if n.get('worktree'):
		return 'garder ou supprimer le worktree'
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
			p['canvas'] = cate('panel', 'create', 'canvas')['panelId']
			title(p['canvas'], f"Agence : {st['repo']}")
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
			n, _ = add_need(st, a.kind, a.title, ref=a.ref, owner=a.owner, blocking=a.blocking, unblocks=a.unblocks,
			                source=a.frm, panels=a.panel or (), done_when=a.done_when, acceptance=a.acceptance,
			                budget=a.budget, model=a.model, effort=a.effort)
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
			print(f"{n['id']}\t{n['status']}\t{n['kind']}\t{n['owner']}\t{n['title']}")
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
			n, _ = add_need(st, 'draft', f'Valider le brouillon ({kind}) « {label} »', ref=did, owner='heifara',
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
		n, _ = add_need(st, 'human', a.question, ref=qid, owner='heifara', blocking=True, unblocks=a.unblocks,
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
				notify(d['agent'] or st['panels'].get('orchestrator'), f'Heifara a abandonné le brouillon {did}.')
				return 303, '/'
			with open(draft_path(did)) as f:
				texte = f.read().strip()
			if (form.get('h') or [''])[0] != sha(texte):
				return 409, 'Le texte a changé depuis son affichage : recharge la page, relis, puis Envoyer.'
			d.update(statut='envoyer', texte=texte, hash=sha(texte), allowed=False)
			kind = d['cible'].split(':', 1)[0]
			if kind in ('slack', 'mail'):
				note(find(st, 'needs', d['needId']), f"Envoyer cliqué sur {did} ({d['cible']})", 'clic')
				notify(st['panels'].get('orchestrator'),
				       f"Heifara a cliqué Envoyer sur le brouillon {did} ({d['cible']}). Envoie-le maintenant par l'outil MCP "
				       f"avec exactement le texte de « agence draft show {did} », puis « agence draft sent {did} --evidence <lien> ».")
				return 303, '/'
			try:
				link_url = send_gh(d)
			except Refus as e:
				d.update(statut='à valider', texte=None, hash=None)
				return 409, f"Envoi refusé par GitHub : {e}"
			d.update(statut='envoyé', url=link_url)
			note(find(st, 'needs', d['needId']), f'{did} envoyé : {link_url}', 'clic')
			n = close_need(st, d['needId'], 'done', link_url or 'envoyé')
			apply(st, [('close', p, n['id']) for p in n['panels']])
			notify(d['agent'] or st['panels'].get('orchestrator'), f'Brouillon {did} envoyé par Heifara : {link_url}')
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
				notify(st['panels'].get('orchestrator'), f"Heifara demande le rebase de {q['action'][len('merge:'):]} "
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
			msg = f"Réponse de Heifara à « {q['question']} » : {answer}"
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
	if n['overBudget']:
		meta.append(f"budget de {e(n['budgetMin'])} min dépassé : continuer, réduire ou arrêter ?")
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
	mine = [n for n in opened if n['owner'] == 'heifara']
	block = [n for n in opened if n['owner'] != 'heifara' and attend(n)]
	rest = [n for n in opened if n not in mine and n not in block]
	done = sorted([n for n in st['needs'] if n['status'] == 'done'], key=lambda n: n['updated'], reverse=True)[:20]
	body = (f"<h1>{e(st['repo'])}</h1><div class=\"sub\">Agents : {st['agentsActive']} en cours, {st['agentsWaiting']} en attente (plafond {plafond(st)}) · "
	        f"mis à jour {time.strftime('%H:%M:%S')}</div>"
	        + section(st, 'Bloquant', block, 'block') + section(st, 'À faire par Heifara', mine, 'me')
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
		           + btn(f'/draft/{did}/send', 'Envoyer', 'go', h=sha(texte.strip())))
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
	ces deux derniers sans bouton. choix : ['oui', 'non'] si Heifara peut répondre d'un bouton (menu dont le curseur
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


def tick(st, live, agents, gh, now, screens=None):
	"""Un tour du régisseur : met l'état à jour, rend les effets ('close', panneau, besoin) et ('notify', panneau, texte).
	screens : écran lu de chaque agent bloqué ({panneau: texte}), pour afficher sa demande."""
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
			if n['owner'] == 'heifara':
				effects.append(('notify', orch, f"Fait par Heifara : {n['title']} ({done_by['state']})."))
			continue
		in_flight = n['kind'] == 'draft' and any(d['id'] == n['ref'] and d['statut'] == 'envoyer' for d in st['drafts'])
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
		if n['budgetMin'] and now - n.get('createdTs', now) > n['budgetMin'] * 60:
			n['overBudget'] = True
			once(f"budget:{n['id']}", orch, f"Budget de {n['budgetMin']} min dépassé : {n['title']} ({n['id']}).")
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
	if st['agentsActive'] >= plafond(st) > active:
		effects.append(('notify', orch, f'Une place est libre : {active} en cours sur {plafond(st)}.'))
	st['agentsActive'] = active
	st['agentsWaiting'] = len([a for a in mine if a.get('state') == 'waitingForInput'])
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
				                ref=f'wt:{path}', owner='heifara', source=nid)
				n['worktree'] = {'path': path, 'branch': branch}


def worktree_ok(repo, path, branch):
	"""Preuve positive qu'on peut proposer ou supprimer : worktree sans modification, et une PR mergée dont la tête est
	le SHA actuel de la branche. « git branch --merged » ne prouve rien (une branche neuve, tip = base, y est)."""
	code, tip, _ = RUN(['git', '-C', path, 'rev-parse', 'HEAD'])
	code2, dirty, _ = RUN(['git', '-C', path, 'status', '--porcelain'])
	return bool(repo and code == 0 and code2 == 0 and not dirty.strip() and pr_mergee(repo, branch, tip.strip()))


def worktree_offers(snap, nid, live, base=None):
	"""Worktrees du besoin (nom « <besoin>-<rôle> », voir le skill) à proposer à Heifara : [(besoin, chemin, branche)].
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


def read_token_stdin():
	"""Jeton des formulaires donné par le processus parent : première ligne de stdin, 24 caractères au moins."""
	token = sys.stdin.readline().strip()
	if len(token) < 24:
		raise Env('--token-stdin : jeton d\'au moins 24 caractères attendu sur la première ligne de stdin')
	return token


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
	with tx() as st:
		st['titles'] = {p: r.get('title') or '' for p, r in rows.items()}
		st['ghRepo'] = st['ghRepo'] or snap['ghRepo']
		merge_apply(st, merges)
		effects = tick(st, set(rows), agents, gh, time.time(), screens)
		apply(st, effects)
	for eff in effects:
		log(f'{eff[0]} {eff[1]} {eff[2]}')


def cmd_watch(a):
	global TOKEN
	require_cate()
	st = load()
	if not st['port']:
		raise Refus("pas de port : l'orchestrateur lance d'abord « agence boot »")
	if a.token_stdin:
		TOKEN = read_token_stdin()
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
PAGE_DENY = "Les pages du régisseur sont pour Heifara : un agent ne clique pas à sa place."
STATE_DENY = "state.json s'écrit seulement par la CLI agence."


def send_match(st, tool, ti):
	"""Brouillon cliqué, pas encore utilisé, besoin ouvert, dont la cible et le texte sont exactement ceux de l'envoi."""
	for d in st['drafts']:
		if d['statut'] != 'envoyer' or d.get('allowed') or d['texte'] is None:
			continue
		with contextlib.suppress(Refus):
			if find(st, 'needs', d['needId'])['status'] != 'open':
				continue
		if tool.endswith('slack_send_message'):
			if d['cible'] == f"slack:{ti.get('channel_id')}" and d['texte'] == (ti.get('message') or '').strip():
				return d
		elif d['cible'].startswith('mail:'):
			if (ti.get('to') == [d['cible'][5:]] and not ti.get('cc') and not ti.get('bcc') and not ti.get('htmlBody')
					and not ti.get('draftId') and not ti.get('attachments')
					and d['texte'] == (ti.get('body') or '').strip() and (not d['titre'] or d['titre'] == ti.get('subject'))):
				return d
	return None


def guard(payload):
	base = os.environ.get('CLAUDE_PROJECT_DIR') or payload.get('cwd') or os.getcwd()
	if not os.path.isfile(state_file(base)):
		base = main_repo(base) or base
	if not os.path.isfile(state_file(base)):
		return None
	st = load(state_file(base))
	tool = payload.get('tool_name') or ''
	ti = payload.get('tool_input') or {}
	if tool.endswith('slack_send_message') or tool.endswith('Gmail__send_message'):
		d = send_match(st, tool, ti)
		if not d:
			return None
		with tx(base) as cur:  # une autorisation par clic : la suivante redemande
			d = send_match(cur, tool, ti)
			if not d:
				return None
			d['allowed'] = True
		return decision('allow', f"Brouillon {d['id']} validé par le clic de Heifara (cible et texte identiques).")
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
	try:
		payload = json.loads(sys.stdin.read() or '{}')
	except json.JSONDecodeError:
		return 0
	res = guard(payload)
	if res:
		print(json.dumps(res, ensure_ascii=False))
	return 0


def cmd_url(a):
	st = load()
	if not st['port']:
		raise Refus('pas encore de page : agence boot')
	print(url(st, '/'))
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
	               help="notification système quand une ligne attend Heifara (activée par défaut ; --no-notify la coupe pour ce projet, relue à chaque tour)")
	s.add_argument('--max-agents', type=entier_positif, metavar='N',
	               help=f"plafond d'agents en plein tour pour ce projet (défaut {MAX_AGENTS} ; les agents en attente de saisie, l'orchestrateur et le régisseur ne comptent pas)")
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
	add.add_argument('--owner', default='agent', choices=('agent', 'heifara'))
	add.add_argument('--blocking', action='store_true')
	add.add_argument('--unblocks')
	add.add_argument('--panel', action='append')
	add.add_argument('--from', dest='frm')
	add.add_argument('--done-when')
	add.add_argument('--acceptance')
	add.add_argument('--budget', type=int)
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
	sub.add_parser('guard').set_defaults(fn=cmd_guard)
	sub.add_parser('url').set_defaults(fn=cmd_url)
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
