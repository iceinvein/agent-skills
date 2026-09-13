#!/usr/bin/env bash
# Stop hook: refuse to end the turn in the middle of a deep run.
#
# A turn ends the moment a message carries no tool call, and a run handed back
# that way has nothing in it for the partner to decide: it just stands still
# until they notice, which overnight is the next morning. So when a deep run is
# past pre-flight, has tasks still to go, and nothing is marked blocked or
# paused, the stop is refused with a reason saying what to do instead.
#
# Every stop that is a real stop is let through: no run, a channel other than
# deep, pre-flight not yet answered (that stop is owed), a blocked task, a run
# paused on purpose with `status.sh pause --reason`, every task done (the
# handback), a run idle for a day, a run that lives in another tree than the
# session's, and any attempt where the harness says a stop hook already fired
# this turn, which is what keeps this from looping. One refusal per turn, then:
# a nudge with the state in it rather than a wall.
#
# Reads the harness's stop JSON on stdin for `cwd` and `stop_hook_active`. To
# refuse, prints {"decision":"block","reason":...} on stdout. Always exits 0.

set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
STATUS="$here/status.sh"

# jq first: without it nothing below can run, and the stdin read that follows
# has a worst case worth not paying for nothing.
command -v jq >/dev/null 2>&1 || exit 0

# Byte-wise and bounded, for the reason session-start.sh gives: bash 3.2 drops
# a timed-out partial read, and an inherited open stdin must not hang the stop.
input=""
n=0
if [ ! -t 0 ]; then
	while IFS= read -r -n 1 -t 2 c; do
		if [ -z "$c" ]; then input="$input
"; else input="$input$c"; fi
		# Appending a byte at a time is quadratic, and -t bounds each byte rather
		# than the total. Real stop JSON is under a kilobyte; past this the input
		# is not the harness's and is not worth reading on.
		n=$((n + 1))
		[ "$n" -lt 65536 ] || break
	done
fi

cwd="$PWD"
active="false"
if [ -n "$input" ]; then
	got="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
	[ -n "$got" ] && cwd="$got"
	active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
fi
[ "$active" = "true" ] && exit 0
[ -d "$cwd" ] || exit 0
[ -f "$STATUS" ] || exit 0

# The session's own tree, and only that. status.sh lets a tree with no run of
# its own read the main worktree's, for a controller that moved after init; a
# Stop in such a tree may be an unrelated session, and a remedy printed to it
# would reach into somebody else's run. So the run has to sit in the tree the
# session's cwd belongs to, or there is nothing here to guard.
top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)"
[ -n "$top" ] || top="$cwd"
[ -f "$top/.sluice/run.json" ] || exit 0

run="$(bash "$STATUS" show --json --dir "$top" 2>/dev/null)" || exit 0
[ -n "$run" ] || exit 0

# One JSON object out, read back with jq: the topic is user text, and word
# splitting it would truncate at the first space and glob on the rest.
verdict="$(printf '%s' "$run" | jq -c --argjson now "$(date -u +%s)" '
	(.tasks // []) as $t
	| ([$t[] | select(.status == "done")] | length) as $done
	| ([$t[] | select(.status == "blocked")] | length) as $blocked
	| ([$t[] | select(.status == "todo" or .status == "active" or .status == "review")] | length) as $open
	| ((.updated // .started // "" | try fromdateiso8601 catch 0) as $u
	   | if $u == 0 then 0 else (($now - $u) / 3600 | floor) end) as $idle_h
	| if (.channel // "") != "deep" then {block: false}
	  elif ((.preflight // {}) | length) == 0 then {block: false}
	  elif .paused then {block: false}
	  elif ($t | length) == 0 then {block: false}
	  elif $blocked > 0 then {block: false}
	  elif $open == 0 then {block: false}
	  # A run nobody has written to for a day is a stale run, not a live one;
	  # refusing its stop would press an abandoned plan on whoever opened here.
	  elif $idle_h >= 24 then {block: false}
	  else {block: true, progress: "\($done)/\($t | length)", topic: (.topic // "run")}
	  end
' 2>/dev/null)" || exit 0

[ "$(printf '%s' "$verdict" | jq -r '.block' 2>/dev/null)" = "true" ] || exit 0

printf '%s' "$verdict" | jq 2>/dev/null '{
	decision: "block",
	reason: ("sluice: the deep run \(.topic) is \(.progress) done with tasks still to go and nothing marked blocked or paused, so ending the turn here hands a live run back with nothing for your partner to decide. Continue: run status.sh ready and dispatch the next wave in this same message. If a task genuinely needs them, mark it: status.sh task <id> --status blocked. If the run has to stand still for a reason, record it: status.sh pause --reason \"<why>\", then say so and stop. If this run is not the work you were asked to do, it was left open: status.sh close.")
}'
exit 0
