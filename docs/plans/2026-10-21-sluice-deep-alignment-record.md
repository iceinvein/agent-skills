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

## Hunt

- Report: `.bug-hunter/2026-10-21-sluice-deep-alignment/report.md` (2 bugs, 3 ambiguities, 20 covered; BSD awk and gawk agree throughout).
- **B1 and B2 (I9, spec D4 and Trace 3, "import ignores the new lines"):** `import` refused a plan with an empty or prose `**Builds:**` line, because the Builds parse errors were not gated to validate. Fixed by T5 at 895408d: the two Builds parse errors are gated on validate's `check_spec` flag. The hunt's repro passes on re-run (2 of 2), and the T5 review cleared under BSD awk and gawk.
- **Ambiguities for the partner at the handback:** A1, an unreadable spec gets the "does not exist" message; A2, `D2.` with a trailing period gives two errors; A3, an empty Builds line is an error while a missing one is only a warning (the T2 round 1 review chose the error deliberately, and D4 names no finding for it).

## Decisions during the run

- **T3 brief settled three things the plan left open.** The skeleton lines are `**Spec:**` under the title and `**Builds:**` after `**Touches:**`. The intent check's brief names the spec's `## Intent` section, which T1's `checker-dispatched` grader needs, and the plan check's brief names both paths. The spec skeleton goes after `## The ground`, before `## The trace`, with placement left to the implementer within that.

- **T2 (1f96b3c): `import` skips the spec checks.** `parse_plan` takes a flag that only `validate` sets. Import runs from the repo root, where a test fixture's relative `spec.md` does not resolve, and it refuses any plan with errors, so applying the checks there would have broken every import test. The coverage checks belong to validate, and import seeds rows.

## Findings

- **T1 review, round 1 (8eb2081):** 2 blocking. `validate-ran` matched any mention of `plan.sh validate`, so it was re-anchored on `"command"` as the migrate grader is. `checker-dispatched` could be satisfied by the ground's Explore dispatch, so it now also requires the check's own vocabulary. Notes taken: the citation grader now accepts a relative path, and a hint in the prior-spec fixture's `src/report/exports.js` that gave away the answer was removed. Note rejected: the README count, since 25 case directories exist and the reviewer had miscounted.
- **T1 review, round 2 (02a9bb5):** cleared, with no blocking findings. Note kept as is: the `Intent` lookahead in `checker-dispatched` is case-sensitive. Task 3's brief for the intent check names the spec's `## Intent` section, so a brief written from it carries the capitalised word. `plan-checker-dispatched` was left matching any dispatch that names both paths: an implementer brief would also carry `Builds`, and `stops-at-preflight` already catches that run.
- **T2 review, round 1 (1f96b3c):** 2 blocking. A backticked Spec path, the form `docs/plans/2026-08-07-sluice.md` uses, was reported as missing; an empty Spec value crashed awk's getline and exited 4, blaming the plan file. Note taken: an empty Builds line now errors. Notes left: a bare `none` stays accepted, consistent with a bare `Effort: low`; a Spec path that is a directory crashes BSD awk (exit 4), which is unlikely and left as is. The coverage logic held under BSD awk, gawk and bash 3.2: separators, D1/D10 prefixes, CRLF, spaces in the path.
- **T2 review, round 2 (dc8c0e1):** cleared. Both blocking findings closed under both awks; `docs/plans/2026-08-07-sluice.md`'s backticked Spec now resolves.
- **T3 review, round 1 (e0c5125):** 1 must-fix, and it is a defect in the spec, not only the prose. D3 says to send the checker "the spec's path", but under plan mode the design lives in the harness's plan file until approval, so no spec path exists yet. Fixed in the prose the way the trace already handles it (the plan file under plan mode, the spec file otherwise). The spec's wording is left as signed and the deviation is reported at the handback. Notes taken: the router now orders the ground before any fork question; the fix rule says the draft for the intent check and the plan for the plan check, so a signed spec is never edited; a quoted validate message is made to match plan.sh; four tests that passed on opposite prose are tightened.
- **T3 review, round 2 (cc6c06e):** cleared. Note left: a short line at SKILL.md:137 from the rewording, cosmetic only.
- **T4 (64d9a67):** `skill:bump` rewrote only `skill.json`, so `bun run build:index` regenerated `skills/index.json` and `.claude-plugin/marketplace.json`. The implementer's suite run had no `node_modules` in the worktree, so 12 magpie files never loaded; the controller ran `bun install` (git-ignored) and re-ran the suite. Review cleared. Note left: the description names validate twice in a row, which is wording only.
- **Final review (6ff2868..HEAD at 895408d):** no blocking findings. The graders match the prose, the D3 deviation is sound, and D1 to D6 are delivered. Taken: `plan-cites-the-spec` rejected a backticked Spec path that validate accepts, which is a false negative on a correct run; fixed as T6. Notes left: the prose's list of validate errors omits the empty-Builds and not-a-decision-id errors, which T2 added and D4 does not name; D1's "one sentence" in SKILL.md became a 5-line paragraph, still within the plan's 15-line budget; T5 and T6 were added during the run and are recorded here rather than in the plan file.
- **T6 (0f63c29):** `plan-cites-the-spec` takes an optional backtick around the path. Review cleared. Note left: `OPS-13.mdx` would also match, which was already true before the commit.
- **Eval runs (partner approved; `claude plugin eval`, opus-5-5 model and judge, one run each, `--ablation none`):** `deep-plan-checks-the-intent` 1.00 ($0.80) and `deep-plan-checks-the-plan` 1.00 ($1.07). `deep-plan-reads-the-prior-spec` scored 0.50 on its first run. The run cited and followed the prior spec correctly but then asked a genuine fork question (whether the nightly clear unlocks accounts), so no spec was written. That is a fixture defect: the ticket left the fork open. The controller fixed the ticket text directly, a one-line prompt edit made without dispatching an implementer, and the re-run scored 1.00 ($0.90). Two pre-existing cases this branch does not touch (`fast-leaves-an-unrelated-red-test-alone`, `fast-updates-the-test-the-change-replaces`) fail to load with a YAML frontmatter parse error, which is reported and not fixed here.
- **Full suite at 64d9a67, with packages installed:** 2495 pass, 0 fail across 134 files (361s). The baseline was 2455 pass and 2 fail on master, and the 2 master failures were not identified; nothing fails on the branch.

