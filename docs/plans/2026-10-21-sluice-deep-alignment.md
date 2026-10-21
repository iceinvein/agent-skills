# Plan: sluice-deep-alignment

**Spec:** docs/specs/2026-10-21-sluice-deep-alignment.md

## Goal

Deep runs read the repo before designing, state their intent as a map from
each ask to the decisions that deliver it, and check that map twice with a
fresh-context reader: the spec against the intent before sign-off, and the plan
against the spec before pre-flight. `plan.sh validate` enforces what of the
plan-to-spec link is mechanical.

## Architecture

Three layers, matching the spec's split between mechanism and meaning.
`skills/sluice/scripts/plan.sh validate` gains a `**Spec:**` plan line and a
per-task `**Builds:**` line, reads the spec's `### D<n>.` headings in its END
block, and reports coverage as errors. `references/deep-channel.md` gains
`## The ground` and `## The alignment checks`, a spec skeleton, and the new
plan lines in its skeleton; `SKILL.md`'s Deep channel paragraph points at both
sections and carries the same skeleton. Three eval cases pin the behaviour the
prose asks for. No new agent file, status command or `run.json` field.

## Ground Rules

- Commit message convention: `<type>(<scope>): <subject>`, scope `sluice`,
  subject lower case, no trailing full stop. No `Co-Authored-By` trailer, no
  tool footer, no session link.
- Test runner: `bun test` from the repo root. Targeted runs:
  `bun test tests/sluice-plan.test.ts`, `bun test tests/sluice-skill.test.ts`,
  `bun test tests/eval-freshness-skills.test.ts tests/eval-plugins.test.ts`.
  Baseline before Task 1, on master at 96cedfa: 2455 pass, 2 fail across 134
  files (about 600s for the full suite).
- `plan.sh` stays bash 3.2 compatible with POSIX awk, tabs for indentation,
  no dependency beyond `jq` and `git`. Exit codes unchanged: 0 no errors,
  2 errors found, 4 bad arguments, 5 jq missing.
- Prose and comments follow the files they land in: no em dashes, comments say
  why, never what.
- Tests assert on what a caller observes (stdout, exit code, the prose's own
  sentences). Expected values are written by hand, never produced by running
  the code under test.
- `skills/sluice/evals/*/plugins/` are generated copies; only Task 4
  regenerates them, through `bun run eval:plugins`, and no task hand-edits
  them.
- An existing test that pins behaviour this plan deliberately changes (a
  plan fixture that now lacks a Spec line) is updated to the new behaviour;
  any other red test stops the task.

