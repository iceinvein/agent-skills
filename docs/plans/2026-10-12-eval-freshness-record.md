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
- T4 landed as 111f306 and was cherry-picked as 71fd1e9.
  - Round 1, Important: the baseline is cast without validation. A `null` baseline reads as none and exits 0, so it hides regressions.
  - Round 1, Important: no tests for `run`. They will use a fake `claude` on PATH.
  - Minors sent back: validate before the paid spawn; mkdir `results/`; sanitize model ids in filenames; reject unknown flags.
  - ef-t4 was reset to ce72e5e for the fix round.
- T9 landed as f6e2297 and was cherry-picked as ce72e5e. Round 1 met the contract.
  - Two Important test gaps: a vacuous guard on the wrong case, and the unclaimed exemption applied to every case. Both survived mutation.
  - Sent back as tests only.
- I sent T5 and T6 their reworks while T9's test-only fixes were still out. T9's Offers do not change in that round, so the rework builds on a stable schema. Their worktrees were reset to ce72e5e.
- T9 test fixes landed as 65a8628 (b25d231). Each new test was checked against the mutant it targets, so T9 is done and reviewed.
- T6 rework landed as 5045500 (abc30a6). It has 18 rules (7 pinned, 11 unpinned), with `vacuousWithout: [callers-tree-unchanged]` and `unclaimed: []`. Origins now cite commits where no doc introduced the rule. The implementer split the `.gitignore` rule: "not edited" is pinned by `tree-unchanged`, while "named in hand-back" is unpinned. I spot-checked it myself rather than sending a second review, because the rework only applied round-1 findings.
- T4 fixes landed as b1344ab (e4f969e). Baselines are validated and exit 2 when bad, `run` is tested through a fake `claude` on PATH, and inputs are checked before the paid spawn. Model ids are sanitised in filenames, and unknown flags exit 2. I read the diff and the 104 tests pass.
- T5 rework landed as 992686d (c9daddf). It has 38 rules, `vacuousWithout: [superpowers-conflict-stands-down]` (a bare model never names a channel), and `unclaimed: [fast-reads-the-unmentioned-convention]`. The pre-flight stop origin is `commit:371804f`, the commit that wrote the stop as SKILL.md states it now. The full `bun test` run: 1909 pass, 0 fail.
- Minor, waiting: `skills/index.json` still lists sluice 0.23.1 and bug-hunter 0.2.1. `bun run build:index` belongs to the release.
- Minor: `skill:bump:check` compares against tag v0.21.5, so it proves nothing about this run's bumps. The bumps were made by hand.
- T7 (the flip) landed as bd708b7. Its drift check went red on a renamed case, and the full suite was 1912 pass. The tier-3 review cleared with no Critical or Important findings; the invariant also holds from another cwd and from a CI-like clean copy. Two Minors, waiting:
  - Only sluice and bug-hunter are pinned as required, so deleting a future third skill's `rules.json` drops its check silently.
  - `publish.yml` runs only on `v*` tags, so drift blocks publishing but not merging. Catching it at PR time would need a separate workflow.
- T8 first read (Opus 5.5, one run per arm, judge Opus 5.5, CLI 2.1.296, on the user's plan). Both runs exited 0, and nothing was accepted as a baseline.
  - bug-hunter (USD 4.21 at API prices, 382s): every case scored 1.00 with the skill. Without it, 0.00 everywhere except `callers-tree-unchanged`, which scored 1.00 and is correctly not called redundant because it is in `vacuousWithout`.
  - sluice (USD 20.09, 1621s):

    | Case | With | Without |
    |---|---|---|
    | announcement-reaches-the-ledger | 0.40 | 0.40 |
    | bypass-question-stays-silent | 1.00 | 1.00 |
    | deep-plan-across-subsystems | 1.00 | 0.42 |
    | deep-plan-asks-the-fork | 1.00 | 0.44 |
    | deep-run-blocks-on-a-real-decision | 0.54 | 1.00 |
    | deep-run-decides-a-non-blocking-choice | 1.00 | 1.00 |
    | deep-run-fans-out | 1.00 | 0.28 |
    | deep-run-finishes-every-task | 1.00 | 1.00 |
    | deep-run-survives-a-milestone | 1.00 | 1.00 |
    | deep-run-waits-for-a-running-agent | 1.00 | 0.75 |
    | explicit-instruction-collapses-to-fast | 1.00 | 0.71 |
    | fast-flag-on-existing-command | 1.00 | 0.28 |
    | fast-reads-the-unmentioned-convention | 1.00 | 1.00 |
    | main-new-interface | 1.00 | 0.33 |
    | superpowers-conflict-stands-down | 1.00 | 0.50 |

  - Expiry candidates: bypass-answers-without-announcing, deep-run-finishes-without-checking-in, deep-run-survives-a-milestone and deep-run-decides-a-non-blocking-choice. Each rests on a single sample.
  - Two results the verdicts cannot show:
    - `announcement-reaches-the-ledger` scored 0.40 with sluice, against 1.00 in the 2026-09-23 hand-written baseline. No committed baseline exists, so nothing could flag it.
    - `deep-run-blocks-on-a-real-decision` scored worse with sluice (0.54) than without it (1.00). No verdict covers the skill making the model worse. That is a design gap, not in this run.
- Final review. Integration, suite (1912 pass), tsc, skill:audit and commit messages are all clean.
  - Important: `accept` on a `--case` run replaced the whole baseline, which hid regressions.
  - Important: errored runs scored 0 silently and could be accepted.
  - Fix, kept in the CLI so no shared contract changes: `accept` refuses filtered or errored results with exit 2, and `diff` lists errored runs. I chose to refuse rather than merge a filtered result into the baseline, because refusing is the smaller and louder fix.
  - Minor, waiting: a mistyped `--against` reads as no baseline. The header says so.
  - Minor, waiting: baselines store per-run scores rather than a mean and a count. Both can be derived.
- Merge to master, chosen by the partner, was blocked by uncommitted bug-hunter work in the main tree. The partner committed it. Master then held bug-hunter 0.4.0 (one agent, new SKILL.md sections, seven cases) and the new scope-estimate skill.
  - The branch was rebased onto master (96099f5), keeping master's bug-hunter 0.4.0 version over this branch's 0.2.2 bump.
  - After the rebase, the flip's check went red on bug-hunter: a case was gone and three new cases were unmapped. The check did what it exists for.
  - The bug-hunter manifest was rebuilt against 0.4.0 in f7c7771: 20 rules. Rules that 0.4.0 no longer states were dropped. `callers-tree-unchanged` stays in `vacuousWithout`.
  - Review of the rebuild found two Important errors, both fixed in f9f6bdf:
    - The contradicted-claim bullet was marked unpinned although three cases pin it. The repo-stated sources from the old reason became their own unpinned rule.
    - The changed-body rule was missing `silent-spec-is-an-ambiguity`.
  - Minor, waiting:
    - The run directory's date prefix is unchecked by any grader.
    - A heredoc-written `findings.json` passes the Write-tool graders.
    - The scratch-copy rule absorbs caveats the old manifest stated.
    - In practice no bug-hunter rule can become an expiry candidate, because a bare model never writes the skill's artefacts.
  - Full `bun test` after the fix: 1962 pass, 0 fail.
- Design deviation, agreed at pre-flight: `regressed` uses `--tolerance` (default 0.1), because 1/runs can never flag a single-run drop.
