#!/bin/sh
# Removes the launchd agent and the update script of cate-fork-install.sh.
# Usage: cate-fork-uninstall.sh [--purge]
#   --purge  also deletes the build folder (clone, node_modules, staged build)
# Never touches the installed Cate.app, the log or ~/.config/cate-fork-update.conf.
set -eu

LABEL=com.cate.fork-update

main() {
	PURGE=0
	for a in "$@"; do
		case $a in
			--purge) PURGE=1 ;;
			*) echo "option inconnue : $a" >&2; exit 64 ;;
		esac
	done
	[ "$(uname -s)" = Darwin ] || { echo "macOS uniquement" >&2; exit 2; }
	[ -n "${HOME:-}" ] && [ -d "$HOME" ] || { echo "HOME introuvable" >&2; exit 1; }

	PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
	BIN="$HOME/.local/bin/cate-fork-update"

	launchctl bootout "gui/$(id -u)/$LABEL" > /dev/null 2>&1 || true
	if [ -f "$PLIST" ]; then
		rm -f "$PLIST"
		echo "agent retiré : $PLIST"
	else
		echo "pas d'agent $LABEL"
	fi

	# The build folder is read from the script's own settings, before the script goes.
	if [ "$PURGE" = 1 ]; then
		if [ -x "$BIN" ]; then "$BIN" --purge; else echo "script absent : dossier de build non supprimé"; fi
	fi
	if [ -f "$BIN" ]; then
		rm -f "$BIN"
		echo "script retiré : $BIN"
	fi
	echo "laissé : l'application installée, le journal, ~/.config/cate-fork-update.conf"
}

main "$@"
