#!/bin/sh
# Rebuilds Cate from the fork when origin/<branch> moves, then installs it in
# /Applications as soon as Cate is closed. launchd runs it every 10 minutes
# (agent written by cate-fork-install.sh). It never stops a daemon and never
# starts Cate.
#
# Usage: cate-fork-update [--force] [--prereq] [--purge] [--self-test] [branch]
#   --force      build even if this commit is already installed, staged or failed
#   --prereq     list what is missing (tools, Node, npm, connection), change nothing
#   --purge      delete the build folder and its markers (used by the uninstaller)
#   --self-test  check HOME, user, settings and build folder, change nothing, exit 0
#                (run by the installer and before a refreshed copy replaces this one:
#                every later version must keep it)
#
# Settings: environment, or KEY=value lines in ~/.config/cate-fork-update.conf
# (the environment wins):
#   CATE_FORK_REPO    https://github.com/Heifarabuval/cate.git
#   CATE_FORK_BRANCH  main
#   CATE_BUILD_DIR    ~/.local/share/cate-build
#   CATE_APPS_DIR     /Applications
#
# Exit: 0 done or nothing to do, 1 failure, 2 not macOS, 3 no suitable Node,
# 4 disk space, 5 prerequisite missing, 6 build folder refused. Log: ~/Library/Logs/cate-fork-update.log
set -eu

MIN_FREE_KB=5242880 # 5 GB: node_modules and release/ of a build
MAX_TRIES=3         # failed builds of one commit before waiting for the next commit

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
short() { printf '%s' "$1" | cut -c1-8; }
ok() { echo "ok     $*"; }
bad() { echo "MANQUE $*"; BAD=1; }

notify() { osascript -e "display notification \"$1\" with title \"Cate\"" >/dev/null 2>&1 || true; }

# Notifies once per key: the same failure is not repeated every 10 minutes.
notify_once() {
	if [ "$(cat "$NOTIFIED" 2>/dev/null || true)" = "$1" ]; then return 0; fi
	printf '%s\n' "$1" > "$NOTIFIED"
	notify "$2"
}

# Only the four settings are read, and never evaluated as code.
load_conf() {
	[ -f "$CONF" ] || return 0
	# "|| [ -n ]": a last line without a final newline is read too.
	while IFS='=' read -r k v || [ -n "$k" ]; do
		case $k in CATE_FORK_REPO | CATE_FORK_BRANCH | CATE_BUILD_DIR | CATE_APPS_DIR) ;; *) continue ;; esac
		v=${v#\"}
		v=${v%\"}
		# shellcheck disable=SC2088  # a literal "~/" typed in the config is matched on purpose
		case $v in "~/"*) v="$HOME/${v#"~/"}" ;; esac
		eval "[ -n \"\${$k:-}\" ] || $k=\$v"
	done < "$CONF"
}

# 22.16.1 -> 22016001
vernum() { printf '%s' "$1" | awk -F. '{ sub(/^v/, "", $1); printf "%d", $1 * 1000000 + $2 * 1000 + $3 }'; }

node_dirs() {
	if command -v node >/dev/null 2>&1; then dirname "$(command -v node)"; fi
	for d in "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin \
		"$HOME/Library/Application Support/fnm/node-versions"/v*/installation/bin \
		"$HOME/.local/share/fnm/node-versions"/v*/installation/bin \
		"$HOME/.fnm/node-versions"/v*/installation/bin \
		"$HOME/.volta/bin" "$HOME"/.volta/tools/image/node/*/bin; do
		echo "$d"
	done
	for p in $BREW_PREFIXES; do
		echo "$p/opt/node@22/bin"
		echo "$p/bin"
	done
}

