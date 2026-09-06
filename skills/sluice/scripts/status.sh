#!/usr/bin/env bash
# sluice run state: the task breakdown, in a form something other than a
# language model can read.
#
# The prose run record still holds the reasons and the cross-task findings.
# This file holds only what changes as the run moves, so a statusline, a
# resumed session or a reader who never saw the plan can answer "where is
# this" without parsing markdown.
#
#   status.sh init --topic <t> --channel <c> [--plan <p>] [--record <p>] [--force]
#   status.sh task <id> [--name <n>] [--status <s>] [--base <sha>]
#                       [--commit <sha>] [--tier 0-3] [--model <m>]
#                       [--flips | --no-flips] [--reviewed]
#                       [--needs <syms>] [--offers <syms>] [--touches <paths>]
#   status.sh preflight [--review <t>] [--model <t>] [--workspace <t>]
#   status.sh show [--json]
#   status.sh ready
#   status.sh line [--full]
#   status.sh close
#
# --dir <path> selects the tree to read (default: $PWD). State lives at
# <dir>/.sluice/run.json and closed runs at <dir>/.sluice/archive/. The
# directory ignores itself, so no project needs a .gitignore line for it.
#
# Exit: 0 ok, 1 the state could not be written, 2 no live run, 3 a run is
# already live, 4 bad arguments, 5 jq missing, 6 the state file is unreadable.
# `line` is exempt and always exits 0 in silence, because a statusline renders
# on every keystroke and has nowhere to put an error.
#
# A flag value may not begin with `--`: unchecked, an omitted value silently
# becomes the next flag and the field holds a flag name.

set -uo pipefail

STATUSES="todo active review done blocked"
CHANNELS="bypass fast main deep"

err() { echo "status.sh: $*" >&2; }

usage() {
	echo "usage:" >&2
	sed -n '/^#   status.sh init/,/^# 5 jq missing/p' "$0" | sed 's/^# \{0,2\}//' >&2
}

# A flag's value has to be checked before `shift 2`, not after. Bash refuses to
# shift when fewer than two arguments remain and returns non-zero instead, and
# with no `set -e` the flag loop then spins forever: $# stops decreasing and the
# loop condition stays true. Runs in the current shell rather than a subshell so
# its exit is the script's.
need_value() { # <flag> <remaining $#> <candidate>
	if [ "$2" -lt 2 ]; then
		err "$1 needs a value"
		exit 4
	fi
	case "$3" in
		--*) err "$1 needs a value, but the next argument is the flag $3"; exit 4 ;;
	esac
}

# A word from a space-separated set. Keeps validation in one place so every
# rejection reads the same and names the offending value.
in_set() {
	local needle="$1" hay="$2" w
	for w in $hay; do [ "$w" = "$needle" ] && return 0; done
	return 1
}

# --dir may arrive anywhere in the line, so it is stripped before the
# subcommand's own flag loop ever sees it.
DIR="$PWD"
ARGS=()
while [ $# -gt 0 ]; do
	case "$1" in
		--dir)
			need_value --dir $# "${2-}"
			[ -n "$2" ] || { err "--dir needs a path"; exit 4; }
			DIR="$2"
			shift 2
			;;
		*)
			ARGS+=("$1")
			shift
			;;
	esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

