# Design: sluice board

## Context

A run is visible only from inside its own worktree set: the statusline,
`status.sh show` and the SessionStart hook all resolve the run from the tree
they are pointed at. Nothing answers "what sluice work is going on across this
machine right now", and fast or main work leaves no state anyone can read at
all (`route` writes none by contract, `.sluice/verified` says only that a check
passed).

You asked for a terminal board, refreshed live-ish, that counts the work in
flight and shows its progress, covering deep runs and fast/main sessions alike,
kept inside the skill.

## Decisions

### D1. A machine-level index of pointers, never copies

The index lives at
`${SLUICE_BOARD_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sluice/board}`,
beside the `stamps/` and `nudged/` directories the hooks already keep under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sluice/`. `SLUICE_BOARD_DIR` exists so
the test suite can point every script at a temp directory through one bun
preload, rather than each test file learning a new variable, and so `bun test`
never writes to the real board. With no override and no `HOME`, nothing is
written. It holds pointers, not state, so `run.json` stays the single
authority on a run and the board can never show a stale copy of one.

- `runs/<key>`: one line, the absolute physical path of the tree a deep run
  lives in. `<key>` is that path with `%` written `%25` and `/` written `%2F`,
  which is unique and reversible and needs no hashing tool. Written by `init`
  and `move` (the old key removed, the new one written), removed by `close`.
- Every locked write (`task`, `preflight`, `final`, `pause`, `resume`) also
  rewrites its pointer when missing, so a run opened before this release joins
  the board at its next flip without anyone re-registering it.
- A pointer whose tree no longer holds a run is skipped by the board and
  removed by the next `init` or `route`. The board itself writes nothing,
  keeping reads lock-free as they are today.

### D2. `route` records a session, which changes its contract

`route <channel>` writes `sessions/<session-id>.json`:
`{session, channel, tree, routed, state: "working", updated}`, where `tree` is
the git top level of the working directory (the directory itself outside git).
A later `route` in the same session overwrites it, so an escalation from fast to
main shows as main.

- The session id comes from `--session` or `$CLAUDE_CODE_SESSION_ID`. With
  neither, `route` writes nothing and says nothing: no id is invented.
- `route` still prints `sluice: <channel> channel` and still never fails the
  caller: an index that cannot be written is reported on stderr and the exit
  stays 0, because the announcement is the part that matters.
- `references/status.md` and `references/meter.md` lose "route reads and writes
  no state" and say what it writes and why.

### D3. The Stop hook marks a fast or main handback

When `stop-guard.sh` lets a stop through, and only then, it sets the session's
entry to `state: "handed back"` with `updated` stamped. A refused stop is not a
handback and changes nothing. A deep session's entry is left as it is: its
progress is the run's, which the board reads directly.

A session entry past a day since `updated` is pruned by the next `route`, the
same one-day line `show` and the statusline already use for an idle run. The
next turn in a session re-routes, which sets it back to `working`.

### D4. `scripts/board.sh`

```
bash <skill-dir>/scripts/board.sh            # draw once
bash <skill-dir>/scripts/board.sh --watch    # redraw every 2s until Ctrl-C
bash <skill-dir>/scripts/board.sh --watch 5  # every 5s
bash <skill-dir>/scripts/board.sh --json     # the combined state, for another reader
```

Rendered:

```
sluice · 2 deep · 1 fast working · 1 main handed back            14:02:11

agent-skills  ~/projects/agent-skills/.claude/worktrees/board
⧗ deep · sluice-board   ◷ 38m
  ▰▰▰ ▰▰▨ ◈◈◈ ▱▱▱ ┃ ▱▱▱
  2/5 done · T3 board renderer

shop-api  ~/work/shop-api
⧗ deep · checkout-retry   ◷ 2h · paused: waiting on the API key
  ▰▰▰ ▮▮▮ ▱▱▱
  1/3 done · !T2 idempotency key

fast  web-client         working       ◷ 4m
main  agent-skills       handed back   12m ago
```

- Each deep block is `status.sh line --full --dir <tree>`, unchanged, so the
  glyphs, colours and idle wording match the statusline and nothing is drawn
  twice from two implementations. Blocked runs sort first, then active, then
  idle, mirroring the statusline's "the one worth interrupting for" rule.
- A deep session whose run is on the board is not listed again as a session.
- Header counts are derived from what is drawn, never stored.
- `--watch` redraws in place (cursor home and clear-to-end, not a full clear,
  so it does not flicker) and restores the cursor on exit. The interval is a
  flag with a 2s default; reads are cheap because state is installed by rename.
- No colour when stdout is not a terminal or `NO_COLOR` is set, matching the
  statusline's handling. Free text is passed through the same control-byte
  scrub the renders already use.
- Needs `jq`, like the rest of the scripts. Missing `jq` is an error with exit
  5, as in `status.sh`, not a blank board, because unlike the statusline this
  has somewhere to put one.

### D5. Out of scope

- A web page or Claude Code side panel. `--json` is the seam either would read.
- Remote or multi-machine aggregation.
- Progress for fast/main beyond working / handed back: they have no task list.

## Trade-offs

- `route` gains a write. A session that calls it many times pays one small file
  write each time; that is the cost of fast/main being visible at all.
- A session that crashes after `route` stays `working` for up to a day. Shown
  with its age so it reads as stale, and pruned after.
- The index is per user, per machine. Two machines show two boards.

## Testing

Real scripts against throwaway git repos with `SLUICE_BOARD_DIR` pointed at a
temp directory, in the style of `tests/sluice-status.test.ts`:

- `init` registers a run and `board` lists it; `close` removes it from the board.
- `move` leaves the board showing the run once, at its new tree.
- a run opened with no pointer appears after its next `task` flip.
- a pointer to a deleted tree is not drawn.
- `route fast` with a session id makes the board show a working fast session;
  with no session id, nothing is written and the exit is 0.
- `route main` after `route fast` in one session shows main only.
- a let-through Stop marks the session handed back; a refused Stop does not.
- a session entry older than a day is pruned by the next `route`.
- `--json` carries the deep runs and sessions with the counts the header shows
  (expected values written by hand).
- a task name with an escape sequence draws without it.

## Release

`skill.json` description and version bump (minor: new script, changed `route`
contract), released as `chore(sluice): 0.26.0` then the repo release, matching
the existing history.