# find_node <package.json text>: picks the newest Node satisfying engines.node
# (default >=22.16 <23). Sets NODE_DIR, NODE_V, NODE_FOUND, MIN, MAX.
find_node() {
	range=$(printf '%s\n' "$1" | awk '/"engines"/ { f = 1 } f && /"node"/ { print; exit }')
	MIN=$(printf '%s' "$range" | sed -n 's/.*>=[[:space:]]*\([0-9][0-9.]*\).*/\1/p')
	MAX=$(printf '%s' "$range" | sed -n 's/.*<[[:space:]]*\([0-9][0-9.]*\).*/\1/p')
	MIN=${MIN:-22.16}
	MAX=${MAX:-23}
	NODE_DIR="" NODE_V="" NODE_FOUND=""
	best=0
	lo=$(vernum "$MIN")
	hi=$(vernum "$MAX")
	while IFS= read -r d; do
		[ -x "$d/node" ] || continue
		v=$("$d/node" -v 2>/dev/null) || continue
		n=$(vernum "$v")
		case " $NODE_FOUND " in *" $v "*) ;; *) NODE_FOUND="$NODE_FOUND $v" ;; esac
		if [ "$n" -ge "$lo" ] && [ "$n" -lt "$hi" ] && [ "$n" -gt "$best" ]; then
			best=$n NODE_V=$v NODE_DIR=$d
		fi
	done << EOF
$(node_dirs)
EOF
	[ -n "$NODE_DIR" ]
}

node_msg() {
	echo "Node >=$MIN <$MAX requis, trouvé${NODE_FOUND:- aucun} ; cherché : PATH, nvm, volta, fnm, homebrew. Installer : brew install node@${MIN%%.*} (ou nvm install ${MIN%%.*})"
}

check_tools() {
	HAVE_GIT=0
	# xcode-select -p never opens the installer window, unlike git or python3 without the tools.
	if xcode-select -p >/dev/null 2>&1; then
		ok "outils développeur"
		if command -v git >/dev/null 2>&1; then
			ok git
			HAVE_GIT=1
		else
			bad "git : introuvable"
		fi
	else
		bad "outils développeur : lancer xcode-select --install, attendre la fin, puis relancer"
	fi
	# Checked before any build: 20 minutes of work must not end on a folder we cannot write.
	a=$APPS
	while [ ! -d "$a" ] && [ "$a" != / ]; do a=$(dirname "$a"); done
	if [ -w "$a" ]; then
		ok "dossier d'installation $APPS"
	else
		bad "dossier d'installation $APPS non inscriptible : relancer avec CATE_APPS_DIR=~/Applications"
	fi
}

# A cut between the two moves of install_staged leaves Cate.app.old and no Cate.app.
restore_old() {
	if [ ! -d "$APP" ] && [ -d "$APP.old" ]; then
		mv "$APP.old" "$APP" && log "restored $APP from $APP.old (an install was cut)"
	fi
}

# The lock is taken by mkdir. An owner that is gone, or whose pid now names
# another program (reused after a power cut), or a lock without pid older than
# 15 minutes, is moved aside with one atomic rename: of two runs, only one wins it.
acquire_lock() {
	mkdir "$LOCK" 2> /dev/null && return 0
	pid=$(cat "$LOCK/pid" 2> /dev/null || true)
	if [ -n "$pid" ]; then
		# This script as launchd, the installer or a checkout run it; not "tail -f ...cate-fork-update.log".
		case $(ps -p "$pid" -o command= 2> /dev/null) in
			*/cate-fork-update | *"/cate-fork-update "* | *cate-fork-update.sh*) return 1 ;;
		esac
	elif [ -z "$(find "$LOCK" -maxdepth 0 -mmin +15 2> /dev/null)" ]; then
		return 1
	fi
	tomb="$LOCK.stale.$$"
	mv "$LOCK" "$tomb" 2> /dev/null || return 1
	# Not the lock we judged (a run took it meanwhile): put it back.
	if [ "$(cat "$tomb/pid" 2> /dev/null || true)" != "$pid" ] ||
		{ [ -z "$pid" ] && [ -z "$(find "$tomb" -maxdepth 0 -mmin +15 2> /dev/null)" ]; }; then
		mv "$tomb" "$LOCK" 2> /dev/null || true
		return 1
	fi
	rm -rf "$tomb"
	mkdir "$LOCK" 2> /dev/null
}

