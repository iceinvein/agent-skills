# Run record: eval freshness

Plan: `docs/plans/2026-10-12-eval-freshness.md`. Design: `docs/specs/2026-10-12-eval-freshness.md`.

## Pre-flight

- **Review:** reviewers on T2 to T7. T2, T3 and T4 are code that later tasks build on; T5 and T6 make rule-to-case claims a stat cannot confirm; T7 is the flip. T1 and T8 capture eval output with no diff worth judging, so they skip.
- **Effort:** T2 and T4 at low (exact contracts, nothing turns on judgment), the rest at session effort. The verdict logic (T3) and the flip (T7) are where being wrong costs.
- **Workspace:** a plan worktree plus one per concurrent implementer, each agent committing its own task. The graph allows T3, T5 and T6 to overlap once T1 and T2 land.

## Notes

- The worktree tool branched from `origin/master` (1dcbb51), which lacks the unpushed bug-hunter commits. The branch was reset to local `master` (19aa601) before anything else landed.
- T1 result shape (CLI 2.1.296): the no-plugin arm is `cases[].arms.without`, an array of runs shaped like `with`'s (`score`, `passed`, `error`, `graders[]` with `withOnly` and `scored`). The case also carries `aggregates.scoreWithout`, `passRateWithout` and `delta`. In this case both arms scored 1.00, so the bypass rule is already redundant on Opus 5.5 by one sample.
- T2 review round 1:
  - Important, sent back: an empty or directory `states` or `origin` passes the check.
  - Minor, sent back because they are cheap: thin shape tests, and an empty `unpinned` counting as a reason.
  - Minor, waiting: `caseNames` throws on a broken symlink under `evals/`.
  - Minor, waiting: a case listed twice within one rule is not reported.
- T2 round 1 fixes landed in 7a89b66. That was a small fix, so I read the diff and confirmed the tests (22 pass) rather than dispatching a second review.
- T3, T5 and T6 each run in a hand-cut worktree (`.claude/worktrees/ef-t3`, `ef-t5`, `ef-t6` inside the plan worktree) on branches from 7a89b66. I cut them by hand because the harness worktree tool branches from `origin/master`.
- Decisions I settled in the T3 brief:
  - `judgeModel` falls back to `haiku` when absent, which is the CLI's documented default judge.
  - A case missing from the current run is not reported, since that is a partial `--case` run.
  - An empty `without` arm gives a mean of 0 and never yields `redundant`.
  - A run counts as passing at score 1.
- T6 landed as e02f1ad on ef-t6 and was cherry-picked as dd12f45. It has 8 rules, 3 of them unpinned: stop-when-no-intent, single-agent fallback, and hand-back contents. Minor, waiting: `skills/index.json` still lists bug-hunter at 0.2.1, because regenerating the index (`bun run build:index`) is a release step outside every Touches.
- T3 landed as a74b0a9 on ef-t3 and was cherry-picked as 2eebd78. I kept the implementer's reading of `expiry-candidate`: every one of the rule's cases ran and came back redundant, so a partial run never proposes pruning.
- T3 review round 1:
  - Important: a drop of exactly the tolerance flagged `regressed` because of float error.
  - Important: mutants survived at the tolerance boundary and on sandbox-without-drop.
  - Fixed in a5a0d23 (cherry-picked as 079fd2d), now 35 tests. That was a small fix, so I read the diff and confirmed the tests rather than sending a second review.
  - Minor, waiting: errored runs keep their score in the means.
  - Minor, waiting: `arms.without: null` is rejected rather than treated as absent.
- T6 review round 1:
  - Critical: `callers-tree-unchanged` passes vacuously in the without arm, because the CLI drops `Skill`-fired graders from the score there. That would make its rule a false expiry candidate.
  - Important: the fallback order is pinned by `scenarios-before-bodies`, so split that rule.
  - Important: the claim-contradiction-is-a-bug rule is missing.
  - Important: `intent-before-implementation` is only partly pinned.
  - Important: two origins don't record their rule.
  - Note: four rules can never read redundant, because bare runs write no skill artefacts. That errs safe.
- T5 review round 1:
  - Important: `fast-reads-the-unmentioned-convention` pins no rule sluice states.
  - Important: `verify-before-claiming` is pinned by the `suite-was-run` graders.
  - Important: some origins misattribute rules that entered through commits with no doc.
  - Important: rules are missing, including the dispatch label (pinned), the flip runs alone (pinned), and run.json state.
  - Minor: the README's `sandbox` wording, plus weak or extra pins.
- Partner decisions after those reviews, as a plan change adding Task 9:
  - `vacuousWithout` names cases that never get `redundant`.
  - `unclaimed: [{case, reason}]` holds cases that pin no stated rule.
  - `origin` may be `commit:<sha>`, format-checked only, because the publish job's checkout is shallow.
- T5 and T6 were reset to `todo` until T9 lands. Their round-1 findings are re-dispatched against the new schema.
- Design deviation, agreed at pre-flight: `regressed` uses `--tolerance` (default 0.1), because 1/runs can never flag a single-run drop.
