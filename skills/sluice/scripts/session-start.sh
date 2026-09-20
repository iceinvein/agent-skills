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
sid=""
if [ -n "$input" ] && command -v jq >/dev/null 2>&1; then
	got="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
	[ -n "$got" ] && cwd="$got"
	source="$(printf '%s' "$input" | jq -r '.source // empty' 2>/dev/null || true)"
	sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
fi

# The baseline for stop-guard.sh's entry check. That guard asks whether the tree
# moved while this session held it, and this hook runs at the only moment the
# answer is still "not yet". Taken for every session, run or no run: a session
# that routes nothing is exactly the one the guard is there to catch.
#
# It lives beside the transcripts rather than in the tree, because a session
# that opens in someone's repo should not leave a directory behind in it, and
# because a baseline is spent the moment its session ends. A stamp that is
# missing, unreadable or stale costs the guard its check and nothing else, so
# every failure here is silent.
stamp_baseline() {
	local sid="$1" src="$2" tree digest
	[ -n "$sid" ] || return 0
	case "$sid" in */* | .*) return 0 ;; esac
	tree="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || return 0
	[ -n "$tree" ] || return 0

	local dir="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}/sluice/stamps"
	mkdir -p "$dir" 2>/dev/null || return 0

	# This hook fires again on compact, resume and clear, all carrying the
	# session id the first one carried, and they are not the same event.
	#
	# A compact happens inside a session that never let go of the tree, so its
	# baseline still stands; re-stamping there would move it onto the work
	# already done and read a half-finished session as an untouched tree, and a
	# session long enough to compact is the one this exists for.
	#
	# A resume reopens a session that had stopped, and a clear throws away what
	# it was doing. Both leave the old baseline describing a tree from some
	# unbounded time ago, and everything that happened to it since, by a
	# colleague or an editor or another session, would be charged to whoever
	# reopens it. Those two start again, and give back the nudge the previous
	# sitting may have spent.
	case "$src" in
		resume | clear) rm -f "$dir/$sid" "${dir%/stamps}/nudged/$sid" 2>/dev/null || true ;;
		*) [ -e "$dir/$sid" ] && return 0 ;;
	esac

	# A stamp outlives nothing but its session, and the harness never deletes
	# one. Without this the directory grows for the life of the machine.
	find "$dir" "${dir%/stamps}/nudged" -type f -mtime +7 -delete 2>/dev/null || true

	digest="$(bash "$here/tree-snapshot.sh" "$tree" 2>/dev/null)" || return 0
	[ -n "$digest" ] || return 0
	printf '%s\n%s\n' "$tree" "$digest" >"$dir/$sid" 2>/dev/null || true
}
stamp_baseline "$sid" "$source"

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
