# Run record: test-change gate

Design `docs/specs/2026-10-18-test-change-gate.md`, plan
`docs/plans/2026-10-18-test-change-gate.md`. State in `.sluice/run.json`.

## Pre-flight

- **Review: all tiers.** A reviewer at all 7 tasks, then bug-hunter on the
  plan diff and the final review after the flip. Chosen because the gate sits
  in the hook every sluice session runs, and T1, T6 and T7 are tier 2: no stat
  confirms a classifier's edge cases or the prose.
- **Effort: T4 low, the rest at session effort.** T4's output line, source and
  fixtures are fixed by its Contract. Its review runs at session effort.
- **Workspace: one plan worktree, serial implementers, each committing its own
  task.** The graph overlaps at most three tasks (T1, T2, T4), only in the
  first wave; the session is in worktree mode, so implementers run serially.

## Notes

- The harness cut the worktree from `origin/master` (`9cafd8d`), which lacks
  today's local commits, including `89ac27e` (the test-first change this gate
  backs). Fast-forwarded the plan branch to local `master` (`ace1c2f`) before
  anything else.
- Exit codes refine design D4: `tests-changed` exits 7 when the changed tests
  pass on old code and 8 when the control run fails on old code. D4's 1 and 4
  already mean "state could not be written" and "bad arguments" in
  `status.sh`.
