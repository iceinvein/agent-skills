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
#   status.sh final
#   status.sh move --to <tree>
#   status.sh pause --reason <text>
#   status.sh resume
#   status.sh line [--full]
#   status.sh close
#
# --dir <path> selects the tree to read (default: $PWD). State lives at
# <dir>/.sluice/run.json and closed runs at <dir>/.sluice/archive/. A tree the
# run has moved out of keeps <dir>/.sluice/run.at, one line naming the tree it
# went to, so a session still sitting there resolves the run rather than reading
# it as gone. The directory ignores itself, so no project needs a .gitignore
# line for it.
#
# Exit: 0 ok, 1 the state could not be written, 2 no live run, 3 a run is
# already live (here, or at move's destination), 4 bad arguments, 5 jq missing,
# 6 the state file is unreadable.
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
	sed -n '/^#   status.sh init/,/unreadable\.$/p' "$0" | sed 's/^# \{0,2\}//' >&2
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
	# Every value this script stores is later drawn onto a terminal, by the
	# statusline, by `show` and by the SessionStart hook. A control byte in one is
	# not text there, it is a command the terminal obeys: ESC[2J clears the screen
	# on every render for as long as the run is open, and a carriage return walks
	# the cursor back over the row just drawn. Refused rather than stripped,
	# because a name that is not the name the caller passed is its own surprise,
	# and no legitimate value has ever needed one.
	case "$3" in
		*[[:cntrl:]]*) err "$1 value contains a control character, which a terminal would act on rather than print"; exit 4 ;;
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

# One function rather than the same pipeline at three call sites, because they
# have to agree: the tree resolution anchors on and the tree `move` and `close`
# leave their forwarding note in are the same tree by definition, and a note
# left anywhere else is a note nothing reads. Empty for a directory that is no
# git work tree.
main_tree() { # <dir>
	git -C "$1" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p'
}

