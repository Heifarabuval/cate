#!/bin/sh
# Installs the automatic update of the Cate fork, in one line:
#
#   curl -fsSL https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts/cate-fork-install.sh | sh
#
# Checks the prerequisites (all named at once), copies cate-fork-update to
# ~/.local/bin, writes and loads the launchd agent (every 10 minutes), then
# builds and installs Cate once. Safe to run again: same result, no duplicate.
# Usage: cate-fork-install.sh [--sans-launchd]
# Settings: CATE_FORK_REPO, CATE_FORK_BRANCH, CATE_BUILD_DIR, CATE_APPS_DIR (kept
# in ~/.config/cate-fork-update.conf when given), CATE_FORK_RAW_URL (where the
# other scripts are downloaded from when this one is piped).
#
# Everything runs inside main, called on the last line: a truncated download runs nothing.
set -eu

LABEL=com.cate.fork-update

die() {
	echo "cate-fork-install : $*" >&2
	exit "${2:-1}"
}

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

write_plist() {
	mkdir -p "$AGENTS"
	{
		echo '<?xml version="1.0" encoding="UTF-8"?>'
		echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
		echo '<plist version="1.0">'
		echo '<dict>'
		printf '\t<key>Label</key><string>%s</string>\n' "$LABEL"
		printf '\t<key>ProgramArguments</key><array><string>%s</string></array>\n' "$(xml "$BIN_DIR/cate-fork-update")"
		echo '	<key>StartInterval</key><integer>600</integer>'
		printf '\t<key>StandardOutPath</key><string>%s</string>\n' "$(xml "$LOG")"
		printf '\t<key>StandardErrorPath</key><string>%s</string>\n' "$(xml "$LOG")"
		echo '	<key>LowPriorityIO</key><true/>'
		echo '	<key>Nice</key><integer>10</integer>'
		echo '</dict>'
		echo '</plist>'
	} > "$PLIST.new"
	mv -f "$PLIST.new" "$PLIST"
}

# Settings given at install time are kept for the agent, which has no environment.
write_conf() {
	[ -n "${CATE_FORK_REPO:-}${CATE_FORK_BRANCH:-}${CATE_BUILD_DIR:-}${CATE_APPS_DIR:-}" ] || return 0
	conf="$HOME/.config/cate-fork-update.conf"
	mkdir -p "$HOME/.config"
	# Keys given now replace their line; the other lines of an existing file stay.
	{
		if [ -f "$conf" ]; then
			pat=""
			for k in CATE_FORK_REPO CATE_FORK_BRANCH CATE_BUILD_DIR CATE_APPS_DIR; do
				eval "v=\${$k:-}"
				[ -z "$v" ] || pat="$pat -e ^$k="
			done
			# shellcheck disable=SC2086
			grep -v $pat "$conf" || true
		fi
		for k in CATE_FORK_REPO CATE_FORK_BRANCH CATE_BUILD_DIR CATE_APPS_DIR; do
			eval "v=\${$k:-}"
			[ -z "$v" ] || printf '%s=%s\n' "$k" "$v"
		done
	} > "$conf.new"
	mv -f "$conf.new" "$conf"
}

