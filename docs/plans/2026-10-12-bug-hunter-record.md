# Run record: bug-hunter

Design: `docs/specs/2026-10-12-bug-hunter.md`. Plan: `docs/plans/2026-10-12-bug-hunter.md`.
Task status lives in `.sluice/run.json` (`status.sh show`), not here.

## Pre-flight

- **Review: tier 3 only.** Tasks 3 (classifier prompt), 5 (workspace leak
  boundary), 9 (leak audit and judge) and 10 (the flip) get a reviewer dispatch.
  Those are the tasks where a wrong call silently corrupts the benchmark's
  numbers or ships the skill. Tiers 1 and 2 (Tasks 1, 2, 4, 6, 7, 8) get a
  commit-stat read plus the final whole-plan review. This is the coverage level
  chosen, not a debt.
- **Effort: Task 1 low, the rest at session effort.** Task 1's filter rules
  and tests are fully specified, so it is mechanical. Nothing else was marked.
- **Workspace: one agent-skills worktree** (`.claude/worktrees/bug-hunter`,
  branch `bug-hunter`, cut from `origin/master` at `1dcbb51`). The harness repo
  at `~/Documents/projects/bug-hunter` is new, so its tasks commit straight to
  its `main`. Each agent commits its own task. At most three tasks overlap
  ({1,7}, then {2,3,8}). Tasks in the same repo run serially; tasks in
  different repos may run concurrently.

## Notes

- The session launched in the bug-hunter dir, which is not a git repo, so the
  harness worktree tool could not switch into agent-skills. The worktree was
  cut with `git worktree add` and is worked by absolute path.