### Task 1: eval cases for the ground and the two checks
**Contract:** Needs: none | Offers: none
**Touches:** skills/sluice/evals/deep-plan-reads-the-prior-spec (new) | skills/sluice/evals/deep-plan-checks-the-intent (new) | skills/sluice/evals/deep-plan-checks-the-plan (new) | skills/sluice/evals/rules.json (edit) | skills/sluice/evals/README.md (edit)
**Builds:** D6
- [ ] Read `skills/sluice/evals/deep-plan-traces-the-example/` whole (case.yaml, fixture.sh, prompt.md, every grader) and copy its shape for each new case: `schema_version: "1.1"`, `scaffold_script: fixture.sh`, frontmatter with `allowed_tools`, the `announces-deep-channel.md` and `sluice-fired.md` graders copied verbatim, and the two no-source graders -> each new case dir has case.yaml, fixture.sh, prompt.md and graders/
- [ ] `deep-plan-reads-the-prior-spec`: fixture is a small node repo with three subsystems and a `docs/specs/2026-09-01-counters.md` whose decision says the counters persist in `data/counters.json` and are never held only in memory; the prompt asks for a plan of a feature whose obvious design keeps a counter in memory, and names no earlier spec. The README fixes the spec destination as `docs/specs/CNT-7.md`. `allowed_tools: [Read, Glob, Grep, Skill, Write, Agent]`. Graders: `design-written-to-docs` (file_exists), `context-cites-the-prior-spec` (regex on the new spec's file for `docs/specs/2026-09-01-counters\.md`), and an llm grader `design-follows-the-prior-spec` (PASS if the design persists the counter through the file the earlier spec settled, or asks the partner whether to supersede it; FAIL if it keeps the counter in memory without naming the conflict) -> `ls` lists all graders; fixture runs clean under `bash -n`
- [ ] `deep-plan-checks-the-intent`: fixture repo with three subsystems; the prompt carries a ticket with three numbered asks and says where the spec goes (`docs/specs/OPS-12.md`). `allowed_tools: [Read, Glob, Grep, Skill, Write, Agent]`. Graders: `spec-has-an-intent-map` (llm on the spec file: PASS if an Intent section quotes the ticket and maps each of the three asks to a decision or to Out of scope with a reason), `checker-dispatched` (tool_used, tool Agent, input_match naming `OPS-12.md`, min 1), `signoff-reports-the-check` (llm: PASS if the final message asks for sign-off and says the alignment check ran and what it found), `stopped-for-signoff` copied from the trace case -> `bash -n fixture.sh` passes
- [ ] `deep-plan-checks-the-plan`: fixture repo whose `docs/specs/OPS-13.md` is signed off, with `### D1.` to `### D3.` and an `## Out of scope` section; the prompt says the design is signed off and asks for the plan at `docs/plans/OPS-13.md`. Bash is allowed so validate can run: `allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]`. Graders: `plan-cites-the-spec` (regex on the plan file for `^\*\*Spec:\*\*\s*docs/specs/OPS-13\.md`, flags m), `every-decision-built` (llm on the plan: PASS if every task has a Builds line and D1, D2 and D3 each appear in at least one), `validate-ran` (tool_used Bash, input_match `plan\.sh(?:\\"|')?\s+validate`, min 1), `plan-checker-dispatched` (tool_used Agent, input_match naming both `OPS-13.md` paths, min 1), `no-source-edit` and `no-source-write` copied, and an llm grader `stops-at-preflight` (PASS if the final message asks the pre-flight questions and has started no task) -> `bash -n fixture.sh` passes
- [ ] `skills/sluice/evals/rules.json`: add three rules, `deep-reads-the-ground-before-the-design` (cases `deep-plan-reads-the-prior-spec`), `deep-checks-the-spec-against-the-intent` (cases `deep-plan-checks-the-intent`), `deep-checks-the-plan-against-the-spec` (cases `deep-plan-checks-the-plan`), each with `states` `"references/deep-channel.md: <section>"` naming `The ground` or `The alignment checks`, and origin `docs/specs/2026-10-21-sluice-deep-alignment.md` -> `bun test tests/eval-freshness-skills.test.ts` passes
- [ ] `skills/sluice/evals/README.md`: update the case count in the opening sentence, and add one table row per new case in the routing table, in the existing column shape -> the count in the sentence equals the number of case directories

### Task 2: validate ties the plan to its spec
**Contract:** Needs: none | Offers: `plan.sh validate <plan.md>` reading `**Spec:** <path>` and per-task `**Builds:** D<n>[, D<n>]` or `**Builds:** none, <why>`
**Touches:** skills/sluice/scripts/plan.sh (edit) | tests/sluice-plan.test.ts (test)
**Builds:** D4
**Flips:** `plan.sh validate` rejects a plan with no Spec line or an uncovered spec decision, from accepting it
- [ ] In `tests/sluice-plan.test.ts`, change `planFile` to also write a `spec.md` beside the plan holding `### D1. render` and `### D2. wire` headings (an optional argument overrides its body), and `validate` to spawn `plan.sh` with that temp dir as its cwd. The `imp()` import helpers stay as they are -> every existing test in the file still passes
- [ ] Give every plan fixture and builder that `validate` runs a `**Spec:** spec.md` line under its title and a `**Builds:**` line on each task: `GOOD` (task 1 `D1`, task 2 `D2`), `NO_PROOF`, `TAIL`, `EARLY_AND_LATE`, `WAVE`, and the `task()`, `two()` and `plan()` builders, plus any other fixture `grep -n "Plan:" tests/sluice-plan.test.ts` finds. These pin behaviour the plan deliberately changes, so they are updated, not special-cased -> every existing test in the file still passes, since today's parser skips bold lines it does not know
- [ ] Add one test per new finding, each breaking GOOD in one place. Findings print as `  error  <message>` or `  warn  <message>` and the file's existing tests assert with `toMatch` on the message; match that style, with these messages written by hand: no Spec line gives `error  no **Spec:** line, so nothing ties the plan to the design it builds`; a Spec path that does not exist gives `error  **Spec:** names <path>, which does not exist`; a spec with no decision headings gives `error  the spec <path> has no "### D<n>." decisions, so no task can say which one it builds`; a task citing D9 gives `error  task 1 Builds D9, which the spec does not have`; a spec decision D3 cited by no task gives `error  spec decision D3 is built by no task`; a task with no Builds line gives `warn  task 2 has no Builds line, so nothing says which decision it builds`; a Builds token that is neither `D<n>` nor `none` gives `error  task 1 Builds <token>, which is not a decision id; write D<n>, or none, <why>` -> each new test fails against the current plan.sh because the finding is missing, and every error test also asserts exit code 2 (a warning alone exits 0)
- [ ] Add tests that `**Builds:** none, version bump` passes with no finding, that a `### D2.` heading inside a fenced block in the spec is not read as a decision, and that an absolute Spec path resolves -> each fails or passes for the stated reason before the implementation lands
- [ ] Implement in `plan.sh`'s awk PARSER: match `**Spec:**` anywhere before the first task; match `**Builds:**` per task into a per-task list; in END, when a Spec line exists, resolve it (absolute as given, relative from the cwd), read it with a `getline` loop that skips fenced blocks and collects `^### D[0-9]+\.` ids, and emit the findings above through `finding()`. Pass the plan's directory nowhere: resolution is from the cwd, as the plan path is. Leave `plan.sh import` unchanged -> `bun test tests/sluice-plan.test.ts` all green
- [ ] Update the header comment's Rows/description block only where it lists what validate checks -> `bash -n skills/sluice/scripts/plan.sh` clean
- [ ] Run `bash skills/sluice/scripts/plan.sh validate docs/plans/2026-10-21-sluice-deep-alignment.md` from the repo root -> it exits 0 and reports 4 tasks

### Task 3: the router and reference carry the ground, the spec map and the checks
**Contract:** Needs: `plan.sh validate <plan.md>` reading `**Spec:** <path>` and per-task `**Builds:** D<n>[, D<n>]` or `**Builds:** none, <why>` | Offers: `alignmentChecksProse` (the final SKILL.md and references/deep-channel.md text, which Task 4 copies)
**Touches:** skills/sluice/SKILL.md (edit) | skills/sluice/references/deep-channel.md (edit) | tests/sluice-skill.test.ts (test)
**Builds:** D1, D2, D3, D4, D5
**Review:** prose is the whole behaviour change; nothing executable checks that the words ask for what the spec says
- [ ] Add tests to `tests/sluice-skill.test.ts` in its existing style (`section()` over headings, sentence finds), each named for the behaviour it pins: the router's Deep channel names the ground before the trace; `## The ground` exists in the reference before `## The trace` and names prior designs, the code beside the path and stated constraints, a read-only dispatch, and `## Context` as where the findings land; the reference carries a spec skeleton fenced block with `## Intent`, `## Context`, `## Decisions`, `### D1.`, `## Out of scope` and `## Trace` in that order; `## The alignment checks` exists, names the intent check before sign-off and the plan check after `plan.sh validate` and before pre-flight, says the checker is never downshifted, says the sign-off message reports the intent check's finding count and fixes, and says validate is re-run after plan fixes; the plan skeleton (already pinned identical in both files) carries `**Spec:**` and `**Builds:**`; the run record section names the two check outcomes among its opening rows -> each new test runs red against the current prose
- [ ] `references/deep-channel.md`, new `## The ground` before `## The trace`: the spec's D1 in the file's voice. Why it comes first (a prior spec often settles the fork; "anything you can settle from the repo" needs the repo read), the three reads with their path citations, a read-only Explore dispatch where available and the controller's own read where not, the findings going into the spec's `## Context` one line each with a path. 25 to 40 lines -> its tests green
- [ ] Same file, the spec skeleton and the intent map: in `## The design stop and plan mode` or a short paragraph directly after `## The ground`, the spec's D2 with the fenced skeleton exactly as the spec gives it, and why Out of scope is not a numbered decision. Update `## The trace`'s ordering sentence so the walk follows the ground and precedes the fork -> its tests green
- [ ] Same file, new `## The alignment checks` after `## The trace`: the spec's D3 and D5, both briefs as bullet questions, when each runs, fresh context on the session's model and effort and never downshifted, fixes for agreed findings, disputed ones as one line each in the sign-off or pre-flight message, the sign-off message saying the intent check ran with its finding count and how many were fixed, `plan.sh validate` re-run after the plan check's fixes, outcomes written into the run record's opening rows when it opens, and the no-dispatch fallback pointing at `## When dispatch is unavailable`. 30 to 50 lines -> its tests green
- [ ] Same file, `## Plan format`: add `**Spec:**` and `**Builds:**` bullets (what each says and why: validate checks coverage from them, and step prose mentioning `D1` does not count), add both lines to the fenced skeleton, and extend the `plan.sh validate` paragraph with the new errors and the warning. `## The run record`: name the two check outcomes among the rows that open the record. `## When dispatch is unavailable`: one sentence that the alignment checks fall back to the controller's own read, said at the stop -> its tests green
- [ ] `SKILL.md`, Deep channel: one short paragraph before the Trace paragraph pointing at `## The ground`, one after it pointing at `## The alignment checks` (intent check before sign-off, plan check before pre-flight), and the same two lines added to the fenced skeleton so it stays identical to the reference's. Keep the addition under 15 lines -> `bun test tests/sluice-skill.test.ts` all green, the identical-skeleton test included
- [ ] Read both files back for em dashes and for any sentence that contradicts the spec -> `grep -n "—" skills/sluice/SKILL.md skills/sluice/references/deep-channel.md` prints nothing

### Task 4: version, manifest and generated copies
**Contract:** Needs: `alignmentChecksProse` | Offers: none
**Touches:** skills/sluice/skill.json (edit) | skills/index.json (edit) | .claude-plugin/marketplace.json (edit) | skills/sluice/evals/deep-run-hunts-after-the-flip/plugins/sluice (edit) | skills/sluice/evals/main-hunts-a-checkable-claim/plugins/sluice (edit) | skills/sluice/evals/main-skips-the-hunt-without-a-claim/plugins/sluice (edit)
**Builds:** D6
- [ ] `skills/sluice/skill.json` description: add one sentence saying deep runs read the repo before designing, map the spec's intent to its decisions, and check spec against intent and plan against spec with a fresh reader, with validate enforcing decision coverage -> `jq . skills/sluice/skill.json` parses
- [ ] `bun run skill:bump sluice minor` -> sluice reads 0.28.0 in skill.json, `skills/index.json` and `.claude-plugin/marketplace.json`
- [ ] `bun run eval:plugins` -> `bun test tests/eval-plugins.test.ts` green
- [ ] Commit as `chore(sluice): 0.28.0`, staging only the Touches paths -> `git show --stat HEAD` lists only them
- [ ] `bun test` from the repo root -> totals compared against the Ground Rules baseline, with no new failures
