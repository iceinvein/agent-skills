#!/usr/bin/env bash
# SessionStart hook: show a live sluice run to the session that just opened.
#
# A deep run outlives the context window that started it. The prose asks the
# model to run `status.sh show` after a compaction, and that is the one rule with
# nothing but memory behind it, in the one moment memory has just been cut. So
# the harness does the asking: on startup, resume, clear and compact this prints
# the run, and on a tree with no run it prints nothing.
#
# Reads the harness's session JSON on stdin for `cwd` and `source`, falling back
# to $PWD when there is none. Always exits 0: a hook that fails is noise in a
# session that has not started yet.

set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
STATUS="$here/status.sh"

# Bounded, and skipped on a terminal: the harness closes stdin after the JSON,
# but a hook that inherits an open, silent stdin would otherwise never return,
# and a hook that never returns holds the session start with it. Read a byte at
# a time: on a timeout bash 3.2, which is what macOS ships, discards whatever
# the interrupted read had gathered where bash 4 keeps it, and a byte read
# whole before the timeout is kept by both, trailing newline or not.
input=""
if [ ! -t 0 ]; then
	while IFS= read -r -n 1 -t 2 c; do
		if [ -z "$c" ]; then input="$input
"; else input="$input$c"; fi
	done
fi
cwd="$PWD"
source=""
if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
	got="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
	[ -n "$got" ] && cwd="$got"
	source="$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null || true)"
fi

# No gate of its own beyond the directory existing: status.sh anchors on the
# main worktree of whatever tree it is given, which is what lets a session
# opened in a subdirectory or a linked worktree find the run, and on a tree
# with no run it exits 2 in silence. Once per session start, that is cheap.
[ -d "$cwd" ] || exit 0
[ -f "$STATUS" ] || exit 0

shown="$(bash "$STATUS" show --dir "$cwd" 2>/dev/null)" || exit 0
[ -n "$shown" ] || exit 0

echo "A sluice run is live in this tree. Its state, from .sluice/run.json:"
echo
echo "$shown"
echo
case "$source" in
	compact | resume | clear)
		echo "This session's context was summarised, resumed or cleared. Read the run record before the next dispatch and trust the two files over what you remember."
		;;
	*)
		echo "If this run is not the work you were asked to continue, it was left open: close it with status.sh close before starting another."
		;;
esac
exit 0