SUB="${1-}"
[ $# -gt 0 ] && shift
if [ -z "$SUB" ]; then
	usage
	exit 4
fi

# A linked worktree is another view of the same run, not a new one. The run
# directory ignores itself, so `git worktree add` never carries it across: read
# from the tree it was called in, the run a plan seeded is absent from every
# implementer created after that plan, and an `init` there lands a rival state
# file that dies with the worktree. Every tree in a set anchors on the main
# worktree instead, which is the one path all of them agree on.
#
# `git worktree list` names the main worktree first. A submodule names its own
# checkout there rather than the superproject's, which is what keeps a
# submodule's run beside its own working tree, and a directory that is no git
# work tree at all is left exactly as it was given.
if [ "$(git -C "$DIR" rev-parse --is-inside-work-tree 2>/dev/null)" = "true" ]; then
	MAIN_TREE="$(git -C "$DIR" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')"
	if [ -n "${MAIN_TREE:-}" ] && [ -d "$MAIN_TREE" ]; then
		DIR="$MAIN_TREE"
	fi
fi

STATE="$DIR/.sluice/run.json"
ARCHIVE="$DIR/.sluice/archive"
LOCK="$DIR/.sluice/run.lock"

# `line` swallows everything: a missing jq, unreadable state, no run at all.
# Any of those printing would put permanent clutter in the status bar.
if [ "$SUB" = "line" ]; then
	FULL=0
	while [ $# -gt 0 ]; do
		case "$1" in
			--full) FULL=1; shift ;;
			*) err "unknown flag: $1"; exit 4 ;;
		esac
	done
	command -v jq >/dev/null 2>&1 || exit 0
	[ -f "$STATE" ] || exit 0

	if [ "$FULL" -eq 0 ]; then
		jq -r '
			([.tasks[]? | select(.status == "done")] | length) as $done
			| [ "sluice",
			    (.channel // "?"),
			    "\($done)/\(.tasks | length)",
			    ([.tasks[]? | select(.status == "active") | "▸T\(.id)"] | first // empty),
			    ([.tasks[]? | select(.status == "blocked") | "!T\(.id)"] | first // empty)
			  ] | join(" ")
		' "$STATE" 2>/dev/null || exit 0
		exit 0
	fi

	# The wide render, three rows: the run and its clock, the bar alone, then the
	# detail. The bar gets a row to itself so it never competes with text for
	# width, which is what lets a cell be wide enough to read as a block.
	#
	# The flip draws as a rule in the bar rather than a name in the first row: it
	# is a boundary between tasks, not a property of one, and the first row cannot
	# say how much of the plan is still reversible.
	#
	# Elapsed is passed in rather than computed here, jq having no clock, and
	# fromdateiso8601 raises rather than returning null, so a bad start time must
	# cost the clock cell and not the render.
	jq -r \
		--argjson now "$(date -u +%s)" \
		--arg esc "$(printf '\033')" '
		def paint($c; $t): "\($esc)[\($c)m\($t)\($esc)[0m";
		def join_parts: map(select(. != null and . != "")) | join(" \($esc)[2m·\($esc)[0m ");
		# Done splits in two. A task that is done and was owed a review nobody has
		# marked keeps the done shape but trails the review glyph, so the debt reads
		# in position rather than only as a count. Tier 0 was never owed a dispatch,
		# so it is plainly done.
		def cellgroup($w):
			(.status == "done"
			 and (.tier // 0) >= 1
			 and (.reviewed // false) == false) as $owed
			| (if   .status == "done"    then ["32", "▰"]
			   elif .status == "active"  then ["96", "◈"]
			   elif .status == "review"  then ["33", "▨"]
			   elif .status == "blocked" then ["91", "▮"]
			   else ["2", "▱"]
			   end) as $s
			| if $owed and $w > 1
			  then paint($s[0]; ($s[1] * ($w - 1))) + paint("33"; "▨")
			  else paint($s[0]; ($s[1] * $w))
			  end;

		# Three cells read as a block, one reads as a tick. The width is chosen from
		# what the whole bar would occupy, gaps and the flip boundary included, so
		# the schedule is monotonic in the task count. Keyed off the count alone it
		# was not: thirty tasks at two wide ran wider than twelve at three.
		(.tasks | length) as $n
		| (if $n == 0 then 3
		   elif ($n * 4 + 2) <= 74 then 3
		   elif ($n * 3 + 2) <= 74 then 2
		   else 1 end) as $w
		| (if $w > 1 then " " else "" end) as $gap
		| ([.tasks[]? | select(.status == "done")] | length) as $done
		| ([.tasks[]? | select(.status == "done" and (.tier // 0) >= 1 and (.reviewed // false) == false)] | length) as $debt
		| [.tasks[]? | select(.status == "blocked")] as $blockedAll
		| [.tasks[]? | select(.status == "active")] as $activeAll
		| ($blockedAll | first) as $blocked
		| ($activeAll | first) as $active
		| (if ($blockedAll | length) > 0 then ($blockedAll | length) else ($activeAll | length) end) as $attn
		| ((.started // "" | try fromdateiso8601 catch 0) as $t
		   | if $t == 0 then ""
		     else (($now - $t) / 60 | floor) as $m
		          | if $m < 1 then "◷ <1m"
		            elif $m < 60 then "◷ \($m)m"
		            else "◷ \($m / 60 | floor)h\($m % 60)m"
		            end
		     end) as $clock
		| ( paint("1;96"; "⧗") + " "
		    + ([ paint("1;96"; (.channel // "?")),
		         paint("2"; (.topic // ""))
		       ] | join_parts)
		    + (if $clock == "" then "" else "   " + paint("2"; $clock) end)
		  ),
		  # The flip is drawn as a rule before its task: everything left of it is
		  # inert and safe to leave landed, everything right of it is not. That is
		  # what the flip means, and a name in the header could not say it.
		  ( "  " + ([ .tasks[]?
		              | (if .flips then paint("95"; "┃") + $gap else "" end)
		                + cellgroup($w)
		            ] | join($gap)) ),
		  ( "  " + ([ paint("1"; "\($done)/\(.tasks | length)") + " done",
		              (if   $blocked then paint("1;91"; "!T\($blocked.id) \($blocked.name // "")")
		               elif $active  then paint("96"; "▸T\($active.id)") + " " + ($active.name // "")
		               else "" end)
		              + (if $attn > 1 then paint("2"; " +\($attn - 1)") else "" end),
		              (if $debt > 0 then paint("33"; "⟲\($debt) unreviewed") else "" end)
		            ] | join_parts)
		  )
	' "$STATE" 2>/dev/null || exit 0
	exit 0
fi

command -v jq >/dev/null 2>&1 || { err "jq is required"; exit 5; }

require_run() {
	[ -f "$STATE" ] || { err "no run is live in $DIR (start one with: status.sh init)"; exit 2; }
}

# Distinct from a missing jq, which is exit 5: reported as that, a corrupt state
# file sends the reader off to install a tool they already have.
require_readable() {
	jq -e . "$STATE" >/dev/null 2>&1 || {
		err "cannot parse $STATE (repair it, or archive it with: status.sh close)"
		exit 6
	}
}

# The run state is working state, not history: the run record is what gets
# committed. So the directory ignores itself, rather than every repo sluice ever
# runs in having to add a line to its own .gitignore. `*` matches the .gitignore
# file too, so the whole directory drops out of `git status`. An existing file is
# left alone, and a tree that refuses the write still gets its run.
mk_dir() { # <directory to create under .sluice>
	mkdir -p "$1" || { err "could not create $1"; exit 1; }
	local ignore="$DIR/.sluice/.gitignore"
	[ -e "$ignore" ] || printf '*\n' >"$ignore" 2>/dev/null || true
}

# Written through a temporary file so an interrupted write cannot leave the
# run state half-serialised, which would read as a corrupted run rather than
# as a failed command.
#
# The candidate is checked before it is installed, because the failure to guard
# against is an empty one rather than a malformed one: `cat` succeeds on empty
# stdin, so a jq that died upstream of this feeds it nothing, and installing
# nothing atomically is still a wipe of the one file in the run that outlives
# compaction. A command that cannot finish leaves the state as it found it.
write_state() {
	local tmp="$STATE.tmp.$$"
	cat >"$tmp"
	if [ ! -s "$tmp" ] || ! jq -e . "$tmp" >/dev/null 2>&1; then
		rm -f "$tmp"
		err "refusing to write $STATE: the update produced no valid state, so the existing state is unchanged"
		exit 1
	fi
	mv "$tmp" "$STATE" || { rm -f "$tmp"; err "could not replace $STATE"; exit 1; }
}

# One state file now serves a whole worktree set, so two implementers can flip
# their own task at the same moment. A flip reads the whole file, edits it with
# jq and writes it back, so unserialised the later write is built on a snapshot
# taken before the earlier one landed and drops that row without saying so.
# mkdir is the atomic primitive every platform this runs on has; flock is Linux
# only. Reads do not take it: write_state installs through a rename, so a reader
# sees either the whole old file or the whole new one.
#
# The holder's pid goes inside the directory so a killed run cannot wedge every
# later one. A lock whose holder is gone is broken rather than waited out, and
# one whose holder is alive is waited on for a bounded time and then reported,
# because a command that hangs in a status bar is worse than one that fails.
lock_taken=0
release_lock() {
	[ "$lock_taken" -eq 1 ] || return 0
	rm -rf "$LOCK"
	lock_taken=0
}

take_lock() {
	local waited=0 holder
	while ! mkdir "$LOCK" 2>/dev/null; do
		holder="$(cat "$LOCK/pid" 2>/dev/null)"
		if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
			rm -rf "$LOCK"
			continue
		fi
		if [ "$waited" -ge 100 ]; then
			err "another sluice command has held $LOCK for 10s; remove it if nothing is running"
			exit 1
		fi
		sleep 0.1
		waited=$((waited + 1))
	done
	printf '%s\n' "$$" >"$LOCK/pid" 2>/dev/null || true
	lock_taken=1
	trap release_lock EXIT INT TERM
}

case "$SUB" in
	init)
		TOPIC="" CHANNEL="" PLAN="" RECORD="" FORCE=0
		while [ $# -gt 0 ]; do
			case "$1" in
				--topic) need_value --topic $# "${2-}"; TOPIC="$2"; shift 2 ;;
				--channel) need_value --channel $# "${2-}"; CHANNEL="$2"; shift 2 ;;
				--plan) need_value --plan $# "${2-}"; PLAN="$2"; shift 2 ;;
				--record) need_value --record $# "${2-}"; RECORD="$2"; shift 2 ;;
				--force) FORCE=1; shift ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done
		[ -n "$TOPIC" ] || { err "init needs --topic"; exit 4; }
		[ -n "$CHANNEL" ] || { err "init needs --channel"; exit 4; }
		in_set "$CHANNEL" "$CHANNELS" || { err "unknown channel: $CHANNEL (one of: $CHANNELS)"; exit 4; }

		mk_dir "$DIR/.sluice"
		take_lock
		if [ -f "$STATE" ] && [ "$FORCE" -eq 0 ]; then
			live="$(jq -r '.topic // "?"' "$STATE" 2>/dev/null || echo "?")"
			err "a run is already live (topic: $live); pass --force to replace it"
			exit 3
		fi

		jq -n \
			--arg topic "$TOPIC" \
			--arg channel "$CHANNEL" \
			--arg started "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
			--arg plan "$PLAN" \
			--arg record "$RECORD" '
			{schema: 1, topic: $topic, channel: $channel, started: $started}
			+ (if $plan == "" then {} else {plan: $plan} end)
			+ (if $record == "" then {} else {record: $record} end)
			+ {tasks: []}
		' | write_state
		;;

	task)
		ID="${1-}"
		[ $# -gt 0 ] && shift
		case "$ID" in
			"" ) err "task needs an id"; exit 4 ;;
			*[!0-9]* | 0 ) err "task id must be a positive integer, got: $ID"; exit 4 ;;
		esac

		NAME="" STATUS="" BASE="" COMMIT="" TIER="" MODEL="" FLIPS=false UNFLIP=false REVIEWED=false
		NEEDS="" OFFERS="" TOUCHES="" GRAPH=0
		while [ $# -gt 0 ]; do
			case "$1" in
				--name) need_value --name $# "${2-}"; NAME="$2"; shift 2 ;;
				--status) need_value --status $# "${2-}"; STATUS="$2"; shift 2 ;;
				--base) need_value --base $# "${2-}"; BASE="$2"; shift 2 ;;
				--commit) need_value --commit $# "${2-}"; COMMIT="$2"; shift 2 ;;
				--tier) need_value --tier $# "${2-}"; TIER="$2"; shift 2 ;;
				--model) need_value --model $# "${2-}"; MODEL="$2"; shift 2 ;;
				--flips) FLIPS=true; shift ;;
				--no-flips) UNFLIP=true; shift ;;
				--reviewed) REVIEWED=true; shift ;;
				--needs) need_value --needs $# "${2-}"; NEEDS="$2"; GRAPH=1; shift 2 ;;
				--offers) need_value --offers $# "${2-}"; OFFERS="$2"; GRAPH=1; shift 2 ;;
				--touches) need_value --touches $# "${2-}"; TOUCHES="$2"; GRAPH=1; shift 2 ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done

		if [ "$FLIPS" = true ] && [ "$UNFLIP" = true ]; then
			err "--flips and --no-flips were both given; they contradict"
			exit 4
		fi
		if [ -n "$STATUS" ]; then
			in_set "$STATUS" "$STATUSES" || { err "unknown status: $STATUS (one of: $STATUSES)"; exit 4; }
		fi
		if [ -n "$TIER" ]; then
			case "$TIER" in
				0|1|2|3) ;;
				*) err "tier must be 0, 1, 2 or 3, got: $TIER"; exit 4 ;;
			esac
		fi

		require_run
		take_lock
		require_readable

		# A row with no name is a number nobody can act on, so a new id has to
		# bring one. An existing id does not, which is what makes every later
		# call a bare status flip.
		#
		# A read that failed is not the same answer as "the id is known", so the
		# count is checked rather than compared: unchecked, an empty result skips
		# the guard the way a hit would.
		known="$(jq --argjson id "$ID" '[.tasks[]? | select(.id == $id)] | length' "$STATE" 2>/dev/null)"
		case "$known" in
			'' | *[!0-9]*) err "could not read the task list from $STATE"; exit 6 ;;
		esac
		if [ "$known" = "0" ] && [ -z "$NAME" ]; then
			err "task $ID is new here, so it needs --name"
			exit 4
		fi

		patch="$(jq -n \
			--arg name "$NAME" --arg status "$STATUS" --arg base "$BASE" \
			--arg commit "$COMMIT" --arg tier "$TIER" --arg model "$MODEL" \
			--argjson flips "$FLIPS" --argjson unflip "$UNFLIP" --argjson reviewed "$REVIEWED" \
			--arg needs "$NEEDS" --arg offers "$OFFERS" --arg touches "$TOUCHES" \
			--argjson graph "$GRAPH" '
			def words: split(" ") | map(select(. != "")) | unique;
			# A given-but-empty column clears the key: the caller passing the graph
			# is authoritative on it, so a dropped edge does not survive.
			def edge($v): if $v == "" then null else ($v | words) end;
			{}
			+ (if $name   == "" then {} else {name: $name} end)
			+ (if $status == "" then {} else {status: $status} end)
			+ (if $base   == "" then {} else {base: $base} end)
			+ (if $commit == "" then {} else {commit: $commit} end)
			+ (if $tier   == "" then {} else {tier: ($tier | tonumber)} end)
			+ (if $model  == "" then {} else {model: $model} end)
			+ (if $flips then {flips: true} else {} end)
			+ (if $unflip then {flips: null} else {} end)
			+ (if $reviewed then {reviewed: true} else {} end)
			+ (if $graph == 0 then {}
			   else {needs: edge($needs), offers: edge($offers), touches: edge($touches)}
			   end)
		')"

		jq --argjson id "$ID" --argjson patch "$patch" '
			.tasks = (
				if any(.tasks[]?; .id == $id)
				then [.tasks[] | if .id == $id then (. + $patch) else . end]
				else .tasks + [{id: $id, status: "todo"} + $patch]
				end
			)
			# A null in the patch means clear, not store: leaving it would make
			# every reader test for absent and for null.
			| .tasks |= map(with_entries(select(.value != null)))
			| .tasks |= sort_by(.id)
		' "$STATE" | write_state
		;;

	preflight)
		REVIEW="" MODEL="" WORKSPACE=""
		while [ $# -gt 0 ]; do
			case "$1" in
				--review) need_value --review $# "${2-}"; REVIEW="$2"; shift 2 ;;
				--model) need_value --model $# "${2-}"; MODEL="$2"; shift 2 ;;
				--workspace) need_value --workspace $# "${2-}"; WORKSPACE="$2"; shift 2 ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done
		if [ -z "$REVIEW$MODEL$WORKSPACE" ]; then
			err "preflight needs at least one of --review, --model, --workspace"
			exit 4
		fi
		require_run
		take_lock
		require_readable

		jq --arg review "$REVIEW" --arg model "$MODEL" --arg workspace "$WORKSPACE" '
			.preflight = ((.preflight // {})
				+ (if $review    == "" then {} else {review: $review} end)
				+ (if $model     == "" then {} else {model: $model} end)
				+ (if $workspace == "" then {} else {workspace: $workspace} end))
		' "$STATE" | write_state
		;;

	show)
		JSON=0
		while [ $# -gt 0 ]; do
			case "$1" in
				--json) JSON=1; shift ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done
		require_run
		require_readable

		if [ "$JSON" -eq 1 ]; then
			jq . "$STATE"
			exit 0
		fi

		# Header and rows are laid out from the same widths, so the two cannot
		# drift apart, and an over-long value is clipped with a marker rather
		# than silently reading as the whole value.
		jq -r '
			def dash: if . == null or . == "" then "-" else . end;
			def cell($w): tostring
				| if length > $w then .[0:$w - 1] + "…"
				  else . + (" " * ($w - length))
				  end;
			def row($c): "  " + ([($c[0] | cell(3)), ($c[1] | cell(8)), ($c[2] | cell(29)),
			                      ($c[3] | cell(9)), ($c[4] | cell(9)), ($c[5] | cell(4)),
			                      $c[6]] | join(" "));
			([.tasks[]? | select(.status == "done")] | length) as $done
			| ["sluice \(.channel) · \(.topic) · \($done)/\(.tasks | length) done"]
			+ ["plan        \(.plan | dash)"]
			+ ["record      \(.record | dash)"]
			+ (([.tasks[]? | select(.status == "done" and (.tier // 0) >= 1 and (.reviewed // false) == false)] | length) as $debt
			   | if $debt == 0 then [] else ["unreviewed  \($debt) done, owed a review the tier table promised"] end)
			+ ["pre-flight  " + (
				if (.preflight // {} | length) == 0 then "not recorded"
				else [(.preflight | to_entries[] | "\(.key)=\(.value)")] | join("; ")
				end)]
			+ [""]
			+ [row(["id", "status", "task", "base", "commit", "tier", "model"])]
			+ [ .tasks[]?
				| (if .flips then "  FLIPS" else "" end) as $flips
				| row([.id, .status, (.name | dash), (.base | dash),
				       (.commit | dash), (.tier | dash), (.model | dash)]) + $flips
			  ]
			| .[]
		' "$STATE"
		;;

	ready)
		[ $# -eq 0 ] || { err "ready takes no arguments"; exit 4; }
		require_run
		require_readable

		# The wave question, which is a graph query rather than a status display:
		# a task is ready when every symbol it Needs is offered by something
		# already done, and two ready tasks are safe together when their Touches
		# are disjoint. Nothing goes concurrent with the flip whatever the graph
		# says, because the invariant it establishes is what later tasks are
		# checked against.
		jq -r '
			# Clipped with a marker, so a cut name does not read as the whole name,
			# and always followed by a gap so it cannot run into the next column.
			def pad($n):
				if length > $n then .[0:$n - 1] + "… "
				else . + (" " * ($n - length + 1))
				end;
			[.tasks[]? | select(.status == "done") | (.offers // [])[]] as $supplied
			| [.tasks[]? | select(((.needs // []) | length) > 0 or ((.touches // []) | length) > 0)] as $withgraph
			| [.tasks[]? | select(.status == "todo" and (.flips // false) == false)] as $pending
			# Active and in-review tasks still hold their paths. Checked only
			# against each other, a wave reads as safe while colliding with work
			# already running, which is worse than not checking at all: the output
			# says "a worktree each".
			| [.tasks[]? | select(.status == "active" or .status == "review")] as $inflight
			| [$pending[] | select([(.needs // [])[] | select(. as $s | $supplied | index($s) == null)] | length == 0)] as $ready
			| [$pending[] | select([(.needs // [])[] | select(. as $s | $supplied | index($s) == null)] | length > 0)] as $waiting
			| ([.tasks[]? | select(.flips)] | first) as $flip

			| if ($withgraph | length) == 0 then
			    "no contract graph in the run state.",
			    "re-run `plan.sh import <plan>` to record Needs, Offers and Touches."
			  else
			    (
			      "\($ready | length) ready now"
			      + (if ($ready | length) > 1 then " · a worktree each" else "" end)
			    ),
			    ($ready[] | "  T\(.id)  \(.name // "" | pad(38))\((.touches // []) | join(", "))"),
			    # A shared path is what rules two ready tasks out of the same wave,
			    # so it is named rather than left to be noticed.
			    ( [ $ready[] as $a | ($ready + $inflight)[] as $b
			        | select($a.id != $b.id)
			        | select(($b.status != "todo") or ($a.id < $b.id))
			        | [(($a.touches // [])[] | select(. as $p | ($b.touches // []) | index($p)))] as $clash
			        | select(($clash | length) > 0)
			        | if $b.status == "todo"
			          then "  T\($a.id) and T\($b.id) share \($clash | join(", ")), so not together"
			          else "  T\($a.id) shares \($clash | join(", ")) with T\($b.id), already \($b.status)"
			          end
			      ] | unique | .[] ),
			    (if ($waiting | length) > 0 then
			       "", "\($waiting | length) waiting on a contract",
			       ($waiting[] | "  T\(.id)  \(.name // "" | pad(38))needs \([(.needs // [])[] | select(. as $s | $supplied | index($s) == null)] | join(", "))")
			     else empty end),
			    (if $flip != null and $flip.status != "done" then
			       "", "the flip runs alone", "  T\($flip.id)  \($flip.name // "")"
			     else empty end)
			  end
		' "$STATE"
		;;

	close)
		[ $# -eq 0 ] || { err "close takes no arguments"; exit 4; }
		require_run
		take_lock

		# Deliberately not `require_readable`. The parse error every other
		# subcommand raises names close as the way out, so close is the one
		# command that has to accept state nothing else will touch: it moves the
		# file aside intact rather than leaving it wedged in the tree.
		started="$(jq -r '.started // empty' "$STATE" 2>/dev/null)"
		topic="$(jq -r '.topic // empty' "$STATE" 2>/dev/null)"
		stamp="$(printf '%s' "$started" | tr -cd '0-9TZ')"
		slug="$(printf '%s' "${topic:-run}" | tr -cs 'A-Za-z0-9._-' '-')"
		[ -n "$stamp" ] || stamp="unknown"
		mk_dir "$ARCHIVE"

		# The archive holds the only copy of a closed run, and two runs sharing a
		# start second and a topic name the same file. mv would leave one of them,
		# so the name gets a suffix rather than the earlier run being silently
		# dropped.
		dest="$ARCHIVE/$stamp-$slug.json"
		n=2
		while [ -e "$dest" ]; do
			dest="$ARCHIVE/$stamp-$slug-$n.json"
			n=$((n + 1))
		done
		mv "$STATE" "$dest"
		;;

	*)
		err "unknown subcommand: $SUB"
		usage
		exit 4
		;;
esac
