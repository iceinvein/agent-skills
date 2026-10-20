#!/usr/bin/env bash
# sluice board index: which trees hold a live run and which sessions are
# routed where, kept in one place so a board can list them without walking
# every worktree on the machine.
#
#   board-index.sh run-add <tree>
#   board-index.sh run-drop <tree>
#   board-index.sh session <id> <fast|main|deep> <tree>
#   board-index.sh handback <id>
#   board-index.sh prune
#
# The root is $SLUICE_BOARD_DIR, else $CLAUDE_CONFIG_DIR/sluice/board, else
# $HOME/.claude/sluice/board. With none of the three set there is nowhere safe
# to write, so every verb exits 0 having written nothing. Runs live at
# <root>/runs/<key>, one line naming the tree, where <key> is the tree with %
# encoded as %25 and / as %2F. Sessions live at <root>/sessions/<id>.json.
#
# Exit: 0 ok, 1 could not write, 4 bad arguments, 5 jq missing.

set -u

err() { echo "board-index.sh: $*" >&2; }

usage() {
	echo "usage: board-index.sh run-add <tree> | run-drop <tree> | session <id> <fast|main|deep> <tree> | handback <id> | prune" >&2
	exit 4
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

key() {
	local k="${1//%/%25}"
	echo "${k//\//%2F}"
}

# Writes $2 to $1 through a temp file so a reader never sees half an entry. The
# temp is dotted so the runs/* and sessions/*.json globs never match it. Never
# call this on the right of a pipe: its exit would end only the subshell.
put() {
	local tmp
	tmp="$(dirname "$1")/.$(basename "$1").tmp.$$"
	if ! { printf '%s\n' "$2" >"$tmp"; } 2>/dev/null || ! mv "$tmp" "$1" 2>/dev/null; then
		rm -f "$tmp"
		err "could not write $1"
		exit 1
	fi
}

need_jq() {
	command -v jq >/dev/null 2>&1 || { err "jq is required"; exit 5; }
}

verb="${1:-}"
[ $# -gt 0 ] && shift
case "$verb" in
	run-add|run-drop|handback) [ $# -eq 1 ] || usage ;;
	session) [ $# -eq 3 ] || usage ;;
	prune) [ $# -eq 0 ] || usage ;;
	*) usage ;;
esac

if [ -n "${SLUICE_BOARD_DIR:-}" ]; then
	ROOT="$SLUICE_BOARD_DIR"
elif [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
	ROOT="$CLAUDE_CONFIG_DIR/sluice/board"
elif [ -n "${HOME:-}" ]; then
	ROOT="$HOME/.claude/sluice/board"
else
	exit 0
fi

case "$verb" in
	run-add)
		[ -n "$1" ] || exit 0
		path="$ROOT/runs/$(key "$1")"
		mkdir -p "$ROOT/runs" 2>/dev/null || { err "could not write $path"; exit 1; }
		put "$path" "$1"
		;;
	run-drop)
		[ -n "$1" ] || exit 0
		path="$ROOT/runs/$(key "$1")"
		rm -f "$path" 2>/dev/null || { err "could not remove $path"; exit 1; }
		;;
	session)
		id="$1" channel="$2" tree="$3"
		case "$id" in
			*/*|.*) err "bad session id: $id"; exit 4 ;;
		esac
		case "$channel" in
			fast|main|deep) ;;
			*) err "unknown channel: $channel"; exit 4 ;;
		esac
		[ -n "$id" ] && [ -n "$tree" ] || exit 0
		need_jq
		path="$ROOT/sessions/$id.json"
		mkdir -p "$ROOT/sessions" 2>/dev/null || { err "could not write $path"; exit 1; }
		t="$(now)"
		entry="$(jq -n --arg s "$id" --arg c "$channel" --arg tr "$tree" --arg t "$t" \
			'{session: $s, channel: $c, tree: $tr, routed: $t, state: "working", updated: $t}')"
		put "$path" "$entry"
		;;
	handback)
		id="$1"
		case "$id" in
			''|*/*|.*) exit 0 ;;
		esac
		path="$ROOT/sessions/$id.json"
		[ -f "$path" ] || exit 0
		need_jq
		channel="$(jq -r '.channel' "$path" 2>/dev/null)" || exit 0
		[ "$channel" = deep ] && exit 0
		updated="$(jq --arg t "$(now)" '.state = "handed back" | .updated = $t' "$path")" || exit 0
		put "$path" "$updated"
		;;
	prune)
		need_jq
		for f in "$ROOT"/runs/*; do
			[ -f "$f" ] || continue
			tree="$(head -n 1 "$f")"
			[ -f "$tree/.sluice/run.json" ] || rm -f "$f"
		done
		# One jq for every session rather than one each, because prune runs on
		# every route and a jq per file made each route slower than the last day
		# of sessions. Contents go on stdin as NUL-separated name and contents
		# records, as board.sh feeds them, so no count of files meets the argv
		# limit. Anything unreadable or unparseable comes back to be removed.
		for f in "$ROOT"/sessions/*.json; do
			[ -f "$f" ] || continue
			entry=""
			{ IFS= read -r -d '' entry; } 2>/dev/null <"$f"
			printf '%s\0%s\0' "$f" "$entry"
		done | jq -R -s -j '
			(split("\u0000") | .[:-1]) as $p
			| range(0; $p | length; 2)
			| select(($p[. + 1] | try (fromjson | (now - (.updated | fromdateiso8601)) <= 86400) catch false) != true)
			| $p[.] + "\u0000"
		' 2>/dev/null | while IFS= read -r -d '' f; do
			rm -f "$f"
		done
		;;
esac
exit 0
