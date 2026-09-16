#!/usr/bin/env bash
# Postinstall: tell whoever just installed the skill how to put the run on their
# status bar, and touch nothing.
#
# Wiring it automatically would mean finding their statusline script, and the
# only thing settings.json holds is the shell command that runs it
# (`bash "$HOME/.claude/statusline-command.sh"`). Recovering a path from that is
# parsing a shell string and hoping, on a file the installer never created. So
# this prints the two lines and leaves the editing to a person.
#
# Runs with the bundle root as its working directory, which puts settings.json
# two levels up whether the install went to $HOME/.claude or to a
# $CLAUDE_CONFIG_DIR somewhere else. Always exits 0: a postinstall that fails
# reports an error against an install that in fact succeeded.

set -uo pipefail

BUNDLE="$PWD"
SETTINGS="$BUNDLE/../../settings.json"
RENDER="$BUNDLE/scripts/statusline.sh"

[ -f "$SETTINGS" ] || exit 0
[ -f "$RENDER" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Nothing is said to someone with no statusline configured. Either the install
# claimed the empty slot, in which case the branch below reports it, or this is
# a session-mode install that wires nothing, in which case there is no file to
# paste into and no instruction worth printing.
CONFIGURED="$(jq -r '.statusLine.command // empty' "$SETTINGS" 2>/dev/null || true)"
[ -n "$CONFIGURED" ] || exit 0

RENDER="$(cd "$(dirname "$RENDER")" && pwd)/$(basename "$RENDER")"

# The slot points at the bundled command: the install claimed it and there is
# nothing for anyone to paste. Say so rather than print instructions that would
# have them edit a file they do not have.
case "$CONFIGURED" in
	*skills/sluice/scripts/statusline-command.sh*)
		echo
		echo "sluice: your status line now shows a live run. It draws nothing until one"
		echo "is open, and uninstalling gives the setting back."
		exit 0
		;;
esac

cat <<EOF

sluice: to show a live run on your status line, add these to your statusline
command. The first goes wherever it builds its other lines, the second last of
all, after everything else it prints:

  sluice_line=\$(bash "$RENDER" --dir "\$cwd" 2>/dev/null)

  if [ -n "\$sluice_line" ]; then printf '%s\\n' "\$sluice_line"; fi

\$cwd is workspace.current_dir from the JSON the harness sends on stdin. Those
two lines carry no knowledge of where a run lives, so they stay correct as this
skill changes; every install updates the script behind them.
EOF
