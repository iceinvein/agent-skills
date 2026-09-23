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
# handback), a run idle for a day, a run another tree owns rather than one this
# tree moved out, and any attempt where the harness says a stop hook already
# fired this turn, which is what keeps this from looping. One refusal per turn, then:
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
sid=""
transcript=""
if [ -n "$input" ]; then
	got="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)"
	[ -n "$got" ] && cwd="$got"
	active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)"
	sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
	transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)"
fi
[ "$active" = "true" ] && exit 0
[ -d "$cwd" ] || exit 0

# ---- entry check --------------------------------------------------------
# The run guard below only arms once .sluice/run.json exists, and that file
# only exists once the skill has been invoked. So the session that never
# routed at all, the one this whole guard is for, walks straight past it in
# silence. This catches that session from the other end: the tree moved while
# it held it, and no channel was ever announced.
#
# The comparison is against where the tree stood when the session opened, not
# against whether it is dirty now. A session that opens on someone's
# work-in-progress and only answers questions changed nothing, and nudging it
# would teach its partner to ignore the nudge.
#
# Refused once and then never again for this session: the check cannot tell
# a partner who routed afterwards from one who read the nudge and chose to
# carry on, and only the first of those is worth a second refusal.
#
# The stamp is per session and the tree it watches is not, so anything else
# writing to the tree reads as this session's work: a second session, the
# partner's own editor, an install touching a lockfile, a build emitting
# something the tree does not ignore. There is nothing in a git tree that
# attributes a change to who made it, so this is not fixable here, only
# bounded: one refusal per session, and a reason that offers "not mine" as an
# answer and takes it.
entry_nudge() {
	local stamps tree line_tree line_digest now
	[ -n "$sid" ] || return 0
	case "$sid" in */* | .*) return 0 ;; esac

	# Two directories rather than one name and one suffixed name: sharing a
	# namespace means a session id ending in `.nudged` silently disarms the
	# session whose id is its prefix.
	local root="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}/sluice"
	stamps="$root/stamps"
	[ -f "$stamps/$sid" ] || return 0
	[ -f "$root/nudged/$sid" ] && return 0

	tree="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || return 0
	[ -n "$tree" ] || return 0

	line_tree="$(sed -n '1p' "$stamps/$sid" 2>/dev/null)"
	line_digest="$(sed -n '2p' "$stamps/$sid" 2>/dev/null)"
	[ -n "$line_tree" ] && [ -n "$line_digest" ] || return 0
	# A session that moved trees carries a baseline for the one it left, and
	# reading this tree's changes against it would be reading someone else's.
	[ "$line_tree" = "$tree" ] || return 0

	# A tree that cannot be read is unknown, not moved. Losing git's exit
	# status here would turn a held lock or a rebase in flight into a refused
	# turn over a tree nobody touched.
	now="$(bash "$here/tree-snapshot.sh" "$tree" 2>/dev/null)" || return 0
	[ -n "$now" ] || return 0
	[ "$now" = "$line_digest" ] && return 0

	# Whether the session routed is read exactly the way run-stats.sh reads it,
	# from a copy of its `marker`, `lead` and `route` patterns and its
	# `invokes_sluice`: a gate that disagreed with the meter would refuse turns
	# the ledger reports as a run. The copy is kept in step with that file by
	# hand.
	#
	# Lines are parsed one at a time and unparseable ones dropped, because the
	# harness is still appending to this file while the hook reads it and the
	# last line is regularly half written. Slurping would fail on that whole
	# file and read a routed session as an unrouted one.
	[ -f "$transcript" ] || return 0
	jq -e -n -R '
		def marker: "^[*_#>[:space:]]*(fast|main|deep)[[:space:]]+channel";
		def lead: "^[^.!?\n]{0,100}[:=][[:space:]]*[*_]*(fast|main|deep)[[:space:]]+channel";
		def route: "(^|[[:space:]/])status\\.sh[[:space:]]+route[[:space:]]+(fast|main|deep)([[:space:]]|$)";
		def texts: [ .message.content[]? | select(.type == "text") | .text ] | join("\n");
		def routes: [ .message.content[]? | select(.type == "tool_use" and .name == "Bash")
			| (.input.command // "") | select(test(route)) ];
		def invokes_sluice: [ .message.content[]?
			| select(.type == "tool_use" and .name == "Skill")
			| .input.skill? // empty ] | any(. == "sluice");
		[ inputs | fromjson? // empty ]
		| any(.[];
			(.type == "assistant") and (((.isMeta == true) or (.isSidechain == true)) | not)
			and ((texts | test(marker; "i") or test(lead; "i")) or (routes | length > 0) or invokes_sluice))
	' "$transcript" >/dev/null 2>&1
	case "$?" in
		# 0 routed, 1 not. Anything else is jq failing rather than an answer
		# about this session, and an unanswered question is not a refusal.
		0) return 0 ;;
		1) ;;
		*) return 0 ;;
	esac

	mkdir -p "$root/nudged" 2>/dev/null || true
	: >"$root/nudged/$sid" 2>/dev/null || true
	jq -n '{
		decision: "block",
		reason: "sluice: this session has changed the tree since it opened and no channel was ever announced, so the work is running with none of the rules that its shape calls for and nothing to meter it from. Invoke the sluice skill now, route what you have been doing, and say which channel it is. If it genuinely changed nothing you own (a scratch file, or an edit that was not yours), say so and stop; this will not ask twice."
	}'
	return 1
}

if ! entry_nudge; then
	exit 0
fi

[ -f "$STATUS" ] || exit 0

# The run the session's own tree answers for, and only that: the state beside
# it, or the state it forwarded into a worktree when `move` sent the run on
# without the session. status.sh also lets a tree with no run of its own read
# the main worktree's, and that one is not taken here: a Stop in such a tree may
# be an unrelated session, and a remedy printed to it would reach into somebody
# else's run.
#
# The forward is read here rather than left to status.sh's resolution because
# the two questions differ. Resolution answers "which run can this tree read",
# which is the right question for a render and the wrong one for a refusal. The
# tree named in the note is then passed as `--dir`, so what follows asks about
# one named tree and carries no layout knowledge of its own.
top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)"
[ -n "$top" ] || top="$cwd"
if [ -f "$top/.sluice/run.json" ]; then
	tree="$top"
elif [ -f "$top/.sluice/run.at" ]; then
	tree=""
	IFS= read -r tree <"$top/.sluice/run.at" 2>/dev/null || exit 0
	# A note outliving the run it named is stale, not a run to refuse a stop over.
	[ -n "$tree" ] && [ -f "$tree/.sluice/run.json" ] || exit 0
else
	exit 0
fi

run="$(bash "$STATUS" show --json --dir "$tree" 2>/dev/null)" || exit 0
[ -n "$run" ] || exit 0

# One JSON object out, read back with jq: the topic is user text, and word
# splitting it would truncate at the first space and glob on the rest.
verdict="$(printf '%s' "$run" | jq -c --argjson now "$(date -u +%s)" --arg tree "$tree" --arg here "$top" '
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
	  # The topic and the tree land in a reason the harness prints, so a control
	  # byte in either would be acted on by the terminal rather than read. State
	  # written before status.sh refused those, or edited by hand, can still hold
	  # one, and so can a path.
	  else {block: true, progress: "\($done)/\($t | length)",
	        topic: (.topic // "run" | gsub("[\u0000-\u001f\u007f]"; "")),
	        tree: ($tree | gsub("[\u0000-\u001f\u007f]"; "")),
	        elsewhere: ($tree != $here)}
	  end
' 2>/dev/null)" || exit 0

[ "$(printf '%s' "$verdict" | jq -r '.block' 2>/dev/null)" = "true" ] || exit 0

# Two remedies, because the last line of the local one is wrong once the run
# has moved: `close` from here would archive a run that is live in another tree
# and may be another session's, which is the one thing this hook must never talk
# anyone into. What replaces it is the step `move` could not take -- the session
# following the run -- because a controller guarded here is a controller sitting
# in the tree its own run left.
printf '%s' "$verdict" | jq 2>/dev/null '{
	decision: "block",
	reason: ("sluice: the deep run \(.topic) is \(.progress) done with tasks still to go and nothing marked blocked or paused, so ending the turn here hands a live run back with nothing for your partner to decide."
		+ (if .elsewhere then " The run lives in \(.tree), not in this tree: `move` relocated the run and not this session. If it is yours, move this session into that tree -- the worktree tool in your harness enters one that already exists -- and go on from there." else "" end)
		+ " Continue: run status.sh ready and dispatch the next wave in this same message. If a task genuinely needs them, mark it: status.sh task <id> --status blocked. If the run has to stand still for a reason, record it: status.sh pause --reason \"<why>\", then say so and stop."
		+ (if .elsewhere
		   then " If the run is not yours, it belongs to the session working in \(.tree): say so and stop, rather than closing it from here."
		   else " If this run is not the work you were asked to do, it was left open: status.sh close."
		   end))
}'
exit 0
