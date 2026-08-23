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
#                       [--commit <sha>] [--tier 0-3] [--model <m>] [--flips]
#                       [--reviewed]
#   status.sh preflight [--review <t>] [--model <t>] [--workspace <t>]
#   status.sh show [--json]
#   status.sh line [--full]
#   status.sh close
#
# --dir <path> selects the tree to read (default: $PWD). State lives at
# <dir>/.sluice/run.json and closed runs at <dir>/.sluice/archive/.
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

STATE="$DIR/.sluice/run.json"
ARCHIVE="$DIR/.sluice/archive"

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

	# The wide render, for a line of its own. Cells are shape-distinct before they
	# are coloured, so it stays readable where colour is stripped or absent.
	#
	# The flip is marked only while it is still ahead: it is the milestone the run
	# is heading for, and once it lands it is another done task. Elapsed is passed
	# in rather than computed in jq, which has no clock.
	jq -r \
		--argjson now "$(date -u +%s)" \
		--arg esc "$(printf '\033')" '
		def cell:
			if   .status == "done"    then "\($esc)[32m▰\($esc)[0m"
			elif .status == "active"  then "\($esc)[96m◈\($esc)[0m"
			elif .status == "review"  then "\($esc)[33m▨\($esc)[0m"
			elif .status == "blocked" then "\($esc)[91m▮\($esc)[0m"
			elif .flips               then "\($esc)[95m⚑\($esc)[0m"
			else "\($esc)[2m▱\($esc)[0m"
			end;
		def dim($t): "\($esc)[2m\($t)\($esc)[0m";
		# fromdateiso8601 raises rather than returning null, and the caller
		# suppresses stderr, so one unparseable field would take the whole render
		# with it and leave nothing to diagnose. A bad clock costs the clock.
		def elapsed:
			(.started // "" | try fromdateiso8601 catch 0) as $t
			| if $t == 0 then empty
			  else (($now - $t) / 60 | floor) as $m
			       | if $m < 1 then "◷ <1m"
			         elif $m < 60 then "◷ \($m)m"
			         else "◷ \($m / 60 | floor)h\($m % 60)m"
			         end
			  end;
		([.tasks[]? | select(.status == "done")] | length) as $done
		# Debt is what the tier table promised and nobody delivered: done, owed a
		# dispatch, and never marked. Tier 0 buys a stat read, so it is not owed one.
		| ([.tasks[]? | select(.status == "done" and (.tier // 0) >= 1 and (.reviewed // false) == false)] | length) as $debt
		| ([.tasks[]? | select(.status == "blocked")] | first) as $blocked
		| ([.tasks[]? | select(.status == "active")] | first) as $active
		| [ "\($esc)[1;96m⧗\($esc)[0m",
		    "\($esc)[1;96m\(.channel // "?")\($esc)[0m",
		    dim(.topic // ""),
		    " " + ([.tasks[]? | cell] | join("")),
		    " \($esc)[1m\($done)/\(.tasks | length)\($esc)[0m",
		    (if   $blocked then " \($esc)[1;91m!T\($blocked.id) \($blocked.name // "")\($esc)[0m"
		     elif $active  then " \($esc)[96m▸T\($active.id)\($esc)[0m \($active.name // "")"
		     else empty end),
		    (if $debt > 0 then " \($esc)[33m⟲\($debt) unreviewed\($esc)[0m" else empty end),
		    (elapsed | if . == null then empty else " " + dim(.) end)
		  ] | join(" ")
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

		if [ -f "$STATE" ] && [ "$FORCE" -eq 0 ]; then
			live="$(jq -r '.topic // "?"' "$STATE" 2>/dev/null || echo "?")"
			err "a run is already live (topic: $live); pass --force to replace it"
			exit 3
		fi

		mkdir -p "$DIR/.sluice"
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

		NAME="" STATUS="" BASE="" COMMIT="" TIER="" MODEL="" FLIPS=false REVIEWED=false
		while [ $# -gt 0 ]; do
			case "$1" in
				--name) need_value --name $# "${2-}"; NAME="$2"; shift 2 ;;
				--status) need_value --status $# "${2-}"; STATUS="$2"; shift 2 ;;
				--base) need_value --base $# "${2-}"; BASE="$2"; shift 2 ;;
				--commit) need_value --commit $# "${2-}"; COMMIT="$2"; shift 2 ;;
				--tier) need_value --tier $# "${2-}"; TIER="$2"; shift 2 ;;
				--model) need_value --model $# "${2-}"; MODEL="$2"; shift 2 ;;
				--flips) FLIPS=true; shift ;;
				--reviewed) REVIEWED=true; shift ;;
				*) err "unknown flag: $1"; exit 4 ;;
			esac
		done

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
			--argjson flips "$FLIPS" --argjson reviewed "$REVIEWED" '
			{}
			+ (if $name   == "" then {} else {name: $name} end)
			+ (if $status == "" then {} else {status: $status} end)
			+ (if $base   == "" then {} else {base: $base} end)
			+ (if $commit == "" then {} else {commit: $commit} end)
			+ (if $tier   == "" then {} else {tier: ($tier | tonumber)} end)
			+ (if $model  == "" then {} else {model: $model} end)
			+ (if $flips then {flips: true} else {} end)
			+ (if $reviewed then {reviewed: true} else {} end)
		')"

		jq --argjson id "$ID" --argjson patch "$patch" '
			.tasks = (
				if any(.tasks[]?; .id == $id)
				then [.tasks[] | if .id == $id then . + $patch else . end]
				else .tasks + [{id: $id, status: "todo"} + $patch]
				end
			)
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

	close)
		[ $# -eq 0 ] || { err "close takes no arguments"; exit 4; }
		require_run

		# Deliberately not `require_readable`. The parse error every other
		# subcommand raises names close as the way out, so close is the one
		# command that has to accept state nothing else will touch: it moves the
		# file aside intact rather than leaving it wedged in the tree.
		started="$(jq -r '.started // empty' "$STATE" 2>/dev/null)"
		topic="$(jq -r '.topic // empty' "$STATE" 2>/dev/null)"
		stamp="$(printf '%s' "$started" | tr -cd '0-9TZ')"
		slug="$(printf '%s' "${topic:-run}" | tr -cs 'A-Za-z0-9._-' '-')"
		[ -n "$stamp" ] || stamp="unknown"
		mkdir -p "$ARCHIVE"

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
