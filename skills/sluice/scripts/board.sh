#!/usr/bin/env bash
# sluice board: every live run and every routed session on the machine, drawn
# from the board index so nobody has to walk the worktrees to find them.
#
#   board.sh [--json] [--watch [<seconds>]]
#
# --json prints the combined state instead of drawing it. --watch redraws every
# <seconds> (default 2) until interrupted. The index is read, never written.
# The root is $SLUICE_BOARD_DIR, else $CLAUDE_CONFIG_DIR/sluice/board, else
# $HOME/.claude/sluice/board; with none of the three set the index is empty.
#
# Exit: 0 ok, 4 bad arguments, 5 jq missing, 6 the board could not be read.

set -u

err() { echo "board.sh: $*" >&2; }

usage() {
	echo "usage: board.sh [--json] [--watch [<seconds>]]" >&2
	exit 4
}

json=0 watch=0 interval=2
while [ $# -gt 0 ]; do
	case "$1" in
		--json) json=1; shift ;;
		--watch)
			watch=1
			shift
			case "${1:-}" in
				''|--*) ;;
				*) interval="$1"; shift ;;
			esac
			;;
		*) usage ;;
	esac
done
case "$interval" in
	''|0*|*[!0-9]*) err "--watch needs a positive whole number of seconds, not $interval"; exit 4 ;;
esac
if [ "$watch" = 1 ] && [ "$json" = 1 ]; then
	err "--watch and --json do not combine"
	exit 4
fi

command -v jq >/dev/null 2>&1 || { err "jq is required"; exit 5; }

if [ -n "${SLUICE_BOARD_DIR:-}" ]; then
	ROOT="$SLUICE_BOARD_DIR"
