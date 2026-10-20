# Plan: sluice-board

## Goal

A terminal board, `scripts/board.sh`, that counts the sluice work live on this
machine and shows its progress: every open deep run with its bar, and every
fast or main session as working or handed back. Design:
`docs/specs/2026-10-20-sluice-board.md`.

## Architecture

`scripts/board-index.sh` is the only writer of a machine-level index at
`${SLUICE_BOARD_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sluice/board}`:
`runs/<key>` pointer files naming the tree a deep run lives in, and
`sessions/<id>.json` entries recorded by `route`. `status.sh` calls it from
`write_state`, `move`, `close`, `init` and `route`; `stop-guard.sh` calls it
when it lets a stop through. `board.sh` only reads: it follows each pointer to
the tree's own `run.json`, draws each run with `status.sh line --full --dir
<tree>`, and lists sessions beneath. A bun preload points `SLUICE_BOARD_DIR` at
a temp directory for the whole suite, so no test writes the real board.

## Ground Rules

- Commit message convention: `<type>(<scope>): <subject>`, scope `sluice`,
  subject lower case, no trailing full stop. No `Co-Authored-By` trailer, no
  tool footer, no session link.
- Test runner: `bun test` from the repo root, with `CLAUDE_CODE_SESSION_ID`
  unset in the environment of every script a test spawns. Before Task 1, on
  master at a35427e: 2353 pass, 1 fail, 1 error across 130 files.
- Scripts stay bash 3.2 compatible, use tabs for indentation, and depend on
  nothing beyond `jq` and `git`. Exit codes follow `status.sh`: 0 ok, 1 could
  not write, 4 bad arguments, 5 jq missing.
- Prose and comments follow the files they land in: no em dashes, comments say
  why, never what.
- Tests assert on what a caller observes (stdout, exit code, files left in the
  board directory). Expected values are written by hand.
- A session id or tree path is never invented: a call missing one writes
  nothing.
- `skills/sluice/evals/*/plugins/` are generated copies; no task edits them.

### Task 1: board index writer

**Contract:** Needs: none | Offers: `board-index.sh run-add <tree>` writes `$ROOT/runs/<key>` holding `<tree>` and a newline, where `<key>` is `<tree>` with `%` replaced by `%25` then `/` by `%2F`, exit 0, exit 1 with `board-index.sh: could not write <path>` on stderr; `board-index.sh run-drop <tree>` removes that file, exit 0 when absent; `board-index.sh session <id> <fast|main|deep> <tree>` writes `$ROOT/sessions/<id>.json` as `{"session":<id>,"channel":<c>,"tree":<tree>,"routed":<now>,"state":"working","updated":<now>}` (times `YYYY-MM-DDTHH:MM:SSZ` UTC) through a temp file and rename, exit 4 for an id containing `/` or starting with `.` or an unknown channel, exit 5 without jq; `board-index.sh handback <id>` sets `state` to `"handed back"` and stamps `updated` when the entry exists and its channel is not `deep`, otherwise exit 0 with nothing written; `board-index.sh prune` removes `runs/*` whose named tree has no `.sluice/run.json` and `sessions/*.json` that do not parse or whose `updated` is more than 86400 seconds old; `$ROOT` is `${SLUICE_BOARD_DIR:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sluice/board}`, and with all three unset or empty every verb exits 0 having written nothing
**Touches:** skills/sluice/scripts/board-index.sh (new) | bunfig.toml (new) | tests/setup/board-dir.ts (new) | tests/sluice-board-index.test.ts (test)
**Effort:** low, every verb, path and exit code is spelled out in the Contract and the tests pin them

- [ ] Add `tests/setup/board-dir.ts`, which sets `process.env.SLUICE_BOARD_DIR` to a fresh `mkdtempSync` directory, and `bunfig.toml` with `[test]` and `preload = ["./tests/setup/board-dir.ts"]` -> `bun test tests/sluice-status.test.ts` still green
- [ ] Write `tests/sluice-board-index.test.ts`, each test with its own `SLUICE_BOARD_DIR`: run-add writes the encoded file with the tree in it (`/a/b%c` gives `%2Fa%2Fb%25c`); run-drop removes it and exits 0 when it is already gone; session writes the JSON with `state` `working`; a second session call with another channel replaces the channel; session rejects `../x` and `bypass` with exit 4; handback flips a fast entry, leaves a deep entry unchanged, and exits 0 for an unknown id; prune removes a pointer to a tree with no run, keeps one with a run, removes a session whose `updated` is two days old and keeps one from now; with `SLUICE_BOARD_DIR`, `CLAUDE_CONFIG_DIR` and `HOME` all unset, run-add exits 0 and creates nothing -> all fail, the script does not exist
- [ ] Write `skills/sluice/scripts/board-index.sh` with a header comment in the style of `status.sh` naming the verbs, the root and the exit codes -> `bun test tests/sluice-board-index.test.ts` green

### Task 2: board renderer

**Contract:** Needs: `board-index.sh run-add <tree>`, `board-index.sh session <id> <channel> <tree>`, `board-index.sh handback <id>` (used by its tests to seed the index) | Offers: `board.sh [--json] [--watch [<seconds>]]`; `--json` prints `{"runs":[{"tree":<path>,"run":<run.json>}],"sessions":[<entry>],"counts":{"runs":<n>,"working":{"fast":<n>,"main":<n>,"deep":<n>},"handed_back":{"fast":<n>,"main":<n>,"deep":<n>}}}`, where `runs` holds each pointer whose tree has a readable `.sluice/run.json`, once per tree, and `sessions` holds each entry updated within 86400 seconds except a deep entry whose id equals some listed run's `session`; the plain form prints a header `sluice · <n> deep · <n> fast working · <n> fast handed back · <n> main working · <n> main handed back` (a zero segment omitted, deep counting runs plus deep sessions, `sluice · nothing running` when all are zero) followed by the local time `HH:MM:SS`, then per run a blank line, `<basename of tree>  <tree with $HOME shown as ~>` and the output of `status.sh line --full --dir <tree>`, runs ordered blocked first, then any task `active` or `review`, then the rest, each group by `updated` newest first, then a blank line and one line per session `<channel>  <basename of tree>  <working|handed back>  <◷ age | age ago>` with ages as `<m>m` under an hour and `<h>h<m>m` above; colour only when stdout is a terminal and `NO_COLOR` is unset, SGR sequences stripped from the run lines otherwise; control bytes dropped from every value read out of a session entry; `--watch` redraws every `<seconds>` (default 2, a positive integer, otherwise exit 4) by moving the cursor home and clearing to the end, hides the cursor and restores it on exit; `--watch` with `--json` exits 4; exit 5 without jq; reads the index and never writes it
**Touches:** skills/sluice/scripts/board.sh (new) | tests/sluice-board.test.ts (test)

- [ ] Write `tests/sluice-board.test.ts` against real `git init` repos with runs opened by `status.sh init` and the index seeded by `board-index.sh`: empty index prints `sluice · nothing running`; two runs and a fast working session give the header `sluice · 2 deep · 1 fast working`; a pointer to a tree whose run was closed is not drawn; two pointers to one tree draw it once; a run with a blocked task is drawn before one with an active task; a handed-back main session shows `handed back`; a deep session whose id is a drawn run's `session` is not listed; a session entry updated two days ago is not listed; `--json` counts match a hand-written object for a seeded index; a session tree path containing `\u001b[2J` draws without the escape byte; output piped to the test contains no `\u001b[`; `--watch 0` and `--watch --json` exit 4 -> all fail, the script does not exist
- [ ] Write `skills/sluice/scripts/board.sh`, building the combined state in one jq pass and rendering from it, `--json` printing that state -> `bun test tests/sluice-board.test.ts` green
- [ ] Add a test that spawns `board.sh --watch 1` with a 2500ms spawn timeout (the process is ended by SIGTERM) -> its stdout carries `\u001b[H` at least twice, never `\u001b[2J` after the first frame, and ends with `\u001b[?25h`

### Task 3: stop hook records a handback

**Contract:** Needs: `board-index.sh handback <id>` | Offers: when `stop-guard.sh` exits without printing a block decision and the stop JSON carries a `session_id`, it runs `board-index.sh handback <session_id>` before exiting, with that call's output and failure discarded; a refusal changes no session entry
**Touches:** skills/sluice/scripts/stop-guard.sh (edit) | tests/sluice-stop-guard.test.ts (test)

- [ ] Add tests: with a fast session entry seeded by `board-index.sh session`, a stop the hook lets through leaves it `handed back`; a stop the hook refuses (a deep run past pre-flight with every task `todo`) leaves a session entry `working`; a second attempt with `stop_hook_active` true marks it `handed back` -> the first and third fail against the current hook
- [ ] Set a `refused` flag wherever the hook prints a block decision, and install an EXIT trap after the stop JSON is parsed that calls `board-index.sh handback "$sid"` when `refused` is unset and `sid` is non-empty, with a comment saying why the trap rather than each exit -> `bun test tests/sluice-stop-guard.test.ts` green

### Task 4: status.sh feeds the board

**Contract:** Needs: `board-index.sh run-add <tree>`, `board-index.sh run-drop <tree>`, `board-index.sh session <id> <channel> <tree>`, `board-index.sh prune`, `board.sh --json` (in tests) | Offers: every successful `write_state` runs `board-index.sh run-add <physical path of the tree holding the state>`; `move` drops the old tree's pointer and adds the destination's after the state arrives; `close` drops the pointer after archiving; `init` runs `board-index.sh prune` before writing; `route <channel>` with a session id (from `--session` or `CLAUDE_CODE_SESSION_ID`) runs `prune` then `session <id> <channel> <git top level of the directory, or its physical path outside git>` after printing its line, and with no session id writes nothing; a board-index failure in any of these prints a `status.sh: note:` line on stderr and leaves the command's own exit code and output as they were
**Touches:** skills/sluice/scripts/status.sh (edit) | tests/sluice-board-wiring.test.ts (test)
**Flips:** `route` writes a session entry and every run write keeps a pointer, so the board shows live work; before this task the board read an index nothing outside the tests wrote

- [ ] Write `tests/sluice-board-wiring.test.ts`, each test with its own `SLUICE_BOARD_DIR`, asserting through `board.sh --json`: `init` makes the run appear; `close` removes it; `move --to <worktree>` shows it once at the worktree; a run whose pointer file was deleted reappears after `task 1 --status active`; `route fast --session s1` shows a working fast session at the repo top level; `route main --session s1` after it shows main only; `route fast` with no session id exits 0, prints `sluice: fast channel` and leaves `sessions/` empty; with `SLUICE_BOARD_DIR` pointing at a regular file, `route fast --session s1` still exits 0 with its line and a `note:` on stderr -> all but the no-session test fail against the current script
- [ ] Wire the calls into `write_state`, `move`, `close`, `init` and the `route` block, each with a one-line why comment -> `bun test tests/sluice-board-wiring.test.ts` green and `bun test` matches the baseline plus the new tests

### Task 5: docs and version

**Contract:** Needs: every task above | Offers: `references/status.md` says what `route` writes and that a missing session id writes nothing, and gains a `## Board` section covering `board.sh`, `--watch`, `--json`, the index location and `SLUICE_BOARD_DIR`, what fast and main entries show and when they expire; the `scripts/status.sh` header documents the board calls; `skill.json` description mentions the board and its version is 0.26.0; `skills/index.json` regenerated
**Touches:** skills/sluice/references/status.md (edit) | skills/sluice/scripts/status.sh (edit) | skills/sluice/skill.json (edit) | skills/index.json (edit)

- [ ] Edit `references/status.md`: replace "`route` reads and writes no state" with what it now writes and why, add the board command lines to the opening block, and add `## Board` before `## Friction` -> read back against the design's D1 to D4, no em dashes
- [ ] Add the board calls to the comment header of `status.sh` -> `bash -n skills/sluice/scripts/status.sh` clean
- [ ] Run `bun run skill:bump sluice minor`, update the description in `skill.json`, run `bun run build:index` -> `skill.json` reads 0.26.0 and `bun test` is green
