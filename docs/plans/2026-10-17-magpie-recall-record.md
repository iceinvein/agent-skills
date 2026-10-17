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
- T1 seeded 30 misses, not 29: 29 never raised plus the one PR 50 issue the critic dropped,
  which the plan's filter includes. The spec's "29" counted only the never-raised ones. Files:
  `~/.magpie/corpus/misses/`, generator at the session scratchpad `seed_misses.py`. No commit
  (nothing in the repo changed). `preExisting` is true only where the analysis set the field
  (PR 70 miss-2..4).
- Typecheck gate: `bun run typecheck` exits 127 (`tsc` not installed in the main tree or the
  worktree; pre-existing, not caused by this plan). This run uses
  `bunx -p typescript tsc --noEmit` from `skills/magpie` as the typecheck gate. Fixing the
  script is out of scope and goes to the handback.
- T2 review (tier 1) cleared with no blockers. A fix round (2ed5550) took two non-blocking
  findings: `--strict-mcp-config` so the judge loads no MCP servers, and fence-tolerant
  verdict parsing, so a formatting slip cannot waste a paid replay. It added an export,
  `recallJudgeCommand(model)`, that is not in the Contract.
- T3 brief settles a choice the plan left open: replay-full writes its result file before
  the judge runs (recall fields null) and rewrites it with recall afterwards. A judge failure
  then exits 1 naming the saved result instead of losing a $10 replay.
- Replay set narrowed to `pr-50-1789099641` and `pr-70-1790391863` for T4 and T7. PR 46 has
  no `post-status.json` (nothing was posted), so it is not a corpus run and has no labels.
  Inventing labels for it would fabricate data. The narrowed set covers 19 of the 30 misses
  (14 + 5) and lowers spend; PR 46's two platform/shell misses go unmeasured.
- T3 review (tier 2) cleared with no blockers. A fix round (8de426e) corrected the README's
  replay-coverage notes, said that the judge still loads user settings, and added the
  bare-run-id note for `--corpus`.
- T4 and T7 run controller-side. Each is one CLI invocation whose output is a summary line
  and a result JSON, so a dispatch would buy no context saving.
