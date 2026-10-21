# Run record: sluice-deep-alignment

## Pre-flight

- **Review: all 4.** Every task qualifies: T2 carries Flips and T3 is flagged (tier 3); T1's eval graders and T4's regenerated copies have no executable test over their words (tier 2). The graders are what pin the new behaviour, so a wrong one passing unread is the expensive failure.
- **Effort: 0 of 4 low.** Only T4 is mechanical and the saving there is negligible.
- **Workspace: one worktree, agents commit.** The graph allows no overlap (T2 is the flip and runs alone, T3 needs T2, T4 needs T3), so implementers are serial whatever the answer; the worktree keeps master clean.

## Alignment checks

- **Intent check:** not run. The design was signed off before this rule existed; the partner read the Intent table at sign-off.
- **Plan check:** run by hand before pre-flight, one fresh-context dispatch over spec and plan. 7 findings, 6 fixed in the plan, 1 deferred to the handback:
  1. D3's "sign-off reports the check" and D5's "validate re-run" had no step: added to T3's prose and test steps.
  2. T4 marked `Builds: none` although it builds D6's version and copies: now `Builds: D6`.
  3. T2 would turn about 22 existing validate tests red (fixtures with no Spec line): added a step updating every fixture and builder, as tests pinning deliberately changed behaviour.
  4. T2's expected-message step contradicted itself: rewritten to the `  error  <message>` format and `toMatch` style the file uses.
  5. T4 could regenerate the eval copies before T3's prose landed: T4 now Needs `alignmentChecksProse`, which T3 Offers.
  6. T4 compared against a baseline nothing recorded: baseline written into Ground Rules.
  7. Deferred: the spec's Verification asks for `claude plugin eval` on the three new cases. It costs money, so it is offered at the handback rather than run by a task.
  `plan.sh validate` re-run after the fixes: no errors.

## Decisions during the run

## Findings