main() {
	SANS_LAUNCHD=0
	while [ $# -gt 0 ]; do
		case $1 in
			--sans-launchd) SANS_LAUNCHD=1 ;;
			--branche)
				[ $# -ge 2 ] || die "--branche demande un nom de branche, de tag ou de commit" 64
				case $2 in -*) die "branche invalide : $2" 64 ;; esac
				CATE_FORK_BRANCH=$2
				export CATE_FORK_BRANCH
				shift
				;;
			*) die "option inconnue : $1" 64 ;;
		esac
		shift
	done
	[ "$(uname -s)" = Darwin ] || die "macOS uniquement" 2
	RAW=${CATE_FORK_RAW_URL:-https://raw.githubusercontent.com/Heifarabuval/cate/main/scripts}

	# The update script next to this one, else downloaded (curl | sh has no checkout).
	SRC=""
	if [ -f "$0" ] && [ -f "$(dirname "$0")/cate-fork-update.sh" ]; then
		SRC="$(cd "$(dirname "$0")" && pwd)/cate-fork-update.sh"
	else
		TMP=$(mktemp -d)
		trap 'rm -rf "$TMP"' EXIT
		curl --proto '=https' --tlsv1.2 -fsSL -o "$TMP/cate-fork-update.sh" "$RAW/cate-fork-update.sh" || die "téléchargement impossible : $RAW/cate-fork-update.sh (connexion ?)"
		SRC="$TMP/cate-fork-update.sh"
	fi

	# One gate for both scripts, before any path is built on HOME: absolute
	# existing HOME, not root, valid settings and build folder.
	sh "$SRC" --self-test || exit 1

	AGENTS="$HOME/Library/LaunchAgents"
	PLIST="$AGENTS/$LABEL.plist"
	BIN_DIR="$HOME/.local/bin"
	LOG="$HOME/Library/Logs/cate-fork-update.log"

	# One agent only: another label already running cate-fork-update is left as it is.
	for p in "$AGENTS"/*.plist; do
		[ -f "$p" ] || continue
		[ "$(basename "$p")" != "$LABEL.plist" ] || continue
		if grep -q 'cate-fork-update' "$p"; then
			echo "Un agent launchd lance déjà cate-fork-update : $p"
			echo "Rien installé, aucun doublon créé."
			exit 0
		fi
	done

	if ! sh "$SRC" --prereq; then
		echo "Installer ce qui manque (lignes MANQUE), puis recoller la même ligne."
		exit 5
	fi

	mkdir -p "$BIN_DIR" "$HOME/Library/Logs"
	cp "$SRC" "$BIN_DIR/cate-fork-update.new"
	chmod 755 "$BIN_DIR/cate-fork-update.new"
	mv -f "$BIN_DIR/cate-fork-update.new" "$BIN_DIR/cate-fork-update"
	write_conf

	# The agent is loaded before the long first build: a Terminal closed during
	# the build still leaves it, and it takes the build over. It has no RunAtLoad,
	# so its first run comes 10 minutes later and waits on the lock, never races.
	if [ "$SANS_LAUNCHD" = 0 ]; then
		write_plist
		uid=$(id -u)
		launchctl bootout "gui/$uid/$LABEL" > /dev/null 2>&1 || true
		launchctl bootstrap "gui/$uid" "$PLIST" || die "launchctl bootstrap a échoué : $PLIST"
		agent="agent $LABEL toutes les 10 min"
	else
		agent="sans agent (--sans-launchd), à lancer à la main : $BIN_DIR/cate-fork-update"
	fi

	echo "Première construction : 10 à 20 min attendues. Suivi : tail -f $LOG"
	rc=0
	"$BIN_DIR/cate-fork-update" || rc=$?
	if [ "$rc" != 0 ]; then
		tail -n 15 "$LOG" 2> /dev/null || true
	fi

	state=$(tail -n 1 "$LOG" 2> /dev/null || true)
	if [ "$rc" = 0 ]; then
		echo "Fait : $BIN_DIR/cate-fork-update, $agent. Dernier état : ${state:-aucun}"
	else
		echo "Installé, mais la première construction a échoué (code $rc) : $BIN_DIR/cate-fork-update, $agent."
		echo "L'agent la réessaie seul (3 fois au plus par commit). Relancer tout de suite : $BIN_DIR/cate-fork-update --force"
	fi
	echo "Journal : $LOG"
	echo "Désinstaller : curl -fsSL $RAW/cate-fork-uninstall.sh | sh   (ajouter -s -- --purge pour supprimer aussi le dossier de build)"
	exit "$rc"
}

main "$@"
