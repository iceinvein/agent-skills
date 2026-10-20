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
