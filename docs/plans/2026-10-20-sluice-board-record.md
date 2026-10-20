# Record: sluice-board

Status lives in `.sluice/run.json`; this file holds the reasons.

## Pre-flight

- **Review: all 5 dispatch.** Every task qualifies under the tier table (T1 to
  T3 tier 1, T5 tier 2, T4 tier 3). Taken because the new scripts sit on the
  Stop hook and `route`, which every session runs.
- **Effort: 1 of 5 low.** T1 only: every verb, path and exit code is in its
  Contract. T2's rendering and T3/T4's edits to existing hooks turn on
  judgment.
- **Workspace: a worktree per concurrent implementer, agents commit.** The
  graph allows T2 and T3 together after T1; T4 (the flip) and T5 run alone.

## Workspace decision

The plan worktree `.claude/worktrees/sluice-board` (branch `sluice-board`) was
cut by hand and the controller stays in the main tree, outside worktree mode.
Entering it through the harness's worktree tool would cap every dispatched
agent to that one tree and make the T2/T3 wave serial, spending the answer
above. The run was opened with `--dir` into the worktree, so it lives there,
and every controller command passes `--dir` or `git -C`.

## Baseline

`bun test` on master at a35427e: 2353 pass, 1 fail, 1 error, 130 files.
A second run on master named the failures: "contract-only run driven probe
through handoff" and "aspnet recipe run driven probe through queue", both
hitting bun's 5000ms test timeout, each with an unhandled error between tests.
Neither touches sluice. They are timing flakes outside this plan, so a final
run is compared on sluice tests plus the count of non-sluice failures.

## Review findings

- T1 round 1: Important, a failed write exited 0 (`put` ran on the right of a
  pipe, so its `exit 1` ended a subshell). Sent back with three Minors that
  T2 would otherwise trip on: a stray bash stderr line, temp files matching
  the readers' globs, a no-root test that could not fail.
- T1, waiting rather than fixed: `handback` and `prune` exit 5 without jq
  (the Stop hook discards the exit, T3's brief says so); `session`/`handback`
  race on one file is unlocked (one session issues both in order, accepted);
  session JSON is multi-line (readers use jq, T2's brief says so); empty id or
  tree exits 0 silently by the Ground Rule.
- T3 surfaced, for T5: every script edit leaves the generated copies under
  `skills/sluice/evals/*/plugins/` stale, which `eval-plugins` "every copy
  matches its source" catches. Plan change: T5 runs `bun run eval:plugins`.
  The Ground Rule against editing those copies stands; regenerating them is
  what the rule points at.
- T3 review: no Critical or Important. Two Minors sent back while T2 was in
  review: no test pinned `refused=1` at the verify gate, and the new tests read
  the real `~/.claude` stamps for want of `CLAUDE_CONFIG_DIR`. Waiting rather
  than fixed: the stop-guard suite runs whatever `bash` is on PATH (Homebrew
  5.3 here), so 3.2 was checked by hand by the reviewer, not by the suite.
- T2 review round 1: 2 Critical, 4 Important. A run.json with an odd shape, or
  a file deleted between the check and jq's read, failed the whole frame
  (plain exit 1, blank watch frames, `--json` empty with exit 0); pointer paths
  reached the terminal raw; one bad session hid every session line while the
  header still counted it; jq errors painted over the watch screen; no test fed
  any malformed input. Sent back with the cheap Minors (newline in a tree path,
  invalid session state or tree drawn, trailing newline scrolling a tall
  frame, ordering tests).
- T2 round 2: all ten round-1 findings fixed. New: a `cat` per file per frame
  (Important) and file contents passed as jq argv, so one run.json past the
  OS argv limit failed the whole board (Minor); both sent back as round 3.
  Accepted and waiting: hand-edited entries with no `updated`/`started`,
  fractional seconds, no `tasks`, or a working session with no `routed` are
  dropped rather than drawn with a fallback. Exit 6 for a whole-state failure
  (beyond the contract's list) judged sound: same meaning as status.sh's 6.
- T2 round 3 cleared. Waiting rather than fixed (Minor): `status.sh line`
  runs inside board.sh's `while read` loop and inherits its stdin; harmless
  while status.sh never reads stdin, and `</dev/null` would close it.
- T4 (flip) review: invariant held on every path probed (init, --force,
  move main->wt1->wt2->main, run.at and sessions/<id> resolution, close of an
  unreadable run, close through the fallback, symlinked and relative dirs,
  refused moves, concurrent flips). Cost: a task flip +5ms. Five Minors; four
  sent back, with Touches widened to board-index.sh and its tests by
  controller decision because two of the fixes live there: prune spawned a jq
  per session (route at 420ms with 100 sessions), run-drop ignored rm
  failure, a board failure printed two stderr lines, a stale route comment.
  Accepted: prune holds no lock, so a close-then-init racing another
  session's prune can leave the new run off the board until its next write.
- T4 fixes (5ce1338) read by the controller, not re-reviewed: small, each
  pinned by a test. route now 51-67ms flat from 1 to 100 sessions. Accepted:
  prune's run-pointer pass still reads `head -n 1`, so a tree path holding a
  newline loses its pointer at the next prune until its next write.
- T5's full suite timed out four stop-guard tests at bun's 5s (106/106 alone).
  Measured the hook, master against this branch, 30 runs each: with no board
  entry for the session 43ms -> 50ms (the board-index.sh spawn), with an entry
  43ms -> 67ms (spawn plus a jq read and write). Not enough on its own to push
  a single hook run near 5s; the tests that timed out run the hook or status.sh
  several times under a loaded full suite. Rechecked at the final full run.
- T5 review: Important. `route deep` writes a deep session entry that nothing
  retires (handback skipped deep, close never touched it), so after close the
  board showed `deep … working` and counted it for a day. A plan change to
  T1's Offers, so asked: partner chose "the hook decides". Task 6: handback no
  longer skips deep; the Stop hook calls it only when no run is live for the
  session, so a deep session at the design stop or after close reads handed
  back and one mid-run is left to its bar. T5's two Minors (overstated "every
  write adds the pointer", an unwrapped line) and the doc sentence on deep rows
  are folded into Task 6, since the prose must describe its behaviour.
- A full run during Task 6 (850s, 17 fail, 3 errors) is not evidence either
  way: it overlapped T6's implementer running tests in the same tree (three
  fails are T6's red handback tests) and the rest are 5s timeouts scattered
  across plan, statusline, stop-guard and migrate files under that load. The
  verdict comes from a quiet run with nothing else executing.
- T6 review round 1: Important, the trap resolved the session's run on every
  let-through stop, even with no board entry, and repeated the run guard's
  resolution: 44ms (master) -> 63ms per stop. Sent back: reuse the guard's
  result and return early when the session has no entry (stop-guard.sh gets a
  third copy of the board-root block, the third caller; kept as a copy rather
  than a shared file because the scripts share no sourced code today). With
  it: slimmer liveRun tests that sat at bun's 5s, tests for a closed run and
  the sessions/<sid> pointer path, and two overstated sentences.
  The third copy meets the partner's "refactor at the third caller" rule, but
  the refactor's shape (a sourced shared file) is a pattern these scripts do
  not use, which the same rules say to ask about first. Raised at handback.
- T6 fixes (eefaca2) read by the controller: no-entry stops back at master's
  ~43ms (early return before any git call), fast ~70ms and deep mid-run
  ~85ms per stop, against master's 43/69 which writes no board. T5 marked done
  with its findings closed by T6.