prereq() {
	BAD=0
	check_tools
	if [ "$HAVE_GIT" = 1 ]; then
		if git ls-remote -q "$REPO" HEAD >/dev/null 2>&1; then ok "connexion ($REPO)"; else bad "connexion : $REPO injoignable"; fi
	fi
	pkg=""
	[ ! -f "$DIR/package.json" ] || pkg=$(cat "$DIR/package.json")
	if find_node "$pkg"; then
		ok "Node $NODE_V ($NODE_DIR)"
		if [ -x "$NODE_DIR/npm" ]; then ok npm; else bad "npm : introuvable à côté de Node"; fi
	else
		bad "$(node_msg)"
	fi
	[ "$BAD" = 0 ]
}

refuse_dir() {
	echo "dossier de build refusé : ${DIR:-vide} ($1). Attendu : un clone de $REPO nommé cate-build, sous $HOME. Rien n'a été touché." >&2
	exit 6
}

# The one gate before any rm -rf, git checkout or git clean on the build folder:
# absolute, no "..", strictly under HOME, named cate-build, not a symlink, and
# if it is a git repository its origin is exactly REPO.
validate_dir() {
	d=$DIR
	# shellcheck disable=SC2088  # a literal "~" typed in the config is matched on purpose
	case $d in "~") d=$HOME ;; "~/"*) d="$HOME/${d#"~/"}" ;; esac
	while [ "${d%/}" != "$d" ]; do d=${d%/}; done
	h=$HOME
	while [ "${h%/}" != "$h" ]; do h=${h%/}; done
	case $d in /*) ;; *) refuse_dir "chemin non absolu" ;; esac
	case "$d/" in */../* | */./*) refuse_dir "chemin avec . ou .." ;; esac
	case $d in "$h"/*) ;; *) refuse_dir "pas strictement sous HOME" ;; esac
	[ "${d##*/}" = cate-build ] || refuse_dir "le nom doit être cate-build"
	[ ! -L "$d" ] || refuse_dir "lien symbolique"
	if [ -e "$d/.git" ]; then
		# xcode-select first: git without the developer tools opens the installer window.
		if xcode-select -p > /dev/null 2>&1 && command -v git > /dev/null 2>&1; then
			origin=$(git -C "$d" config --get remote.origin.url 2> /dev/null || true)
			[ "$origin" = "$REPO" ] || refuse_dir "origin du dépôt : ${origin:-aucun}"
		elif [ "$MODE" = purge ]; then
			refuse_dir "origine non vérifiable sans git et les outils développeur"
		fi # else check_tools stops the run before anything is touched
	fi
	DIR=$d
}

# Under the lock: a purge never deletes the clone under a running build.
purge() {
	[ -d "$(dirname "$DIR")" ] || { echo "rien à supprimer : $DIR"; return 0; }
	if ! acquire_lock; then
		echo "construction en cours ($LOCK) : dossier de build conservé, réessayer à la fin" >&2
		exit 1
	fi
	rm -rf "$DIR" "$DIR.staged" "$DIR.installed" "$DIR.failed" "$DIR.notified" "$DIR.lock"
	echo "dossier de build supprimé : $DIR"
}

build() {
	log "building $BRANCH @ $(short "$SHA")"
	git checkout -q --detach "$SHA" || return 1
	git clean -qfdx -e node_modules || return 1
	PATH="$NODE_DIR:$PATH"
	export PATH
	npm ci --no-audit --no-fund || return 1
	npm run runtime:tarball || return 1
	# shellcheck disable=SC3045  # ulimit -n works in the macOS /bin/sh; failure is ignored
	ulimit -n 65536 2> /dev/null || true
	# Ad hoc signature, no notarization; CATE_SELF_UPDATE=0 keeps upstream releases out.
	# No hardened runtime: with an ad hoc signature its library validation refuses
	# Electron Framework and the app never starts.
	CATE_SELF_UPDATE=0 node scripts/package.mjs --mac dir --publish never \
		-c.mac.identity=- -c.mac.notarize=false -c.mac.hardenedRuntime=false || return 1
}