# A tree's own run comes first, and only a tree with none reads the set's. Two
# layouts share this script and pull opposite ways. A deep run plans in the main
# tree and cuts implementer worktrees after the plan: the run directory ignores
# itself, so `git worktree add` never carries it across, and read from the tree
# it was called in the run would be absent from every implementer. Those trees
# hold no run of their own, so they anchor on the main worktree, the one path
# the set agrees on. Independent sessions, one per worktree, each start a run
# where they sit: anchored unconditionally, the first `init` in the set took
# over every other session's statusline and refused every other `init`. So
# `init` always lands in the tree it was given, and every other command reads
# the tree's own state when it has one.
#
# `git worktree list` names the main worktree first. A submodule names its own
# checkout there rather than the superproject's, which is what keeps a
# submodule's run beside its own working tree, and a directory that is no git
# work tree at all is left exactly as it was given.
#
# The tree the command was issued from, kept apart from the anchored one: a
# base defaulted at dispatch is the HEAD of the tree the implementer is about to
# be cut from, which in a worktree set is not always the main worktree's.
ORIG_DIR="$DIR"
if [ "$SUB" != "init" ] && [ ! -f "$DIR/.sluice/run.json" ] \
	&& [ "$(git -C "$DIR" rev-parse --is-inside-work-tree 2>/dev/null)" = "true" ]; then
	MAIN_TREE="$(main_tree "$DIR")"
	if [ -n "${MAIN_TREE:-}" ] && [ -d "$MAIN_TREE" ]; then
		DIR="$MAIN_TREE"

		# Then forward, where the main tree's run has moved on into a worktree.
		# A `move` is half a step: it relocates the state and cannot relocate the
		# session, the harness holding one working directory that no command here
		# reaches. So the controller's session goes on asking about the tree it
		# still sits in, and per-tree resolution answers that the run is gone --
		# to its statusline, to the SessionStart hook and to a bare `show`, all
		# on a run that is live two directories away.
		#
		# The note lives at the main tree and nowhere else, so a run moved twice
		# forwards once rather than down a chain, and so the tree every other
		# tree in the set already resolves to is the tree that knows. It is
		# followed only while the run it names is really there: a note outliving
		# its run is stale, not a second answer.
		if [ ! -f "$DIR/.sluice/run.json" ] && [ -f "$DIR/.sluice/run.at" ]; then
			# `read`, not `cat`: a builtin, and the first line is the whole note.
			AT=""
			IFS= read -r AT <"$DIR/.sluice/run.at" 2>/dev/null || true
			[ -n "$AT" ] && [ -f "$AT/.sluice/run.json" ] && DIR="$AT"
		fi
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
			    ([.tasks[]? | select(.status == "blocked") | "!T\(.id)"] | first // empty),
			    (if .paused then "paused" else empty end)
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
		# The state file is an input like any other: it predates the check on the
		# way in, or was hand-edited, so what it holds is not known to be drawable.
		# Everything this render emits deliberately is an SGR colour sequence, so any
		# other control byte reaching the terminal came from the state, and is dropped
		# here rather than obeyed.
		def clean: if type == "string" then gsub("[\u0000-\u001f\u007f]"; "") else . end;
		def paint($c; $t): "\($esc)[\($c)m\($t)\($esc)[0m";
		def join_parts: map(select(. != null and . != "")) | join(" \($esc)[2m·\($esc)[0m ");
		# Done splits in two. A task that is done and got no dispatch keeps the done
		# shape but trails the review glyph, so where the gap is reads in position
		# rather than only as a count. Tier 0 was never owed a dispatch, so it is
		# plainly done. $mark is the marker colour: a level pre-flight chose is a
		# fact about coverage and draws dim, one nobody priced is a warning.
		def cellgroup($w; $mark):
			(.status == "done"
			 and (.tier // 0) >= 1
			 and (.reviewed // false) == false) as $nodispatch
			| (if   .status == "done"    then ["32", "▰"]
			   elif .status == "active"  then ["96", "◈"]
			   elif .status == "review"  then ["33", "▨"]
			   elif .status == "blocked" then ["91", "▮"]
			   else ["2", "▱"]
			   end) as $s
			| if $nodispatch and $w > 1
			  then paint($s[0]; ($s[1] * ($w - 1))) + paint($mark; "▨")
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
		| ([.tasks[]? | select(.status == "done" and (.tier // 0) >= 1 and (.reviewed // false) == false)] | length) as $nodispatch
		# A pre-flight review answer on file means the stop happened and the level
		# was priced, so the tasks it skipped were spent rather than forgotten. The
		# count is the same either way, because the gap in the code is the same; the
		# word is not, and "unreviewed" on a level someone chose reads as a nag.
		| (((.preflight.review // "") | length) > 0) as $priced
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
		# Idle is the time since the last write, and it only shows once it passes
		# a day: a run in progress is written every few minutes, so a day of
		# silence is a run that was forgotten or finished without being closed. A
		# run written before `updated` existed falls back to `started`.
		| ((.updated // .started // "" | try fromdateiso8601 catch 0) as $u
		   | if $u == 0 then ""
		     else (($now - $u) / 3600 | floor) as $h
		          | if $h < 24 then ""
		            else "idle \($h / 24 | floor)d\($h % 24)h"
		            end
		     end) as $idle
		| ( paint("1;96"; "⧗") + " "
		    + ([ paint("1;96"; (.channel // "?")),
		         paint("2"; (.topic // "" | clean))
		       ] | join_parts)
		    + (if $clock == "" then "" else "   " + paint("2"; $clock) end)
		    + (if $idle == "" then "" else " " + paint("2"; "·") + " " + paint("33"; $idle) end)
		    + (if .paused then " " + paint("2"; "·") + " " + paint("33"; "paused") else "" end)
		  ),
		  # The flip is drawn as a rule before its task: everything left of it is
		  # inert and safe to leave landed, everything right of it is not. That is
		  # what the flip means, and a name in the header could not say it.
		  ( "  " + ([ .tasks[]?
		              | (if .flips then paint("95"; "┃") + $gap else "" end)
		                + cellgroup($w; (if $priced then "2" else "33" end))
		            ] | join($gap)) ),
		  ( "  " + ([ paint("1"; "\($done)/\(.tasks | length)") + " done",
		              (if   $blocked then paint("1;91"; "!T\($blocked.id) \($blocked.name // "" | clean)")
		               elif $active  then paint("96"; "▸T\($active.id)") + " " + ($active.name // "" | clean)
		               else "" end)
		              + (if $attn > 1 then paint("2"; " +\($attn - 1)") else "" end),
		              (if $nodispatch == 0 then ""
		               elif $priced then paint("2"; "⟲ \($nodispatch) at the chosen level")
		               else paint("33"; "⟲ \($nodispatch) unreviewed")
		               end)
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
mk_dir() { # <directory to create under .sluice> [<tree whose .sluice it is, default $DIR>]
	mkdir -p "$1" || { err "could not create $1"; exit 1; }
	local ignore="${2:-$DIR}/.sluice/.gitignore"
	[ -e "$ignore" ] || printf '*\n' >"$ignore" 2>/dev/null || true
}

# Where the set's run went, written at the main tree for resolution to follow.
# Not `mk_dir`, which exits: this runs after the state has already arrived in
# the destination, and a note that could not be written is a blank statusline
# in one tree rather than a move that failed. The caller reports it instead.
leave_note() { # <main tree> <tree the run is now in>
	mkdir -p "$1/.sluice" 2>/dev/null || return 1
	[ -e "$1/.sluice/.gitignore" ] || printf '*\n' >"$1/.sluice/.gitignore" 2>/dev/null || true
	printf '%s\n' "$2" >"$1/.sluice/run.at" 2>/dev/null
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
#
# Every write stamps `updated`, which is what lets a reader tell a run that is
# moving from one that was left behind: `started` only says how old it is.
write_state() {
	local tmp="$STATE.tmp.$$" stamped="$STATE.stamped.$$"
	cat >"$tmp"
	# One jq does both the check and the stamp: it fails on malformed input and
	# writes nothing on empty input, and either leaves the candidate unfit.
	if ! jq --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 'if type != "object" then error("state is not an object") else .updated = $now end' "$tmp" >"$stamped" 2>/dev/null || [ ! -s "$stamped" ]; then
		rm -f "$tmp" "$stamped"
		err "refusing to write $STATE: the update produced no valid state, so the existing state is unchanged"
		exit 1
	fi
	rm -f "$tmp"
	mv "$stamped" "$STATE" || { rm -f "$stamped"; err "could not replace $STATE"; exit 1; }
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
# `move` spans two trees and holds both locks, so the locks taken are a list.
LOCKS_TAKEN=()
release_lock() {
	local l
	for l in "${LOCKS_TAKEN[@]+"${LOCKS_TAKEN[@]}"}"; do rm -rf "$l"; done
	LOCKS_TAKEN=()
}

take_lock() { # [<lock path>, default the run's own]
	local lock="${1:-$LOCK}" waited=0 holder
	while ! mkdir "$lock" 2>/dev/null; do
		holder="$(cat "$lock/pid" 2>/dev/null)"
		if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
			rm -rf "$lock"
			continue
		fi
		if [ "$waited" -ge 100 ]; then
			err "another sluice command has held $lock for 10s; remove it if nothing is running"
			exit 1
		fi
		sleep 0.1
		waited=$((waited + 1))
	done
	printf '%s\n' "$$" >"$lock/pid" 2>/dev/null || true
	LOCKS_TAKEN+=("$lock")
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
			err "a run is already live (topic: $live). If it is yours and your work runs in a worktree, put it there: status.sh move --to <worktree>. If it is another session's, leave it and start yours from your own worktree. If it is finished, status.sh close; --force replaces it"
			exit 3
		fi

		# Other trees in the set may hold runs of their own, legitimately or as
		# one stranded before its session moved into a worktree. Said, never
		# refused: the session starting here cannot tell which, and the one that
		# can is the owner.
		if [ "$(git -C "$DIR" rev-parse --is-inside-work-tree 2>/dev/null)" = "true" ]; then
			here="$(cd "$DIR" && pwd -P)"
			git -C "$DIR" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | while IFS= read -r tree; do
				[ -d "$tree" ] || continue
				[ "$(cd "$tree" && pwd -P)" != "$here" ] || continue
				[ -f "$tree/.sluice/run.json" ] || continue
				other="$(jq -r '.topic // "?"' "$tree/.sluice/run.json" 2>/dev/null || echo "?")"
				err "note: another run is live in $tree (topic: $other); if it is this work stranded before a worktree was cut, move it there instead"
			done
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

		# The base is cheap to know at dispatch and archaeology afterwards, and
		# the guess it gets recovered as is HEAD~1. So a task going active with
		# no base takes the HEAD of the tree the command was issued from, once:
		# a base already on the row was a decision and a second flip keeps it.
		if [ "$STATUS" = "active" ] && [ -z "$BASE" ]; then
			has_base="$(jq --argjson id "$ID" '[.tasks[]? | select(.id == $id and .base != null)] | length' "$STATE" 2>/dev/null)"
			case "$has_base" in
				'' | *[!0-9]*) err "could not read the task list from $STATE"; exit 6 ;;
			esac
			if [ "$has_base" = "0" ]; then
				BASE="$(git -C "$ORIG_DIR" rev-parse --short HEAD 2>/dev/null || true)"
			fi
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

		# Where the run is, said only when that is not the tree the command was
		# pointed at. A run read from a tree it does not live in answers "where
		# is this" silently wrong otherwise: the reader takes the tree they are
		# in, which after a `move` is the one tree the run is not in.
		#
		# A directory inside the tree holding the run is that tree, one level
		# down, not somewhere else -- without that, the row would fire on every
		# session that works from a subdirectory.
		ELSEWHERE=""
		run_tree="$(cd "$DIR" 2>/dev/null && pwd -P)"
		asked="$(cd "$ORIG_DIR" 2>/dev/null && pwd -P)"
		if [ -n "$run_tree" ] && [ -n "$asked" ]; then
			case "$asked" in
				"$run_tree" | "$run_tree"/*) ;;
				*) ELSEWHERE="$run_tree" ;;
			esac
		fi

		# Header and rows are laid out from the same widths, so the two cannot
		# drift apart, and an over-long value is clipped with a marker rather
		# than silently reading as the whole value.
		jq -r --argjson now "$(date -u +%s)" --arg elsewhere "$ELSEWHERE" '
			def dash: if . == null or . == "" then "-" else . end;
			# Same reason as the statusline render: state written before the check
			# on the way in, or edited by hand, holds bytes a terminal would act on
			# rather than print. Every table cell passes through `cell`, so the
			# table is covered there; the lines built outside it clean their own.
			def clean: if type == "string" then gsub("[\u0000-\u001f\u007f]"; "") else . end;
			def cell($w): tostring | clean
				| if length > $w then .[0:$w - 1] + "…"
				  else . + (" " * ($w - length))
				  end;
			def row($c): "  " + ([($c[0] | cell(3)), ($c[1] | cell(8)), ($c[2] | cell(29)),
			                      ($c[3] | cell(9)), ($c[4] | cell(9)), ($c[5] | cell(4)),
			                      $c[6]] | join(" "));
			([.tasks[]? | select(.status == "done")] | length) as $done
			| ["sluice \(.channel | clean) · \(.topic | clean) · \($done)/\(.tasks | length) done"]
			+ (if $elsewhere == "" then [] else ["tree          \($elsewhere | clean)"] end)
			+ ["plan          \(.plan | dash | clean)"]
			+ ["record        \(.record | dash | clean)"]
			# Past a day since the last write the run is idle, and that is said
			# here because a stale run blocks the next init and nothing else
			# would name it.
			# A run written before `updated` existed falls back to `started`,
			# which is the case the line was added for.
			+ ((.updated // .started // "" | try fromdateiso8601 catch 0) as $u
			   | if $u == 0 then []
			     else (($now - $u) / 3600 | floor) as $h
			          | if $h < 24 then []
			            else ["idle          \($h / 24 | floor)d\($h % 24)h since the last write"]
			            end
			     end)
			+ (if .paused then ["paused        \(.paused | clean)"] else [] end)
			# Same count, two readings. A pre-flight review answer on file says the
			# level was priced at the stop, so what it skipped is the coverage of this
			# run. With no answer on file nobody priced anything and the dispatches in
			# the tier table are still owed. The answer itself is not repeated here:
			# the pre-flight row below carries it, three lines down.
			+ (([.tasks[]? | select(.status == "done" and (.tier // 0) >= 1 and (.reviewed // false) == false)] | length) as $nodispatch
			   | if $nodispatch == 0 then []
			     elif ((.preflight.review // "") | length) > 0
			     then ["coverage      \($nodispatch) done at tier 1+, no dispatch"]
			     else ["unreviewed    \($nodispatch) done at tier 1+, owed a review and no pre-flight answer"]
			     end)
			+ ["final review  " + (if .final_review then "done" else "pending" end)]
			+ ["pre-flight    " + (
				if (.preflight // {} | length) == 0 then "not recorded"
				else [(.preflight | to_entries[] | "\(.key | clean)=\(.value | clean)")] | join("; ")
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
			    # What a wave of several means depends on what pre-flight bought:
			    # worktrees per implementer run it at once, anything else runs it
			    # one at a time, and an answer never recorded says neither.
			    (
			      "\($ready | length) ready now"
			      + (if ($ready | length) > 1 then
			           (.preflight.workspace // "") as $ws
			           | if $ws == "" then ""
			             elif ($ws | test("per (concurrent )?implementer|each implementer|worktree each"; "i")) then " · a worktree each"
			             else " · serial, one at a time in the shared tree"
			             end
			         else "" end)
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

	final)
		[ $# -eq 0 ] || { err "final takes no arguments"; exit 4; }
		require_run
		take_lock
		require_readable

		# The per-task marks count dispatches the tier table owed. The final
		# review is owed by the plan as a whole, so it is a fact about the run
		# rather than a row, and `show` reports it pending until this lands.
		jq --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.final_review = $now' "$STATE" | write_state
		;;

	pause)
		REASON=""
		while [ $# -gt 0 ]; do
			case "$1" in
				--reason) need_value --reason $# "${2-}"; REASON="$2"; shift 2 ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done
		[ -n "$REASON" ] || { err "pause needs --reason <text>: a pause nobody can read the reason for is a stall"; exit 4; }
		require_run
		take_lock
		require_readable

		# A deliberate handback mid-run, which the stop guard otherwise refuses.
		# The reason is the whole point: it is what the partner reads in `show`
		# and what the next session reads to know why the run is standing still.
		jq --arg reason "$REASON" '.paused = $reason' "$STATE" | write_state
		;;

	resume)
		[ $# -eq 0 ] || { err "resume takes no arguments"; exit 4; }
		require_run
		take_lock
		require_readable
		jq 'del(.paused)' "$STATE" | write_state
		;;

	move)
		TO=""
		while [ $# -gt 0 ]; do
			case "$1" in
				--to) need_value --to $# "${2-}"; TO="$2"; shift 2 ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done
		[ -n "$TO" ] || { err "move needs --to <tree>"; exit 4; }
		[ -d "$TO" ] || { err "no such directory: $TO"; exit 4; }
		TO="$(cd "$TO" && pwd -P)"
		require_run

		# The destination is taken as given rather than anchored: the whole point
		# is to put the run in one particular tree, the controller's worktree,
		# which anchoring would resolve straight back to the main tree it is
		# leaving. It does have to be a work tree of the same set: a typo would
		# otherwise strand the run at a path no command issued from the tree
		# resolves, and the only way back is knowing where it went.
		src_common="$(git -C "$DIR" rev-parse --git-common-dir 2>/dev/null)"
		dst_common="$(git -C "$TO" rev-parse --git-common-dir 2>/dev/null)"
		dst_top="$(git -C "$TO" rev-parse --show-toplevel 2>/dev/null)"
		if [ -n "$src_common" ]; then
			src_common="$(cd "$DIR" && cd "$src_common" 2>/dev/null && pwd -P)"
			dst_common="$([ -n "$dst_common" ] && cd "$TO" && cd "$dst_common" 2>/dev/null && pwd -P)"
			if [ -z "$dst_common" ] || [ "$dst_common" != "$src_common" ] || [ "$dst_top" != "$TO" ]; then
				err "$TO is not a work tree of the same repository as $(cd "$DIR" && pwd -P); move only relocates a run between trees of one set"
				exit 4
			fi
		fi
		[ "$TO" != "$(cd "$DIR" && pwd -P)" ] || { err "the run is already in $TO"; exit 4; }

		# Both trees' locks: a racing init in the destination takes that tree's
		# lock, not this one's, and the mv would land on top of what it wrote.
		take_lock
		mk_dir "$TO/.sluice" "$TO"
		take_lock "$TO/.sluice/run.lock"
		DEST_STATE="$TO/.sluice/run.json"
		if [ -f "$DEST_STATE" ]; then
			there="$(jq -r '.topic // "?"' "$DEST_STATE" 2>/dev/null || echo "?")"
			err "a run is already live in $TO (topic: $there); close it there first"
			exit 3
		fi
		mv "$STATE" "$DEST_STATE" || { err "could not move $STATE to $DEST_STATE"; exit 1; }

		# After the state has arrived, never before: a note pointing at a run
		# that never got there is worse than no note, being indistinguishable
		# from one pointing at a run that did.
		NOTE_TREE="$(main_tree "$TO")"
		if [ -n "$NOTE_TREE" ] && [ -d "$NOTE_TREE" ]; then
			if [ "$NOTE_TREE" = "$TO" ]; then
				# The run is back where resolution already looks, so a note would
				# only point the main tree at itself.
				rm -f "$NOTE_TREE/.sluice/run.at"
			elif ! leave_note "$NOTE_TREE" "$TO"; then
				err "note: the run moved, but $NOTE_TREE/.sluice/run.at could not be written, so a session in $NOTE_TREE will read no run until it moves to $TO"
			fi
		fi

		echo "moved $(jq -r '.topic // "run"' "$DEST_STATE" 2>/dev/null || echo run) to $TO"
		# The session is the half of the move no command can make. Left where it
		# was, every bare git, build and test command it runs still lands in the
		# tree the run just left.
		echo "move this session there too, with the harness's worktree tool where it has one; every status.sh call from elsewhere needs --dir $TO"
		;;

	close)
		[ $# -eq 0 ] || { err "close takes no arguments"; exit 4; }
		require_run
		take_lock

		# Said once, as the run leaves: a close that archives six unreviewed
		# tasks and no final review in silence lets those facts leave with it.
		# Best effort on state nothing else will parse, which is why it is not
		# allowed to stop the archive.
		summary="$(jq -r '
			([.tasks[]? | select(.status == "done")] | length) as $done
			| ([.tasks[]? | select(.status == "done" and (.tier // 0) >= 1 and (.reviewed // false) == false)] | length) as $nodispatch
			| (((.preflight.review // "") | length) > 0) as $priced
			| [ "closed \(.topic // "run"): \($done)/\(.tasks | length) done",
			    (if   $nodispatch == 0 then empty
			     elif $priced then "\($nodispatch) at the chosen review level"
			     else "\($nodispatch) unreviewed"
			     end),
			    "final review \(if .final_review then "done" else "pending" end)"
			  ] | join(" · ")
		' "$STATE" 2>/dev/null || true)"

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
		mv "$STATE" "$dest" || { err "could not archive $STATE"; exit 1; }

		# A note naming this tree has outlived the run it forwarded to. Left
		# behind, it does not go quiet: the next run opened in this tree inherits
		# the forward and reads as the main tree's, though nobody there opened
		# it. Only a note naming this tree is ours to remove -- one naming
		# another tree belongs to a run this close knows nothing about.
		NOTE_TREE="$(main_tree "$DIR")"
		if [ -n "$NOTE_TREE" ] && [ -f "$NOTE_TREE/.sluice/run.at" ]; then
			AT=""
			IFS= read -r AT <"$NOTE_TREE/.sluice/run.at" 2>/dev/null || true
			[ "$AT" = "$(cd "$DIR" && pwd -P)" ] && rm -f "$NOTE_TREE/.sluice/run.at"
		fi
		# The summary needs parseable state and close is the one command that
		# does not, so an unreadable run still gets a line naming where it went.
		[ -n "$summary" ] || summary="closed $(basename "$dest"): state was unreadable, no summary"
		echo "$summary"
		;;

	*)
		err "unknown subcommand: $SUB"
		usage
		exit 4
		;;
esac
