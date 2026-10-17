# Run record: magpie recall

Spec: `docs/specs/2026-10-17-magpie-recall.md`. Plan: `docs/plans/2026-10-17-magpie-recall.md`.

## Pre-flight

- **Review:** code tasks only. A reviewer goes out at T2, T3, T5 and T6. T1 (seed data),
  T4 and T7 (replays) and T8 (eval run) skip review: their output is data or measurement,
  which the controller checks directly. Chosen by the user from the recommended option.
- **Effort:** all 8 tasks at session effort. Every task either carries judgement (prompt
  wording, judge design, coverage edge cases) or is measurement the controller reads.
- **Workspace:** one worktree (`.claude/worktrees/magpie-recall`, branch
  `worktree-magpie-recall`), and agents commit their own tasks. Implementers run serially,
  since the session is in worktree mode. T1 writes only outside the repo, so it may overlap T2.
- **Spend:** about $70 approved for replays: PRs 46, 50 and 70 before and after the flip,
  each capped at `--max-cost-usd 10`, plus `eval:fresh`.

## Decisions

- T5 gained `Needs: baselineResults` after validation, so that the flip cannot land
  before the baseline replay measures the pre-flip prompts.
