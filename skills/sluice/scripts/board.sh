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
# them. The read is the builtin, so a frame spawns no process per file. TREES
# keeps each run's path by index, so a path holding a newline or a tab reaches
# status.sh whole rather than through a line-split read. KEYS and VALUES are
# the records emit hands jq. Returns 1 when the root, runs/ or sessions/
# exists but cannot be listed: one not yet created is empty, since nothing has
# been written there, but one that cannot be read would draw as nothing running
# when it may hold every run on the machine.
gather() {
	local n=0 f tree run entry d
	TREES=()
	KEYS=()
	VALUES=()
	[ -n "$ROOT" ] || return 0
	for d in "$ROOT" "$ROOT/runs" "$ROOT/sessions"; do
		if [ -e "$d" ] || [ -L "$d" ]; then
			[ -d "$d" ] && [ -r "$d" ] && [ -x "$d" ] || return 1
		fi
	done
	for f in "$ROOT"/runs/*; do
		[ -f "$f" ] || continue
		# read -d '' stops at EOF with a non-zero status, so a short read is told
		# from a failed open by whether anything arrived.
		tree=""
		{ IFS= read -r -d '' tree || [ -n "$tree" ]; } 2>/dev/null <"$f" || continue
		tree="${tree%$'\n'}"
		[ -n "$tree" ] || continue
		run=""
		{ IFS= read -r -d '' run || [ -n "$run" ]; } 2>/dev/null <"$tree/.sluice/run.json" || continue
		TREES[$n]="$tree"
		KEYS+=("t$n" "r$n")
		VALUES+=("$tree" "$run")
		n=$((n + 1))
	done
	n=0
	for f in "$ROOT"/sessions/*.json; do
		[ -f "$f" ] || continue
		entry=""
		{ IFS= read -r -d '' entry || [ -n "$entry" ]; } 2>/dev/null <"$f" || continue
		KEYS+=("s$n")
		VALUES+=("$entry")
		n=$((n + 1))
	done
}

# Contents go to jq on stdin as NUL-separated key and value records rather than
# as arguments, so no file's size runs into the argv limit. JSON text never
# holds a NUL, and a tree path cannot.
emit() {
	local i=0
	while [ "$i" -lt "${#KEYS[@]}" ]; do
		printf '%s\0%s\0' "${KEYS[$i]}" "${VALUES[$i]}"
		i=$((i + 1))
	done
}

combine() { # [jq filter appended to COMBINE]
	emit | jq -R -s --arg home "${HOME:-}" "$COMBINE${1:-}" 2>/dev/null
}

# Builds {board, order, lines}: board is what --json prints, order the runs to
# draw as "<index into TREES>\t<name>\t<path as shown>", lines the session rows.
# Those fields are joined rather than put through @tsv, which escapes a
# backslash that read -r then keeps, so a name would draw doubled; clean has
# already dropped every tab and newline a field could hold.
# Each entry is evaluated on its own inside try, so one with an odd shape costs
# only itself, and the counts are taken from the same filtered list the rows
# are drawn from.
COMBINE='
	def clean: if type == "string" then gsub("[\u0000-\u001f\u007f]"; "") else . end;
	def base: split("/") | map(select(. != "")) | last // "/";
	def age($t): ((now - ($t | fromdateiso8601)) / 60 | floor | if . < 0 then 0 else . end)
		| if . < 60 then "\(.)m" else "\(. / 60 | floor)h\(. % 60)m" end;
	def need(cond; why): if cond then . else error(why) end;
	(split("\u0000") | .[:-1]) as $parts
	| ([range(0; $parts | length; 2) | {key: $parts[.], value: $parts[. + 1]}] | from_entries) as $n
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
				(if .state == "working" then "◷ \(age(.routed))" else "\(age(.updated)) ago" end)] | join("\t"))}
		) catch empty]
	| sort_by(-.t)
	| . as $sessions
	| def tally($state): reduce ("fast", "main", "deep") as $c ({}; .[$c] = ([$sessions[] | select(.entry.channel == $c and .entry.state == $state)] | length));
	{board: {runs: [$runs[] | {tree, run}], sessions: [$sessions[].entry],
			counts: {runs: ($runs | length), working: tally("working"), handed_back: tally("handed back")}},
		order: [$runs[] | (.tree | clean) as $c | [.i, ($c | base),
			(if $home != "" and $c == $home then "~"
				elif $home != "" and ($c | startswith($home + "/")) then "~" + ($c | ltrimstr($home))
				else $c end)] | map(tostring) | join("\t")],
		lines: [$sessions[].line]}
'

# Prints the frame, or returns 1 having printed nothing when the state could
# not be built at all. Colour is painted here and stripped by the caller, once
# per frame, when it is off.
render() {
	local s tag a b c d e head first=1
	gather || return 1
	s="$(combine)" && [ -n "$s" ] || return 1
	while IFS="$TAB" read -r tag a b c d e f; do
		case "$tag" in
			counts)
				head=""
				[ "$a" -gt 0 ] && head="$head · $a deep"
				[ "$b" -gt 0 ] && head="$head · $b deep handed back"
				[ "$c" -gt 0 ] && head="$head · $c fast working"
				[ "$d" -gt 0 ] && head="$head · $d fast handed back"
				[ "$e" -gt 0 ] && head="$head · $e main working"
				[ "$f" -gt 0 ] && head="$head · $f main handed back"
				[ -n "$head" ] || head=" · nothing running"
				paint 1 sluice
				printf '%s  ' "$head"
				paint 2 "$CLOCK"
				echo
				;;
			run)
				echo
				paint 1 "$b"
				printf '  '
				paint 2 "$c"
				echo
				bash "$SCRIPTS/status.sh" line --full --dir "${TREES[$a]}" 2>/dev/null
				;;
			session)
				if [ "$first" = 1 ]; then
					echo
					first=0
				fi
				paint 1 "$a"
				printf '  %s  %s  ' "$b" "$c"
				paint 2 "$d"
				echo
				;;
		esac
	done <<EOF
$(jq -r '
	(.board.counts | ["counts", .runs + .working.deep, .handed_back.deep, .working.fast, .handed_back.fast, .working.main, .handed_back.main] | @tsv),
	("run\t" + .order[]),
	("session\t" + .lines[])' <<<"$s")
EOF
	return 0
}

UNREADABLE="could not read the board"
TAB="$(printf '\t')"
SCRIPTS="$(dirname "$0")"
STRIP="s/$ESC\[[0-9;]*m//g"
[ "$colour" = 1 ] && STRIP=""

if [ "$json" = 1 ]; then
	gather || { err "$UNREADABLE"; exit 6; }
	combine ' | .board' || { err "$UNREADABLE"; exit 6; }
	exit 0
fi

if [ "$watch" = 0 ]; then
	CLOCK="$(date +%H:%M:%S)"
	frame="$(render)" || { err "$UNREADABLE"; exit 6; }
	printf '%s\n' "$frame" | sed "$STRIP"
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
	CLOCK="$(date +%H:%M:%S)"
	frame="$(render)" || frame="board.sh: $UNREADABLE"
	# Each line clears its own tail, so a row shorter than the one it overwrites
	# leaves nothing of the old one behind. No newline after the last row: one
	# there scrolls a frame as tall as the terminal on every redraw.
	frame="$(printf '%s\n' "$frame" | sed -e "$STRIP" -e "s/\$/$ESC[K/")"
	printf '%s[H%s%s[J' "$ESC" "$frame" "$ESC"
	# Backgrounded so a signal ends the wait at once rather than after the sleep.
	sleep "$interval" &
	sleeper=$!
	wait "$sleeper"
	sleeper=""
done
