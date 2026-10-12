# Run record: eval freshness

Plan: `docs/plans/2026-10-12-eval-freshness.md`. Design: `docs/specs/2026-10-12-eval-freshness.md`.

## Pre-flight

- **Review:** reviewers on T2 to T7. T2, T3 and T4 are code that later tasks build on; T5 and T6 make rule-to-case claims a stat cannot confirm; T7 is the flip. T1 and T8 capture eval output with no diff worth judging, so they skip.
- **Effort:** T2 and T4 at low (exact contracts, nothing turns on judgment), the rest at session effort. The verdict logic (T3) and the flip (T7) are where being wrong costs.
- **Workspace:** a plan worktree plus one per concurrent implementer, each agent committing its own task. The graph allows T3, T5 and T6 to overlap once T1 and T2 land.

## Notes

- The worktree tool branched from `origin/master` (1dcbb51), which lacks the unpushed bug-hunter commits. The branch was reset to local `master` (19aa601) before anything else landed.
- Design deviation, agreed at pre-flight: `regressed` uses `--tolerance` (default 0.1), because 1/runs can never flag a single-run drop.
