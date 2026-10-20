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
