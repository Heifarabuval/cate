#!/bin/sh
# Removes the launchd agent and the update script of cate-fork-install.sh.
# Usage: cate-fork-uninstall.sh [--purge] [--gardes]
#   --purge   also deletes the build folder (clone, node_modules, staged build)
#   --gardes  also removes the send guards from ~/.claude/settings.json, with the
#             clone's agence CLI, before --purge deletes it
# Never touches the installed Cate.app, the log or ~/.config/cate-fork-update.conf,
# and ~/.claude only with --gardes.
set -eu

LABEL=com.cate.fork-update

# The build folder, read like cate-fork-update does: environment, then the conf, then the default.
build_dir() {
	d=${CATE_BUILD_DIR:-}
	conf=${CATE_FORK_CONF:-$HOME/.config/cate-fork-update.conf}
	if [ -z "$d" ] && [ -f "$conf" ]; then
		d=$(sed -n 's/^CATE_BUILD_DIR=//p' "$conf" | head -n 1)
		d=${d#\"}
		d=${d%\"}
		# shellcheck disable=SC2088  # a literal "~/" typed in the config is matched on purpose
		case $d in "~/"*) d="$HOME/${d#"~/"}" ;; esac
	fi
	printf '%s' "${d:-$HOME/.local/share/cate-build}"
}

main() {
	PURGE=0 GARDES=0 rc=0
	for a in "$@"; do
		case $a in
			--purge) PURGE=1 ;;
			--gardes) GARDES=1 ;;
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

	# Guards first: their CLI lives in the clone that --purge deletes. When they
	# cannot be removed, the clone stays so that a second run can.
	if [ "$GARDES" = 1 ]; then
		AGENCE="$(build_dir)/tools/agence/agence"
		if [ -x "$AGENCE" ]; then
			"$AGENCE" hooks uninstall || { rc=1; PURGE=0; echo "gardes non retirés : dossier de build conservé"; }
		elif grep -q agence-hook "$HOME/.claude/settings.json" 2> /dev/null; then
			rc=1
			echo "gardes non retirés : $AGENCE absent. Dans un terminal Cate : agence hooks uninstall"
		else
			echo "pas de gardes agence"
		fi
	fi

	# The build folder is read from the script's own settings, before the script goes.
	if [ "$PURGE" = 1 ]; then
		# The script checks the folder (named cate-build under HOME, origin = the configured repo) before any rm.
		if [ -x "$BIN" ]; then
			"$BIN" --purge || { rc=1; echo "dossier de build conservé"; }
		else
			echo "script absent : dossier de build non supprimé"
		fi
	fi
	if [ -f "$BIN" ]; then
		rm -f "$BIN"
		echo "script retiré : $BIN"
	fi
	echo "laissé : l'application installée, le journal, ~/.config/cate-fork-update.conf$([ "$GARDES" = 1 ] || echo ', les gardes de ~/.claude/settings.json')"
	exit "$rc"
}

main "$@"
