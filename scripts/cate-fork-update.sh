#!/bin/sh
# Rebuilds Cate from the fork when origin/<branch> moves, then installs it in
# /Applications as soon as Cate is closed. launchd runs it every 10 minutes
# (agent written by cate-fork-install.sh). It never stops a daemon and never
# starts Cate.
#
# Usage: cate-fork-update [--force] [--prereq] [--purge] [branch]
#   --force   build even if this commit is already installed, staged or failed
#   --prereq  list what is missing (tools, Node, npm, connection), change nothing
#   --purge   delete the build folder and its markers (used by the uninstaller)
#
# Settings: environment, or KEY=value lines in ~/.config/cate-fork-update.conf
# (the environment wins):
#   CATE_FORK_REPO    https://github.com/Heifarabuval/cate.git
#   CATE_FORK_BRANCH  main
#   CATE_BUILD_DIR    ~/.local/share/cate-build
#   CATE_APPS_DIR     /Applications
#
# Exit: 0 done or nothing to do, 1 failure, 2 not macOS, 3 no suitable Node,
# 4 disk space, 5 prerequisite missing. Log: ~/Library/Logs/cate-fork-update.log
set -eu

CONF="${CATE_FORK_CONF:-$HOME/.config/cate-fork-update.conf}"
LOG="$HOME/Library/Logs/cate-fork-update.log"
MIN_FREE_KB=5242880 # 5 GB: node_modules and release/ of a build

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
	while IFS='=' read -r k v; do
		case $k in CATE_FORK_REPO | CATE_FORK_BRANCH | CATE_BUILD_DIR | CATE_APPS_DIR) ;; *) continue ;; esac
		v=${v#\"}
		v=${v%\"}
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

purge() {
	case $DIR in "" | / | "$HOME") echo "dossier de build refusé : $DIR" >&2; exit 1 ;; esac
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
	[ "$SHA" != "$installed" ] && [ "$SHA" != "$staged" ] && [ "$SHA" != "$failed" ]
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
	# The installed app is untouched. The same commit is not retried every 10 minutes.
	printf '%s\n' "$SHA" > "$DIR.failed"
	log "build of $(short "$SHA") failed, installed app untouched (retry on a new commit or with --force)"
	notify_once "build:$SHA" "Cate : la construction de $(short "$SHA") a échoué. Voir le journal."
	return 1
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
		if [ -d "$APP.old" ]; then mv "$APP.old" "$APP" || true; fi
		install_failed "cannot move the new app into $APPS, old app restored"
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
			-*) echo "option inconnue : $a" >&2; exit 64 ;;
			*) BRANCH_ARG=$a ;;
		esac
	done
	[ "$(uname -s)" = Darwin ] || { echo "cate-fork-update : macOS uniquement" >&2; exit 2; }

	load_conf
	REPO=${CATE_FORK_REPO:-https://github.com/Heifarabuval/cate.git}
	BRANCH=${BRANCH_ARG:-${CATE_FORK_BRANCH:-main}}
	DIR=${CATE_BUILD_DIR:-$HOME/.local/share/cate-build}
	APPS=${CATE_APPS_DIR:-/Applications}
	APP=$APPS/Cate.app
	STAGED=$DIR.staged/Cate.app # built, waiting for Cate to close
	LOCK=$DIR.lock
	NOTIFIED=$DIR.notified
	# launchd gives a reduced PATH: Node is never taken from the inherited one alone.
	BREW_PREFIXES=${CATE_BREW_PREFIXES:-/opt/homebrew /usr/local}
	export GIT_TERMINAL_PROMPT=0

	case $MODE in
		prereq) if prereq; then exit 0; fi; exit 5 ;;
		purge) purge; exit 0 ;;
	esac

	mkdir -p "$(dirname "$LOG")" "$(dirname "$DIR")"
	if [ -t 1 ]; then echo "journal : $LOG"; fi
	exec >> "$LOG" 2>&1

	if ! mkdir "$LOCK" 2> /dev/null; then
		pid=$(cat "$LOCK/pid" 2> /dev/null || true)
		if [ -z "$pid" ] || kill -0 "$pid" 2> /dev/null; then log "already running"; exit 0; fi
		rm -rf "$LOCK" # its owner died
		mkdir "$LOCK" 2> /dev/null || { log "already running"; exit 0; }
	fi
	echo $$ > "$LOCK/pid"
	trap 'rm -rf "$LOCK"' EXIT
	trap 'exit 1' HUP INT TERM

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
	git fetch -q origin "$BRANCH" || log "fetch impossible (connexion ?), état connu conservé"
	SHA=$(git rev-parse "origin/$BRANCH" 2> /dev/null) || { log "origin/$BRANCH introuvable"; exit 1; }
	installed=$(cat "$DIR.installed" 2> /dev/null || true)
	staged=$(cat "$DIR.staged/sha" 2> /dev/null || true)
	failed=$(cat "$DIR.failed" 2> /dev/null || true)

	rc=0
	maybe_build || rc=$?
	install_staged
	exit "$rc"
}

main "$@"