## After the merge

- **Hunt ambiguities answered by the partner.** A1: an unreadable spec gets its own message. A2: a trailing full stop on a decision id is accepted. A3: a missing Builds line becomes an error like an empty one, because `none, <why>` is how a task says it builds nothing. That changes D4's "warn: a task with no Builds line"; the spec stays as signed, and this row is the record of the change.
- **fe272df:** validate tells a missing, a directory and an unreadable Spec path apart, using a shell `test` before the read. This also fixes the BSD awk crash on a directory path that was logged as unfixed. `D2.`, `D2;` and `D2:` count as D2. A Spec path with an apostrophe is pinned by a test, after the probe caught a quoting bug in the first version.
- **Missing Builds line is an error:** `tests/sluice-plan.test.ts`'s "warns without blocking" test is updated to the new behaviour (exit 2, `task 2 has no Builds line; write D<n>, or none, <why>`) and recorded as proved against the session base. The reference moves the missing line from the warnings to the errors, and its prose test is tightened to read only the warnings sentence.
- **Local magpie review (archived at `~/.magpie/local-master-1792602238.archived-1792602557294`):** 0 must-fix, 3 should-fix, 5 optional, all addressed in 2b873a4. The partner chose to anchor a relative Spec path at the plan's repo root, or the plan's own directory outside a repo. The hunt on 2b873a4 (`.bug-hunter/2026-10-21-sluice-review-fixes/`) proved 2 regressions in that anchoring, an exported CDPATH and a backslash in the path, both fixed test-first in da1b19b. Still open for the partner: A1, whether a symlinked plan resolves its Spec from the link's repo or the target's (today it is the link's). The fresh review found nothing blocking. Its notes taken: the two grader comments now state that an early matching Agent fails the case rather than being ignored, and the reference no longer claims every validate message names a task.