elif [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
	ROOT="$CLAUDE_CONFIG_DIR/sluice/board"
elif [ -n "${HOME:-}" ]; then
	ROOT="$HOME/.claude/sluice/board"
else
	ROOT=""
fi

ESC="$(printf '\033')"
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
	colour=1
else
	colour=0
fi

paint() { # <sgr> <text>
	if [ "$colour" = 1 ]; then
		printf '%s[%sm%s%s[0m' "$ESC" "$1" "$2" "$ESC"
	else
		printf '%s' "$2"
	fi
}

# The board polls for hours while runs close and sessions are pruned under it,
# so each file is read into a variable first and skipped when that read fails,
# and jq gets contents rather than paths that may be gone by the time it opens
# them. TREES keeps each run's path by index, so a path holding a newline or a
# tab reaches status.sh whole rather than through a line-split read.
gather() {
	local n=0 f tree run entry
	TREES=()
	JQ_ARGS=(--arg home "${HOME:-}")
	[ -n "$ROOT" ] || return 0
	for f in "$ROOT"/runs/*; do
		[ -f "$f" ] || continue
		# The x keeps $() from eating every trailing newline, so only the one
		# board-index.sh wrote is removed.
		tree="$(cat "$f" 2>/dev/null && printf x)" || continue
		tree="${tree%x}"
		tree="${tree%$'\n'}"
		[ -n "$tree" ] || continue
		run="$(cat "$tree/.sluice/run.json" 2>/dev/null)" || continue
		TREES[$n]="$tree"
		JQ_ARGS+=(--arg "t$n" "$tree" --arg "r$n" "$run")
		n=$((n + 1))
	done
	n=0
	for f in "$ROOT"/sessions/*.json; do
		[ -f "$f" ] || continue
		entry="$(cat "$f" 2>/dev/null)" || continue
		JQ_ARGS+=(--arg "s$n" "$entry")
		n=$((n + 1))
	done
}

# Builds {board, order, lines}: board is what --json prints, order the runs to
# draw as "<index into TREES>\t<name>\t<path as shown>", lines the session rows.
# Each entry is evaluated on its own inside try, so one with an odd shape costs
# only itself, and the counts are taken from the same filtered list the rows
# are drawn from.
COMBINE='
	def clean: if type == "string" then gsub("[\u0000-\u001f\u007f]"; "") else . end;
	def base: split("/") | map(select(. != "")) | last // "/";
	def age($t): ((now - ($t | fromdateiso8601)) / 60 | floor | if . < 0 then 0 else . end)
		| if . < 60 then "\(.)m" else "\(. / 60 | floor)h\(. % 60)m" end;
	def need(cond; why): if cond then . else error(why) end;
	$ARGS.named as $n
	| [$n | keys[] | select(test("^t[0-9]+$")) | ltrimstr("t") | tonumber
		| . as $i
		| try (
			$n["r\($i)"] | fromjson
			| need(type == "object"; "not a run")
			| need((.tasks | type) == "array"; "no tasks")
			| need(all(.tasks[]; type == "object" and (.status | type) == "string"); "odd tasks")
			| {i: $i, tree: $n["t\($i)"], run: .,
				rank: (if any(.tasks[]; .status == "blocked") then 0
					elif any(.tasks[]; .status == "active" or .status == "review") then 1
					else 2 end),
				t: (.updated // .started | fromdateiso8601)}
		) catch empty]
	| reduce .[] as $r ([]; if any(.[]; .tree == $r.tree) then . else . + [$r] end)
	| sort_by([.rank, -.t])
	| . as $runs
	| [$runs[].run.session | strings] as $taken
	| [$n | keys[] | select(test("^s[0-9]+$")) | $n[.]
		| try (
			fromjson
			| need(type == "object"; "not an entry")
			| with_entries(.value |= clean)
			| need((.tree | type) == "string" and .tree != ""; "no tree")
			| need(.channel == "fast" or .channel == "main" or .channel == "deep"; "bad channel")
			| need(.state == "working" or .state == "handed back"; "bad state")
			| (.updated | fromdateiso8601) as $t
			| select(now - $t <= 86400)
			| select(.channel != "deep" or (.session as $s | $taken | index([$s]) | not))
			| {entry: ., t: $t, line: ([.channel, (.tree | base), .state,
				(if .state == "working" then "◷ \(age(.routed))" else "\(age(.updated)) ago" end)] | @tsv)}
		) catch empty]
	| sort_by(-.t)
	| . as $sessions
	| def tally($state): reduce ("fast", "main", "deep") as $c ({}; .[$c] = ([$sessions[] | select(.entry.channel == $c and .entry.state == $state)] | length));
	{board: {runs: [$runs[] | {tree, run}], sessions: [$sessions[].entry],
			counts: {runs: ($runs | length), working: tally("working"), handed_back: tally("handed back")}},
		order: [$runs[] | (.tree | clean) as $c | [.i, ($c | base),
			(if $home != "" and $c == $home then "~"
				elif $home != "" and ($c | startswith($home + "/")) then "~" + ($c | ltrimstr($home))
				else $c end)] | @tsv],
		lines: [$sessions[].line]}
'

# Prints the frame, or returns 1 having printed nothing when the state could
# not be built at all.
render() {
	local s counts head line i name shown channel base kind age
	gather
	s="$(jq -n "${JQ_ARGS[@]}" "$COMBINE" 2>/dev/null)" && [ -n "$s" ] || return 1
	counts="$(jq -r '.board.counts | [.runs + .working.deep + .handed_back.deep, .working.fast, .handed_back.fast, .working.main, .handed_back.main] | @tsv' <<<"$s")"
	head=""
	set -- $counts
	[ "$1" -gt 0 ] && head="$head · $1 deep"
	[ "$2" -gt 0 ] && head="$head · $2 fast working"
	[ "$3" -gt 0 ] && head="$head · $3 fast handed back"
	[ "$4" -gt 0 ] && head="$head · $4 main working"
	[ "$5" -gt 0 ] && head="$head · $5 main handed back"
	[ -n "$head" ] || head=" · nothing running"
	printf '%s%s  %s\n' "$(paint 1 sluice)" "$head" "$(paint 2 "$(date +%H:%M:%S)")"

	while IFS="$(printf '\t')" read -r i name shown; do
		[ -n "$i" ] || continue
		printf '\n%s  %s\n' "$(paint 1 "$name")" "$(paint 2 "$shown")"
		line="$(bash "$(dirname "$0")/status.sh" line --full --dir "${TREES[$i]}" 2>/dev/null)"
		if [ "$colour" = 0 ]; then
			line="$(printf '%s\n' "$line" | sed "s/$ESC\[[0-9;]*m//g")"
		fi
		[ -n "$line" ] && printf '%s\n' "$line"
	done <<EOF
$(jq -r '.order[]' <<<"$s")
EOF

	local first=1
	while IFS="$(printf '\t')" read -r channel base kind age; do
		[ -n "$channel" ] || continue
		if [ "$first" = 1 ]; then
			echo
			first=0
		fi
		printf '%s  %s  %s  %s\n' "$(paint 1 "$channel")" "$base" "$kind" "$(paint 2 "$age")"
	done <<EOF
$(jq -r '.lines[]' <<<"$s")
EOF
	return 0
}

UNREADABLE="could not read the board"

if [ "$json" = 1 ]; then
	gather
	jq -n "${JQ_ARGS[@]}" "$COMBINE | .board" 2>/dev/null || { err "$UNREADABLE"; exit 6; }
	exit 0
fi

if [ "$watch" = 0 ]; then
	render || { err "$UNREADABLE"; exit 6; }
	exit 0
fi

sleeper=""
restore() {
	[ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null
	printf '%s[?25h' "$ESC"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s[?25l%s[2J' "$ESC" "$ESC"
while :; do
	frame="$(render)" || frame="board.sh: $UNREADABLE"
	# Each line clears its own tail, so a row shorter than the one it overwrites
	# leaves nothing of the old one behind. No newline after the last row: one
	# there scrolls a frame as tall as the terminal on every redraw.
	frame="$(printf '%s\n' "$frame" | sed "s/\$/$ESC[K/")"
	printf '%s[H%s%s[J' "$ESC" "$frame" "$ESC"
	# Backgrounded so a signal ends the wait at once rather than after the sleep.
	sleep "$interval" &
	sleeper=$!
	wait "$sleeper"
	sleeper=""
done
