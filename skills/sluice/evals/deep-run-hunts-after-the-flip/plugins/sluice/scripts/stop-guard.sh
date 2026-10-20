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
# paused on purpose with `status.sh pause --reason`, a task `active` or in
# `review` (an agent is out and will report back), every task done (the
# handback), a run idle for a day, a run another tree owns rather than one this
# tree moved out, and any attempt where the harness says a stop hook already
# fired this turn, which is what keeps this from looping. One refusal per turn, then:
# a nudge with the state in it rather than a wall.
#
# Three checks run ahead of the run guard, all keyed on the tree having moved
# since the session opened: an entry check for a session that never routed, a
# verification gate refusing a fast or main handback with no passing check
# recorded against the tree as it stands, and a test gate refusing a handback
# that weakened an existing test with no record of why (see their own
# sections).
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
#
# The run this session opened in a worktree it never entered is its own too,
# found through the pointer `init` left at the main tree, and it comes ahead of
# the forward: the forward names whichever run was moved last, which with
# several controllers in the main tree may be another session's.
#
# Sets top to the stop's tree and run_tree to the tree holding that run, or
# leaves run_tree empty when there is none. One function for the run guard and
# the board, so the run that keeps a deep session off the board is the run the
# guard would refuse over.
top=""
run_tree=""
resolved=""
resolve_run_tree() {
	local main session_tree="" forward=""
	resolved=1
	run_tree=""
	top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)"
	[ -n "$top" ] || top="$cwd"
	case "$sid" in
		"" | */* | .*) ;;
		*)
			main="$(git -C "$cwd" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
			[ -n "$main" ] && [ -f "$main/.sluice/sessions/$sid" ] \
				&& IFS= read -r session_tree <"$main/.sluice/sessions/$sid" 2>/dev/null
			if [ -z "$session_tree" ] || [ ! -f "$session_tree/.sluice/run.json" ] \
				|| [ "$(jq -r '.session // empty' "$session_tree/.sluice/run.json" 2>/dev/null)" != "$sid" ]; then
				session_tree=""
			fi
			;;
	esac
	if [ -f "$top/.sluice/run.json" ]; then
		run_tree="$top"
	elif [ -n "$session_tree" ]; then
		run_tree="$session_tree"
	elif [ -f "$top/.sluice/run.at" ]; then
		IFS= read -r forward <"$top/.sluice/run.at" 2>/dev/null || return 0
		# A note outliving the run it named is stale, not a run to refuse a stop over.
		[ -n "$forward" ] && [ -f "$forward/.sluice/run.json" ] || return 0
		run_tree="$forward"
	fi
}

# A stop let through is the session handing back, so the board marks it. A
# trap rather than a call before each exit: the hook lets a stop through from
# a dozen places, and a new one added later is covered without anyone having
# to remember the board. Every block decision sets refused first, since a
# refused stop is the session still working. The board's output and failure
# are dropped: stdout carries the decision, and the hook always exits 0.
#
# A deep session whose run is live keeps its entry, because the board draws the
# run's bar for it. Whether the run is live is asked here rather than taken
# from the run guard, since most exits come before the guard runs, and a deep
# session mid-run must not read as handed back on any of them. Resolving costs
# git calls on every stop, so it is skipped for a session with no entry, and
# not repeated when the run guard already did it.
#
# The run resolved is only the one this tree can reach, which through a forward
# or a shared tree may be another session's; that run's bar is not this
# session's work, so the entry is kept only for a run that names this session.
# A run naming no session is no session's own, as the board draws it, and a
# state file that cannot be read names nobody it can be kept for.
refused=""
board_handback() {
	local keep="" root owner
	[ -z "$refused" ] && [ -n "$sid" ] || return 0
	case "$sid" in */* | .*) return 0 ;; esac
	# Must match the root board-index.sh and board.sh resolve.
	if [ -n "${SLUICE_BOARD_DIR:-}" ]; then
		root="$SLUICE_BOARD_DIR"
	elif [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
		root="$CLAUDE_CONFIG_DIR/sluice/board"
	elif [ -n "${HOME:-}" ]; then
		root="$HOME/.claude/sluice/board"
	else
		return 0
	fi
	[ -f "$root/sessions/$sid.json" ] || return 0
	[ -n "$resolved" ] || resolve_run_tree
	if [ -n "$run_tree" ] && owner="$(jq -r '.session // empty' "$run_tree/.sluice/run.json" 2>/dev/null)" \
		&& [ "$owner" = "$sid" ]; then
		keep="--keep-deep"
	fi
	bash "$here/board-index.sh" handback "$sid" $keep >/dev/null 2>&1 || true
}
trap board_handback EXIT

