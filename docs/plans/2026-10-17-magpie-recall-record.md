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

## Baseline (T4, first pass)

- pr-50: kept 8 (all unlabelled), label recall 0/6, missed-recall 0/14, cost $6.65, result
  `2026-10-17T07-31-28-555Z-full-pr-50-1789099641.json`.
- pr-70: kept 22 (20 unlabelled), precision 1.00, label recall 0.22, missed-recall 1/5
  (miss-1, the uuid namespace collision, caught by architecture-s4-2), cost $8.00, result
  `2026-10-17T07-43-18-768Z-full-pr-70-1790391863.json`. Judge about $0.06 per call.
- pr-50 looks broken: the 8 kept findings sit in 3 of the 76 diff files (the original run
  kept 58). Shard coverage cannot be checked, because replay-full deletes the scratch dir.
  Fix task T9 adds the replay's log, manifest, findings files, deduped count and critic drops
  to the result. Then pr-50's baseline is re-run before the flip. T4 stays active until
  that re-run lands.
- T9 review: blocking. The controller's T9 brief said that a non-JSON `log.jsonl` line
  throws. The model writes most log lines, and status/render already tolerate bad lines, so
  throwing would lose a paid replay. The brief was corrected in the fix round: such a line is
  recorded as `{unparsed, line}`. The test pinning the throw was written in this same task
  from the wrong brief, so it is rewritten to the corrected spec, not loosened. The fix round
  also captures evidence-dropped, threshold-dropped and the stored shard coverage.
- pr-50 baseline re-run (`2026-10-17T07-53-30-871Z-full-pr-50-1789099641.json`, $7.35):
  `shards 2/7`. Root cause, from the stored log: the replay agent rationed its own work
  against `--max-budget-usd 10`. It logged `shard-coverage partial`, reviewed [1, 6], and
  skipped [2, 3, 4, 5, 7] with reason "USD budget cap", which also left 3 focus pairs
  unreviewed on shard 6. A 7-shard PR needs 35 specialist agents, which does not fit in $10.
  So neither pr-50 baseline measures the pipeline. pr-70 ran before T9, so its coverage is
  unverified. The run is paused for a spend decision from the user.
- Spend decision (user): raise caps to $40 per side for pr-50 and $15 per side for pr-70,
  about $120 more (about $140 total against the $70 first approved). Both baselines re-run
  with diagnostics. The first-pass baselines above are superseded.
- Raised-cap re-runs failed: both `claude -p` calls exited 1 with `is_error true, subtype
  success` and empty stderr. That is probably the account usage limit, which was hit at the
  same moment. No result files were written. Run paused. Resume by re-running T4 at the
  raised caps (commands in the plan's Ground Rules). Nothing in `skills/magpie` has changed
  since T9, so the baseline will still measure the pre-flip prompts.

## Baseline (T4, final)

| Run | Shards | Kept | Missed-recall | Label precision / recall | Cost | Result |
|---|---|---|---|---|---|---|
| pr-50 | 6/7 (cap cut shard 7) | 44 | 1/14 | 0.00 / 0.00 | $32.63 | `2026-10-17T12-20-55-298Z-full-pr-50-1789099641.json` |
| pr-70 | 6/6 | 21 | 1/5 | 1.00 / 0.11 | $13.30 | `2026-10-17T12-32-21-670Z-full-pr-70-1790391863.json` |

- Caught at baseline: pr-50 miss-10 (stale partial ids, by bugs-s6-2) and pr-70 miss-1 (uuid
  namespace, by architecture-s4-2). Pooled: 2/19.
- Label precision and recall are near zero on pr-50 because most replay findings are
  unlabelled (fresh wording does not Dice-match the labelled titles). Read them as weak.
- T7 caps are scaled by the extra specialist (6/5): $48 for pr-50 and $18 for pr-70, so that
  the after run is not rationed harder than the baseline. Compare shard coverage alongside recall.
