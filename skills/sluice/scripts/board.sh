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
# Exit: 0 ok, 4 bad arguments, 5 jq missing.

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

# Every file goes to jq as a raw string and is parsed inside with fromjson?, so
# one half-written or hand-mangled file drops out alone rather than failing the
# whole read.
state() {
	local args="" n=0 f tree
	set --
	if [ -n "$ROOT" ]; then
		for f in "$ROOT"/runs/*; do
			[ -f "$f" ] || continue
			tree="$(head -n 1 "$f" 2>/dev/null)"
			[ -n "$tree" ] && [ -r "$tree/.sluice/run.json" ] || continue
			set -- "$@" --arg "t$n" "$tree" --rawfile "r$n" "$tree/.sluice/run.json"
			n=$((n + 1))
		done
		n=0
		for f in "$ROOT"/sessions/*.json; do
			[ -f "$f" ] || continue
			set -- "$@" --rawfile "s$n" "$f"
			n=$((n + 1))
		done
	fi
	jq -n "$@" '
		def clean: if type == "string" then gsub("[\u0000-\u001f\u007f]"; "") else . end;
		def epoch: try fromdateiso8601 catch null;
		def rank: if any(.tasks[]?; .status == "blocked") then 0
			elif any(.tasks[]?; .status == "active" or .status == "review") then 1
			else 2 end;
		$ARGS.named as $n
		| [$n | keys[] | select(test("^t[0-9]+$")) | ltrimstr("t")
			| {tree: $n["t\(.)"], run: ($n["r\(.)"] | fromjson? // null)}
			| select(.run | type == "object")]
		| reduce .[] as $r ([]; if any(.[]; .tree == $r.tree) then . else . + [$r] end)
		| sort_by([(.run | rank), -((.run.updated // .run.started // "" | epoch) // 0)])
		| . as $runs
		| [$runs[].run.session | strings] as $taken
		| [$n | to_entries[] | select(.key | test("^s[0-9]+$")) | .value | fromjson? // empty
			| select(type == "object")
			| with_entries(.value |= clean)
			| select((.updated | epoch) as $t | $t != null and now - $t <= 86400)
			| select(.channel == "fast" or .channel == "main" or .channel == "deep")
			| select(.channel != "deep" or (.session as $s | $taken | index([$s]) | not))]
		| sort_by(-(.updated | epoch))
		| . as $sessions
		| def tally($state): reduce ("fast", "main", "deep") as $c ({}; .[$c] = ([$sessions[] | select(.channel == $c and .state == $state)] | length));
		{runs: $runs, sessions: $sessions,
			counts: {runs: ($runs | length), working: tally("working"), handed_back: tally("handed back")}}
	'
}

render() {
	local s="$1" counts head line tree name shown channel base kind age
	counts="$(jq -r '.counts | [.runs + .working.deep + .handed_back.deep, .working.fast, .handed_back.fast, .working.main, .handed_back.main] | @tsv' <<<"$s")"
	head=""
	set -- $counts
	[ "$1" -gt 0 ] && head="$head · $1 deep"
	[ "$2" -gt 0 ] && head="$head · $2 fast working"
	[ "$3" -gt 0 ] && head="$head · $3 fast handed back"
	[ "$4" -gt 0 ] && head="$head · $4 main working"
	[ "$5" -gt 0 ] && head="$head · $5 main handed back"
	[ -n "$head" ] || head=" · nothing running"
	printf '%s%s  %s\n' "$(paint 1 sluice)" "$head" "$(paint 2 "$(date +%H:%M:%S)")"

	while IFS= read -r tree; do
		[ -n "$tree" ] || continue
		shown="$tree"
		if [ -n "${HOME:-}" ]; then
			case "$tree" in
				"$HOME") shown="~" ;;
				"$HOME"/*) shown="~${tree#"$HOME"}" ;;
			esac
		fi
		name="$(basename "$tree")"
		printf '\n%s  %s\n' "$(paint 1 "$name")" "$(paint 2 "$shown")"
		line="$(bash "$(dirname "$0")/status.sh" line --full --dir "$tree" 2>/dev/null)"
		if [ "$colour" = 0 ]; then
			line="$(printf '%s\n' "$line" | sed "s/$ESC\[[0-9;]*m//g")"
		fi
		[ -n "$line" ] && printf '%s\n' "$line"
	done <<EOF
$(jq -r '.runs[].tree' <<<"$s")
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
$(jq -r '
	def age($t): ((now - ($t | fromdateiso8601)) / 60 | floor | if . < 0 then 0 else . end)
		| if . < 60 then "\(.)m" else "\(. / 60 | floor)h\(. % 60)m" end;
	.sessions[]
	| [.channel,
		((.tree // "") | split("/") | map(select(. != "")) | last // "/"),
		.state,
		(if .state == "working" then "◷ \(age(.routed // .updated))" else "\(age(.updated)) ago" end)]
	| @tsv' <<<"$s")
EOF
}

if [ "$json" = 1 ]; then
	state
	exit 0
fi

if [ "$watch" = 0 ]; then
	render "$(state)"
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
	# Each line clears its own tail, so a row shorter than the one it overwrites
	# leaves nothing of the old one behind.
	frame="$(render "$(state)" | sed "s/\$/$ESC[K/")"
	printf '%s[H%s\n%s[J' "$ESC" "$frame" "$ESC"
	# Backgrounded so a signal ends the wait at once rather than after the sleep.
	sleep "$interval" &
	sleeper=$!
	wait "$sleeper"
	sleeper=""
done