[ "$active" = "true" ] && exit 0
[ -d "$cwd" ] || exit 0

# ---- did the tree move -----------------------------------------------------
# The entry check and the verification gate both start from one question,
# whether the tree moved while this session held it, so it is answered once
# here rather than by reading git twice at the end of every turn. Sets
# moved_tree only when it moved; it stays empty when it did not or when that
# cannot be told.
moved_tree=""
moved_stamp=""
read_moved() {
	local stamp tree line_tree line_digest now
	[ -n "$sid" ] || return 0
	case "$sid" in */* | .*) return 0 ;; esac
	stamp="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}/sluice/stamps/$sid"
	[ -f "$stamp" ] || return 0

	tree="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || return 0
	[ -n "$tree" ] || return 0

	line_tree="$(sed -n '1p' "$stamp" 2>/dev/null)"
	line_digest="$(sed -n '2p' "$stamp" 2>/dev/null)"
	[ -n "$line_tree" ] && [ -n "$line_digest" ] || return 0
	# A session that moved trees carries a baseline for the one it left, and
	# reading this tree's changes against it would be reading someone else's.
	[ "$line_tree" = "$tree" ] || return 0

	# A tree that cannot be read is unknown, not moved. Losing git's exit
	# status here would turn a held lock or a rebase in flight into a refused
	# turn over a tree nobody touched. Without optional locks for the reason
	# session-start.sh gives: a hook must leave the index as it found it.
	now="$(GIT_OPTIONAL_LOCKS=0 bash "$here/tree-snapshot.sh" "$tree" 2>/dev/null)" || return 0
	[ -n "$now" ] || return 0
	[ "$now" = "$line_digest" ] && return 0

	moved_tree="$tree"
	moved_stamp="$stamp"
}
read_moved

# A copy of run-stats.sh's `route` pattern, byte for byte, kept in step with
# that file by hand: both checks below read route calls, and a route the meter
# counts has to be a route here too. One copy in this file, used by both.
route_def='def route: "(?:^|[;&|(])[[:space:]]*(?:(?:bash|sh|zsh)[[:space:]]+)?(?:\"[^\"]*|\u0027[^\u0027]*|[^[:space:];&|\"\u0027]*)status\\.sh[\"\u0027]?[[:space:]]+route[[:space:]]+(fast|main|deep)(?:[[:space:];&|]|$)";'

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
	[ -n "$moved_tree" ] || return 0

	# Two directories rather than one name and one suffixed name: sharing a
	# namespace means a session id ending in `.nudged` silently disarms the
	# session whose id is its prefix.
	local root="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}/sluice"
	[ -f "$root/nudged/$sid" ] && return 0

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
	jq -e -n -R "$route_def"'
		def marker: "^[*_#>[:space:]]*(fast|main|deep)[[:space:]]+channel";
		def lead: "^[^.!?\n]{0,100}[:=][[:space:]]*[*_]*(fast|main|deep)[[:space:]]+channel";
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
	refused=1
	jq -n '{
		decision: "block",
		reason: "sluice: this session has changed the tree since it opened and no channel was ever announced, so the work is running with none of the rules that its shape calls for and nothing to meter it from. Invoke the sluice skill now, route what you have been doing, and say which channel it is. If it genuinely changed nothing you own (a scratch file, or an edit that was not yours), say so and stop; this will not ask twice."
	}'
	return 1
}

if ! entry_nudge; then
	exit 0
fi

# ---- verification gate ----------------------------------------------------
# A fast or main handback is the end of the work, and until now what proved it
# was a prose rule to run the check and read the output, which nothing could
# tell had happened. `status.sh verify` turns that into a record: the content
# digest of the tree, from content-digest.sh, written only when the check
# passed. A stop is refused when the tree moved this session and the record is
# missing or names content the tree no longer holds, which is also the edit
# made after the tests went green, to a tracked file or a new one. A commit of
# the checked content is not a change of content, so it passes.
#
# The channel is the session's last route call, not its first: a session
# rerouted to deep is answered for by the run guard below and `finish`'s full
# suite, and refusing it here as well would hand one turn two refusals. Bypass
# never routes, so it never reaches this. Once per turn comes from the
# `stop_hook_active` exit at the top; a turn that answers the refusal by
# saying why it cannot check is let through on the next attempt.
verify_gate() {
	local channel recorded now
	[ -n "$moved_tree" ] || return 0
	[ -f "$transcript" ] || return 0

	# Unparseable lines are dropped for the reason the entry check gives: the
	# harness is still appending to the transcript as this reads it.
	channel="$(jq -r -n -R "$route_def"'
		[ inputs | fromjson? // empty
			| select((.type == "assistant") and (((.isMeta == true) or (.isSidechain == true)) | not))
			| .message.content[]? | select(.type == "tool_use" and .name == "Bash")
			| (.input.command // "") | match(route; "g") | .captures[0].string ]
		| last // empty
	' "$transcript" 2>/dev/null)" || return 0
	case "$channel" in fast | main) ;; *) return 0 ;; esac

	# Unreadable content is unknown, not changed, as for the entry check.
	now="$(bash "$here/content-digest.sh" "$moved_tree" 2>/dev/null)" || return 0
	[ -n "$now" ] || return 0
	recorded=""
	[ -f "$moved_tree/.sluice/verified" ] && recorded="$(sed -n '1p' "$moved_tree/.sluice/verified" 2>/dev/null)"
	[ "$recorded" = "$now" ] && return 0

	refused=1
	jq -n --arg channel "$channel" '{
		decision: "block",
		reason: ("sluice: this \($channel) session has changed the tree and no passing check is recorded against it as it stands now, so the handback would carry a change nothing has proved. Run the check that proves it through the recorder: status.sh verify -- <cmd> (the tests, the build, whatever exercises this change). If no check can cover it (docs, config), record why: status.sh verify --none \"<reason>\". Then hand back.")
	}'
	return 1
}

if ! verify_gate; then
	exit 0
fi

# ---- test gate -------------------------------------------------------------
# A test edited until it agrees with the new code proves nothing about that
# code, and a passing check cannot tell that edit from an honest one. So a
# changed existing test (a removed line, a deletion, a skip or focus marker,
# as test-changes.sh decides) needs a line in the repo's tests-changed record naming its
# current content: either proved red on the session's base by
# `status.sh tests-changed -- <cmd>`, or recorded unproven with a reason. An
# edit made after its record names other content and is refused again. A new
# test only asks more of the code, so it needs nothing.
#
# The base is line 3 of the stamp read_moved found. A stamp without one, or
# one gc has pruned, is unknown, and test-changes.sh fails on a base it cannot
# read, so either way this stays silent. It applies in every channel, after
# the verify gate so one attempt carries one refusal, and once per turn comes
# from the `stop_hook_active` exit at the top.
test_gate() {
	local base flagged missing p sha rec_sha rec_path rest found
	[ -n "$moved_tree" ] || return 0
	base="$(sed -n '3p' "$moved_stamp" 2>/dev/null)"
	[ -n "$base" ] || return 0
	base="$(git -C "$moved_tree" rev-parse --verify --quiet "$base^{commit}" 2>/dev/null)" || return 0
	[ -n "$base" ] || return 0
	flagged="$(bash "$here/test-changes.sh" "$moved_tree" "$base" 2>/dev/null)" || return 0
	[ -n "$flagged" ] || return 0

	# Records live in the repo's common git dir, one file per status.sh call,
	# shared by every worktree, so a test recorded in the worktree it was edited
	# in still counts once merged here. A record names content, not a tree, so it
	# holds wherever that content is. The tree's own .sluice/tests-changed is
	# where records were written before, and those still stand.
	local common records rec
	common="$(git -C "$moved_tree" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
	records=()
	[ -n "$common" ] && records+=("$common/sluice/tests-changed"/*)
	records+=("$moved_tree/.sluice/tests-changed")

	missing=""
	while IFS= read -r p; do
		if [ -f "$moved_tree/$p" ]; then
			# Hashed the way status.sh records it, path-aware so filters apply.
			# A file that cannot be hashed has no record status.sh could have
			# written either, so it is named as unreadable rather than letting
			# one path silence the gate for every other. A directory where the
			# file was is its deletion, as status.sh reads it.
			sha="$(git -C "$moved_tree" hash-object -- "$p" 2>/dev/null)"
			if [ -z "$sha" ]; then
				missing="$missing$p (cannot be read)"$'\n'
				continue
			fi
		else
			sha="-"
		fi
		found=""
		for rec in "${records[@]}"; do
			[ -f "$rec" ] || continue
			while IFS=$'\t' read -r rec_sha rec_path rest; do
				if [ "$rec_sha" = "$sha" ] && [ "$rec_path" = "$p" ]; then
					found=1
					break
				fi
			done <"$rec"
			[ -n "$found" ] && break
		done
		[ -n "$found" ] || missing="$missing$p"$'\n'
	done <<<"$flagged"
	[ -n "$missing" ] || return 0

	# Paths land in a reason the harness prints, so control bytes are stripped
	# as the run guard strips them from the topic and tree.
	refused=1
	jq -n --arg paths "$missing" --arg base "$base" '{
		decision: "block",
		reason: ("sluice: this session changed existing tests in a way that asks less of the code (an edited or removed assertion, a deleted test, a skip or focus marker), and nothing records why: "
			+ ($paths | split("\n") | map(select(. != "") | gsub("[\u0000-\u001f\u007f]"; "")) | join(", "))
			+ ". A test bent to fit new code proves nothing about it, so each one needs a record against the session base \($base). Prove it fails on the old code: status.sh tests-changed --because \"<the behaviour the change replaces>\" -- <the suite, scoped to these files> (the run is in a scratch worktree of the base, so a node suite usually needs --with node_modules). If it cannot run on the old code, record why: status.sh tests-changed --because \"<the behaviour the change replaces>\" --none \"<why it cannot run on the old code>\". No run can prove a deleted test, so prove the edited ones first, then record each deletion with --none. --only <path> proves or records just those paths, so a fixture that cannot be proved can go to --none --only <fixture> on its own. Then name each changed test, and why it changed, in your reply. The base is where this tree stood when the session opened, so a test that arrived through a merge of another session into this tree since then is listed too. Do not give a reason for a change that is not yours: record it as what it is, status.sh tests-changed --because \"arrived through the merge of <branch>, not from this session\" --none \"not this session to prove\" --only <path>, and name it in your reply as not from this session.")
	}'
	return 1
}

if ! test_gate; then
	exit 0
fi

[ -f "$STATUS" ] || exit 0

resolve_run_tree
[ -n "$run_tree" ] || exit 0
tree="$run_tree"

run="$(bash "$STATUS" show --json --dir "$tree" 2>/dev/null)" || exit 0
[ -n "$run" ] || exit 0

# One JSON object out, read back with jq: the topic is user text, and word
# splitting it would truncate at the first space and glob on the rest.
verdict="$(printf '%s' "$run" | jq -c --argjson now "$(date -u +%s)" --arg tree "$tree" --arg here "$top" '
	(.tasks // []) as $t
	| ([$t[] | select(.status == "done")] | length) as $done
	| ([$t[] | select(.status == "blocked")] | length) as $blocked
	| ([$t[] | select(.status == "active" or .status == "review")] | length) as $inflight
	| ([$t[] | select(.status == "todo")] | length) as $open
	| ((.updated // .started // "" | try fromdateiso8601 catch 0) as $u
	   | if $u == 0 then 0 else (($now - $u) / 3600 | floor) end) as $idle_h
	| if (.channel // "") != "deep" then {block: false}
	  elif ((.preflight // {}) | length) == 0 then {block: false}
	  elif .paused then {block: false}
	  elif ($t | length) == 0 then {block: false}
	  elif $blocked > 0 then {block: false}
	  # `active` is set at dispatch and `review` when the reviewer goes out, so
	  # either means an agent is running that the harness will report back on.
	  # Ending the turn to wait for it is the stop the run wants, not a stall.
	  elif $inflight > 0 then {block: false}
	  elif $open == 0 then {block: false}
	  # A run nobody has written to for a day is a stale run, not a live one;
	  # refusing its stop would press an abandoned plan on whoever opened here.
	  elif $idle_h >= 24 then {block: false}
	  # The topic, the task names and the tree land in a reason the harness
	  # prints, so a control byte in any of them would be acted on by the
	  # terminal rather than read. State written before status.sh refused those,
	  # or edited by hand, can still hold one, and so can a path.
	  else {block: true, progress: "\($done)/\($t | length)",
	        topic: (.topic // "run" | gsub("[\u0000-\u001f\u007f]"; "")),
	        open: ([$t[] | select(.status == "todo")
	                | "T\(.id)" + (.name // "" | gsub("[\u0000-\u001f\u007f]"; "") | if . == "" then "" else " " + . end)]
	               | join(", ")),
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
refused=1
printf '%s' "$verdict" | jq 2>/dev/null '{
	decision: "block",
	reason: ("sluice: the deep run \(.topic) is \(.progress) done with tasks still to go and nothing marked blocked or paused, so ending the turn here hands a live run back with nothing for your partner to decide. Still open: \(.open)."
		+ (if .elsewhere then " The run lives in \(.tree), not in this tree: `move` relocated the run and not this session. If it is yours, move this session into that tree -- the worktree tool in your harness enters one that already exists -- and go on from there." else "" end)
		+ " Continue: run status.sh ready and dispatch the next wave in this same message. If a task genuinely needs them, mark it: status.sh task <id> --status blocked. If the run has to stand still for a reason, record it: status.sh pause --reason \"<why>\", then say so and stop."
		+ (if .elsewhere
		   then " If the run is not yours, it belongs to the session working in \(.tree): say so and stop, rather than closing it from here."
		   else " If this run is not the work you were asked to do, it was left open: status.sh close."
		   end))
}'
exit 0
