# Run record: migrate evals and gates

## Pre-flight

- **Review:** a reviewer on Task 6 (tier 3, the flip) plus the final review. The
  eight tier-2 tasks skip a per-task reviewer: the eval cases are checked by
  running them in Tasks 5 and 9, which is a stronger read than a reviewer's, and
  the final review covers the docs. Chosen by the partner on the recommendation.
- **Effort:** every task at the session's effort. Nothing in the plan is
  mechanical enough to mark low: the cases and docs turn on judgment, and Task 6
  is tier 3.
- **Workspace:** one worktree per concurrent implementer, each agent committing
  its own task. The plan worktree is `.claude/worktrees/migrate-evals` on
  `worktree-migrate-evals`. Tasks 2, 3 and 4 can overlap; 7 and 8 can overlap.

## Decisions during the run

- **Task 1 Touches widened to `skills/migrate/scripts/config.ts`.** `writeConfig`
  reads `templates/config.toml` from a path relative to the source file, which
  does not exist inside a `bun build --compile` binary (`ENOENT ...
  /$bunfs/templates/config.toml`). Fixed by importing the template with
  `with { type: 'file' }`, which embeds it in a compiled binary and still
  resolves to the real file under plain `bun`. Running `init` through
  uncompiled bun in the fixture instead was rejected: the probe case runs
  `init` inside the sandbox, so it would still break there. Contracts unchanged.

## Notes

- `status.sh` and `plan.sh` need `--dir` pointing at the worktree: without it they
  resolve the main checkout.