stage() {
	built=""
	for b in release/mac*/Cate.app; do
		if [ -d "$b" ]; then
			built=$b
			break
		fi
	done
	[ -n "$built" ] || { log "no Cate.app in release/"; return 1; }
	if codesign -dv "$built" 2>&1 | grep -q 'flags=.*runtime'; then
		log "hardened runtime still on, not staged: the app would not start"
		return 1
	fi
	rm -rf "$DIR.staged"
	mkdir -p "$DIR.staged"
	ditto "$built" "$STAGED" || return 1
	printf '%s\n' "$SHA" > "$DIR.staged/sha"
	staged=$SHA
}

need_build() {
	if [ "$FORCE" = 1 ]; then return 0; fi
	[ "$SHA" != "$installed" ] && [ "$SHA" != "$staged" ] &&
		{ [ "$SHA" != "$failed" ] || [ "$tries" -lt "$MAX_TRIES" ]; }
}

# The installed copy of this script follows the commit it builds, so a fix to it
# reaches the machine without pasting the line again. Only the fixed path under
# HOME is replaced (never a checkout), only by a non-empty copy that parses and
# passes --self-test, and by rename: the running shell keeps reading the old file.
# A copy that fails is dropped: the installed one stays and takes the next fix.
# ponytail: --self-test covers startup up to the build folder gate, not the
# build steps after it; a .prev rollback would need a wrapper around launchd.
refresh_self() {
	self=$HOME/.local/bin/cate-fork-update
	[ -f "$self" ] || return 0
	if ! git show "$SHA:scripts/cate-fork-update.sh" > "$self.new" 2> /dev/null ||
		[ ! -s "$self.new" ] || ! sh -n "$self.new" 2> /dev/null || cmp -s "$self.new" "$self"; then
		rm -f "$self.new"
		return 0
	fi
	if ! sh "$self.new" --self-test < /dev/null; then
		rm -f "$self.new"
		log "self-test failed, kept the installed copy (version of $(short "$SHA") not used)"
		return 0
	fi
	chmod 755 "$self.new"
	mv -f "$self.new" "$self"
	log "cate-fork-update refreshed from $(short "$SHA")"
}

# Builds when origin/<branch> moved. Never exits: the install step still runs.
maybe_build() {
	need_build || return 0
	pkg=$(git show "$SHA:package.json" 2> /dev/null || true)
	if ! find_node "$pkg"; then
		log "$(node_msg)"
		notify_once "node:${NODE_FOUND:-none}" "Cate : Node $MIN requis, trouvé${NODE_FOUND:- aucun}. Voir le journal."
		return 3
	fi
	if [ ! -x "$NODE_DIR/npm" ]; then
		log "npm introuvable dans $NODE_DIR"
		notify_once "npm:$NODE_DIR" "Cate : npm introuvable. Voir le journal."
		return 3
	fi
	free_kb=$(df -k "$(dirname "$DIR")" | awk 'NR == 2 { print $4 }')
	if [ "${free_kb:-0}" -lt "$MIN_FREE_KB" ]; then
		log "moins de 5 Go libres (${free_kb:-0} Ko) : pas de construction"
		notify_once "disk" "Cate : moins de 5 Go libres, pas de mise à jour."
		return 4
	fi
	if build && stage; then
		rm -f "$DIR.failed"
		log "built $(short "$SHA")"
		return 0
	fi
	# The installed app is untouched. A cut network or an interrupted build is
	# retried on the next runs; after MAX_TRIES the commit waits for the next one.
	# An interruption by a signal never gets here (trap): it does not count.
	if [ "$SHA" = "$failed" ]; then tries=$((tries + 1)); else tries=1; fi
	printf '%s %s\n' "$SHA" "$tries" > "$DIR.failed"
	if [ "$tries" -lt "$MAX_TRIES" ]; then
		log "build of $(short "$SHA") failed ($tries/$MAX_TRIES), installed app untouched, retried on the next run"
	else
		log "build of $(short "$SHA") failed $tries times, installed app untouched (retry on a new commit or with --force)"
		notify_once "build:$SHA" "Cate : la construction de $(short "$SHA") a échoué. Voir le journal."
	fi
	return 1
}

