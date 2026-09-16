#!/usr/bin/env bash
# A complete statusline command, for a machine that had none.
#
# `statusline.sh` takes a directory; the harness delivers one as JSON on stdin.
# This bridges the two, and it is what settings.json can be pointed at directly:
#
#   "statusLine": { "type": "command", "command": "bash '<this file>'" }
#
# It draws the live run and nothing else. Anyone who wants a prompt as well
# already has a statusline of their own, and the install refuses to overwrite
# one: this file exists for the empty slot, not to compete for a full one. So
# with no run live it prints nothing at all rather than an empty row.
#
# Always exits 0 in silence on anything it cannot render, for the same reason
# statusline.sh does: a status bar draws on every keystroke and has nowhere to
# put an error.

set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
RENDER="$here/statusline.sh"

[ -f "$RENDER" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# Bounded, and skipped on a terminal. The harness closes stdin after the JSON,
# so a read to EOF returns, but nothing here enforces that: read from a pipe
# nobody closes and an unbounded read hangs, which on a status bar is a bar that
# never draws and on a hand-run check is a frozen terminal with no explanation.
# `read` is a builtin, so the bound costs no fork against the gate's budget.
[ -t 0 ] && exit 0
input=""
IFS= read -r -d "" -t 2 input || true
[ -n "$input" ] || exit 0

# `cwd` is the older spelling of the same field and both are still sent, so it
# is a fallback rather than a bug. Neither present is not an error worth a row:
# it means this is not the JSON we were written against.
dir="$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // empty' 2>/dev/null || true)"
[ -n "$dir" ] || exit 0

bash "$RENDER" --dir "$dir" 2>/dev/null || exit 0
