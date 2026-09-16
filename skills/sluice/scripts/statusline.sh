#!/usr/bin/env bash
# Statusline render: the whole sluice contribution to a status bar, behind one
# call. The caller passes the directory the session is in and prints whatever
# comes back.
#
#   statusline.sh [--dir <path>]
#
# --dir defaults to $PWD. Always exits 0 in silence on anything it cannot
# render: a status bar draws on every keystroke and has nowhere to put an error,
# so a message here would be permanent clutter rather than a report anyone acts
# on.
#
# Why this exists as its own script rather than as a snippet in the caller.
# Whether a run is visible from a given directory is a question about sluice's
# own layout, and the answer has changed twice: once when the run anchored on
# the worktree set, once when a deep run began opening inside the implementer
# worktree. Each time, a caller carrying the test went stale and simply stopped
# drawing, silently, because silence is also what it looks like when no run is
# live. Callers now contribute a path and nothing else, and every install brings
# this file up to date behind them.
#
# The gate is still here rather than dropped: measured on this machine, it costs
# about 8ms against the 33ms an ungated status.sh pays to work out there is no
# run, and the common case on any machine is a tree with no run at all. Depth
# barely moves it -- 7.7ms stopping at a .git directory, 8.4ms walking to the
# root -- because the bash spawn is 5.4ms of it and the walk forks nothing.
# It answers only "might a run be visible from here", never "where is it":
# status.sh stays the single authority on resolution, and this stays a
# deliberately over-permissive filter in front of it. A filter that were ever
# narrower than status.sh would blank the bar on a run the code behind it can
# render, which is the whole class of bug this file exists to end.

set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
STATUS="$here/status.sh"

DIR="$PWD"
while [ $# -gt 0 ]; do
	case "$1" in
		--dir)
			# An omitted value would silently make the next flag the directory.
			[ $# -ge 2 ] && [ "${2#--}" = "$2" ] || exit 0
			DIR="$2"
			shift 2
			;;
		*) exit 0 ;;
	esac
done

[ -d "$DIR" ] || exit 0
[ -f "$STATUS" ] || exit 0

# Is a run reachable from here at all? Walk up rather than test $DIR alone: a
# session sitting in a subdirectory of the tree is as entitled to the render as
# one sitting at its root, and testing only $DIR was a second way for the bar to
# go blank on a live run.
#
# Resolve physically first. A directory reached through a symlink has lexical
# parents that are not its real ones, and climbing those walks away from the
# repo instead of up it -- a blank bar on a run status.sh resolves perfectly
# well, which is this file's own failure mode turned on a new input. `cd`
# failing here means the path is gone or unreadable, and there is nothing to
# draw for it.
d="$(cd "$DIR" 2>/dev/null && pwd -P)" || exit 0
[ -n "$d" ] || exit 0

# Four answers end the walk. A state file is a run, wherever it was found. A
# `.git` that is a regular file is a linked worktree or a submodule, which may
# hold no state of its own and still belong to a set that does, so it is a maybe
# and status.sh resolves it. A `.git` that is a directory is the top of an
# ordinary tree with no state beside it, which is a no. So is reaching $HOME:
# without that stop, one forgotten ~/.sluice/run.json would put a status.sh
# spawn on every keystroke of every session outside a repo, for a run that
# resolves to nothing.
#
# `${d%/*}` rather than `dirname`, which is not a builtin: a fork per level
# would put the gate's cost in the same range as the render it is avoiding.
while :; do
	[ -f "$d/.sluice/run.json" ] && break
	[ -f "$d/.git" ] && break
	[ -d "$d/.git" ] && exit 0
	[ "$d" = "${HOME:-}" ] && exit 0
	[ "$d" = "/" ] && exit 0
	d="${d%/*}"
	[ -n "$d" ] || d="/"
done

# $DIR, not the $d the walk stopped at: $d is where the filter gave up looking,
# which is not the same question as where the run is. status.sh anchors on the
# worktree set and is the only thing that decides that.
#
# `line --full` is silent on everything it cannot read, a missing jq and an
# unreadable state file included, and exits 0 either way. The render arrives
# already coloured: the mapping from state to colour belongs next to the state,
# and a caller that applied it would have to re-derive each cell's meaning from
# its glyph.
rendered="$(bash "$STATUS" line --full --dir "$DIR" 2>/dev/null)" || exit 0
[ -n "$rendered" ] || exit 0
printf '%s\n' "$rendered"