# The fork's skills (/orchestrateur and the others) in ~/.claude/skills, so they
# work in any folder, even one Cate never seeded (no .claude/ in it). Only from
# a commit that built: the tree is then at SHA. A copy carries a .cate-fork
# marker with its commit and follows each build; a folder without the marker
# is the person's own and is never touched.
install_skills() {
	[ "$SHA" = "$staged" ] || [ "$SHA" = "$(cat "$DIR.installed" 2> /dev/null)" ] || return 0
	src=$DIR/skills
	[ -d "$src" ] || return 0
	dest=$HOME/.claude/skills
	for s in "$src"/*/; do
		name=$(basename "$s")
		d=$dest/$name
		[ -f "$s/SKILL.md" ] || continue
		if [ -e "$d" ] || [ -L "$d" ]; then
			[ -f "$d/.cate-fork" ] && [ ! -L "$d" ] || continue
			[ "$(cat "$d/.cate-fork")" != "$SHA" ] || continue
		fi
		mkdir -p "$dest"
		rm -rf "$d.new"
		if cp -R "$s" "$d.new" && printf '%s\n' "$SHA" > "$d.new/.cate-fork" && rm -rf "$d" && mv "$d.new" "$d"; then
			log "skill $name installed in $dest from $(short "$SHA")"
		else
			rm -rf "$d.new"
			log "skill $name not installed in $dest"
		fi
	done
}

install_failed() {
	log "$1"
	notify_once "install:$staged" "Cate : installation de $(short "$staged") impossible. Voir le journal."
	exit 1
}

install_staged() {
	[ -d "$STAGED" ] || return 0
	if pgrep -f "Cate.app/Contents/MacOS/Cate" > /dev/null 2>&1; then
		log "Cate is open, install of $(short "$staged") waits for it to close"
		return 0
	fi
	rm -rf "$APP.old"
	# The old app stays until the new one is in place.
	if [ -d "$APP" ] && ! mv "$APP" "$APP.old"; then install_failed "cannot move $APP aside"; fi
	if ! mv "$STAGED" "$APP"; then
		rm -rf "$APP"
		if [ -d "$APP.old" ]; then
			mv "$APP.old" "$APP" || true
			install_failed "cannot move the new app into $APPS, old app restored"
		fi
		install_failed "cannot move the new app into $APPS (there was no old app)"
	fi
	xattr -dr com.apple.quarantine "$APP" 2> /dev/null || true
	printf '%s\n' "$staged" > "$DIR.installed"
	rm -rf "$APP.old" "$DIR.staged" "$NOTIFIED" "$DIR.failed"
	log "installed $(short "$staged")"
	notify "Fork $(short "$staged") installé"
}

main() {
	FORCE=0 MODE=run BRANCH_ARG=""
	for a in "$@"; do
		case $a in
			--force) FORCE=1 ;;
			--prereq) MODE=prereq ;;
			--purge) MODE=purge ;;
			--self-test) MODE=self_test ;;
			-*) echo "option inconnue : $a" >&2; exit 64 ;;
			*) BRANCH_ARG=$a ;;
		esac
	done
	[ "$(uname -s)" = Darwin ] || { echo "cate-fork-update : macOS uniquement" >&2; exit 2; }
	# Every path, and the build folder gate, hangs on HOME: an empty or "/" HOME
	# would make "strictly under HOME" mean "anywhere".
	h=${HOME:-}
	while [ "${h%/}" != "$h" ]; do h=${h%/}; done
	case $h in /*) ;; *) echo "HOME invalide (${HOME:-vide}) : un dossier absolu existant est requis. Rien n'a été touché." >&2; exit 1 ;; esac
	[ -d "$h" ] || { echo "HOME introuvable : $HOME. Rien n'a été touché." >&2; exit 1; }
	# sudo keeps the user's HOME: files written as root there lock the user out.
	[ "$(id -u)" != 0 ] || { echo "ne pas lancer en root (sudo) : relancer sans sudo. Rien n'a été touché." >&2; exit 1; }
	CONF="${CATE_FORK_CONF:-$HOME/.config/cate-fork-update.conf}"
	LOG="$HOME/Library/Logs/cate-fork-update.log"

	load_conf
	REPO=${CATE_FORK_REPO:-https://github.com/Heifarabuval/cate.git}
	BRANCH=${BRANCH_ARG:-${CATE_FORK_BRANCH:-main}}
	DIR=${CATE_BUILD_DIR:-$HOME/.local/share/cate-build}
	APPS=${CATE_APPS_DIR:-/Applications}
	APP=$APPS/Cate.app
	# launchd gives a reduced PATH: Node is never taken from the inherited one alone.
	BREW_PREFIXES=${CATE_BREW_PREFIXES:-/opt/homebrew /usr/local}
	export GIT_TERMINAL_PROMPT=0

	# A value starting with "-" would be read by git as an option.
	case $REPO in -*) echo "dépôt invalide (commence par -)" >&2; exit 64 ;; esac
	case $BRANCH in -*) echo "branche invalide (commence par -)" >&2; exit 64 ;; esac
	validate_dir
	# Only from the validated DIR (no trailing slash): every state file sits next
	# to the clone, never inside it where git clean would delete it.
	STAGED=$DIR.staged/Cate.app # built, waiting for Cate to close
	LOCK=$DIR.lock
	NOTIFIED=$DIR.notified

	case $MODE in
		self_test) exit 0 ;;
		prereq) if prereq; then exit 0; fi; exit 5 ;;
		purge) purge; exit 0 ;;
	esac

	mkdir -p "$(dirname "$LOG")" "$(dirname "$DIR")"
	if [ -t 1 ]; then echo "journal : $LOG"; fi
	# Over 1 MB: the previous log is kept as .1, a new one starts.
	if [ -f "$LOG" ] && [ "$(($(wc -c < "$LOG")))" -gt 1048576 ]; then mv -f "$LOG" "$LOG.1"; fi
	exec >> "$LOG" 2>&1

	acquire_lock || { log "already running"; exit 0; }
	echo $$ > "$LOCK/pid"
	trap 'rm -rf "$LOCK"' EXIT
	trap 'exit 1' HUP INT TERM
	restore_old

	BAD=0
	check_tools
	if [ "$BAD" = 1 ]; then
		notify_once "tools" "Cate : outils développeur manquants. Voir le journal."
		exit 5
	fi

	if [ ! -d "$DIR/.git" ]; then
		git clone -q "$REPO" "$DIR" || { log "clone impossible (connexion ?)"; exit 1; }
	fi
	cd "$DIR"
	# BRANCH may be a branch, a tag or a commit: FETCH_HEAD, not origin/<ref>.
	if git fetch -q origin "$BRANCH"; then
		SHA=$(git rev-parse "FETCH_HEAD^{commit}" 2> /dev/null) || { log "$BRANCH introuvable"; exit 1; }
	else
		log "fetch impossible (connexion ?), état connu conservé"
		SHA=$(git rev-parse "origin/$BRANCH" 2> /dev/null) || { log "$BRANCH inconnu hors ligne"; exit 0; }
	fi
	installed=$(cat "$DIR.installed" 2> /dev/null || true)
	staged=$(cat "$DIR.staged/sha" 2> /dev/null || true)
	failed="" tries=0
	[ ! -f "$DIR.failed" ] || read -r failed tries < "$DIR.failed" || true
	case $tries in '' | *[!0-9]*) tries=$MAX_TRIES ;; esac
	refresh_self

	rc=0
	maybe_build || rc=$?
	install_skills
	install_staged
	exit "$rc"
}

main "$@"
