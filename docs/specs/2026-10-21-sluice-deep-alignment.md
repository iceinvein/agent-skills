# Design: sluice deep alignment (ground, intent check, plan check)

## Intent

The request, verbatim:

> i want to know what it does around repo context when creating spec
> yes and also I need something that also checks spec and intent and most likely a plan and spec alignment

The "yes" accepts the gap stated in the previous turn: sluice has no step that gathers repo context before a spec (prior specs, the code beside the change, stated constraints), only the trace's single-example walk.

Fork asked and answered: "How should the spec-vs-intent and plan-vs-spec checks run?" Answer: **Map + fresh checker**. The author writes the mapping, `plan.sh validate` enforces what is mechanical, and a fresh-context dispatch reads for gaps in meaning.

| Ask | Decision |
|---|---|
| Repo context before the spec | D1 |
| Check that the spec matches the intent | D2, D3 |
| Check that the plan matches the spec | D4, D5 |

## Context

- `skills/sluice/SKILL.md:127-150` and `references/deep-channel.md:139-222` define the design stop, the fork question and the trace. Repo context currently enters only at routing (`CLAUDE.md`/`AGENTS.md`), at file placement, through "anything you can settle from the repo is not that fork", and in the trace.
- Reviewers are dispatched by a brief written in the reference, not by an agent file (`references/review.md`). Only `agents/sluice-implementer-low.md` ships as an agent. This design follows the brief pattern and adds no agent file.
- `scripts/plan.sh validate` is a single-pass awk parser over the plan's strict skeleton (`plan.sh:59-330`). Its findings are `error` (cannot dispatch) or `warn` (a judgement call).
- `docs/specs/2026-10-20-sluice-board.md` is the newest spec. It uses `### D<n>.` decision headings, and its D5 is "Out of scope". Older magpie specs use `## <n>.` headings.
- `skills/sluice/evals/*/plugins/` are generated copies, refreshed with `bun run eval:plugins`. `tests/eval-plugins.test.ts` fails on drift.
- `tests/sluice-skill.test.ts` pins the router and reference prose by sentence. `tests/sluice-plan.test.ts` pins validate's findings.

## Decisions

### D1. The ground: a read of the repo before the trace

A new `## The ground` section in `deep-channel.md`, placed before `## The trace`, with one sentence pointing to it in SKILL.md's Deep channel paragraph. Before the walk, the controller dispatches a read-only Explore agent, or reads the repo itself where it cannot dispatch, with a brief asking for three things, each cited by path:

1. **Prior designs.** Specs and plans under the repo's spec and plan directories that touch the same subsystems or files, and what each settled that the new design must build on, supersede, or leave alone.
2. **The code beside the path.** How the nearest similar feature is built (its shape, where its state lives, how it is tested), so the design matches the repo rather than inventing a pattern.
3. **Stated constraints.** Repo instructions, CI gates, test runner and conventions, and release steps that the design or its plan will answer to.

The report goes into the spec's `## Context`, one line per finding with its path. The reason for dispatching is the same as for the reviewer: the file dumps fill the agent's context instead of the controller's.

The order becomes: ground, trace, fork question, draft. The ground comes before the fork because a prior spec often settles the fork, and "anything you can settle from the repo is not that fork" only works once the repo has been read.

### D2. The spec states its intent as a map

Every deep spec carries `## Intent`. It holds the request quoted verbatim, each question asked through `AskUserQuestion` with the answer it got, and a table mapping each ask to the `D<n>` decisions that deliver it, or to `## Out of scope` with the reason. Decisions are headed `### D<n>. <title>`. Out of scope is its own `## Out of scope` section, never a numbered decision, because a decision is something a task builds. A short spec skeleton goes into `deep-channel.md`:

```
# Design: <topic>
## Intent
## Context
## Decisions
### D1. <title>
## Out of scope
## Trace
```

### D3. The intent check, before sign-off

Once the draft and its trace are written, and before the sign-off (`ExitPlanMode`, or the prose stop), the controller dispatches a fresh-context checker with the spec's path. The brief lives in a new `## The alignment checks` section of `deep-channel.md` and asks:

- Does each ask in `## Intent` reach a decision that actually delivers it, not one that merely mentions it?
- Is any decision traceable to no ask (an addition nobody asked for)?
- Is any ask dropped, or moved to Out of scope without a reason?
- Does the design honour every answer recorded in `## Intent` and every constraint in `## Context`?

The checker runs on the session's model and effort and is never downshifted, as with the final review. The controller fixes what it agrees with. What it disputes goes into the sign-off message as one line each, so the partner signs with the disagreements in view. The sign-off message states that the check ran, how many findings it returned and how many were fixed. Without dispatch, the controller says so at the stop and runs the same questions itself, as `When dispatch is unavailable` already handles for review.

### D4. Plans cite the decisions they build, and validate checks coverage

- The plan carries `**Spec:** <path>` under its title. Each task carries `**Builds:** D1, D3`, or `**Builds:** none, <why>` for a task such as a version bump that builds no decision.
- The skeleton in SKILL.md and `deep-channel.md` gains both lines. `tests/sluice-skill.test.ts` already pins that the two skeletons are identical.
- `plan.sh validate` gains these findings:
  - **error**: no `**Spec:**` line;
  - **error**: the Spec path does not exist (resolved from the current directory, as the plan path is);
  - **error**: the spec has no `### D<n>.` headings;
  - **error**: a task Builds a `D<n>` that the spec does not have;
  - **error**: a spec decision that no task Builds;
  - **warn**: a task with no Builds line.
- The awk parser reads the spec in its END block with `getline` from the Spec path, the same one-pass shape as now. `plan.sh import` ignores the new lines.

**Amended 2026-10-21, after sign-off, by the partner's decisions** (the run record's `## After the merge` holds the reasons):
- A task with no Builds line is an **error**, not a warning; an empty Builds line, and a Builds word that is not a decision id, are errors too. `none` may close a sentence (`None.`, `none: <why>`), and so may a decision id (`D2.`).
- A relative Spec path resolves from the plan's repo root, or from the plan's own directory outside a git repo, not from the current directory.
- A Spec path that is a directory, or a file that cannot be read, gets its own error rather than "does not exist".

### D5. The plan check, before pre-flight

After `plan.sh validate` is clean and before pre-flight's questions, the controller dispatches a fresh-context checker with the spec and plan paths. Its brief, in the same `## The alignment checks` section, asks:

- Does each task citing `D<n>` actually build what `D<n>` says? Across its tasks, is each decision covered whole rather than in part?
- Does any task build something listed in Out of scope, or a shape the Trace ruled out?
- Do the Ground Rules contradict a constraint in the spec's Context?
- Does the `Flips` task turn on what the spec says turns on?

Findings the controller agrees with are fixed in the plan, and validate is re-run. Disputed ones go into the pre-flight message. The outcomes of both checks are written into the run record's opening rows next to pre-flight's answers, the count and the outcome in each. Like pre-flight, they are written when the record opens, inside the worktree. No new `run.json` fields.

### D6. Evals, docs, version

- Three new eval cases, each with a fixture, graders and a README row:
  - `deep-plan-reads-the-prior-spec`: the fixture holds an earlier spec that settled where state lives, and the obvious design contradicts it. Graders: the new spec's Context cites the earlier spec's path, and the design follows it or asks about it.
  - `deep-plan-checks-the-intent`: a request with three asks. Graders: the spec has an Intent table covering all three; an Agent dispatch naming the spec path happens before the stop; the sign-off message reports the check.
  - `deep-plan-checks-the-plan`: the prompt says the spec is signed off and asks for the plan. Graders: the plan carries Spec and Builds lines; validate is run; a dispatch naming both paths happens before the pre-flight questions.
- `rules.json` and `evals/README.md` are updated for the new cases. Existing plugin copies are regenerated with `bun run eval:plugins`.
- `skill.json` description and version: sluice 0.27.0 to 0.28.0, following the `chore(sluice): <version>` commit pattern. The repo release (`release: v0.23.9`) is left to finish.

## Out of scope

- A new agent file for the checker (the brief pattern covers it).
- New `status.sh` commands or `run.json` fields for the checks.
- Changing `main`: it writes no spec, so it has nothing to map. The `main` hunt already checks the claim in the intent.
- Re-validating or migrating existing plans and specs in `docs/`.

## Trace

1. **The example.** The request gives none, so here is one concrete case: a deep request "Plan a sluice board that lists live runs" whose answered fork is "pointers, never copies". The spec must cite related earlier specs, map that ask to decisions, and the plan must build every decision.
2. **Through the real data.**
   - `docs/plans/2026-10-20-sluice-board.md:7` names its spec only in prose ("Design: `docs/specs/...`") inside `## Goal`, so validate has nothing to parse. D4 therefore needs a `**Spec:**` line.
   - The board spec's decisions are `### D1.` to `### D5.`, but D5 is "Out of scope", which no task would Build. The coverage rule would wrongly fail it, so D2 moves Out of scope into its own section.
   - The board plan's Task 5 (docs and version) builds no decision of its own, so `**Builds:** none, <why>` has to exist.
   - The magpie specs use `## 1.` headings, which validate would read as "no decisions". This is acceptable because D4 applies only to plans validated from now on, and nothing re-validates old ones (Out of scope).
   - Nothing in the repo would have supplied the ground: the board spec's `## Context` cites no earlier sluice spec, although `2026-08-07-sluice-design.md` and `2026-08-23-sluice-cross-harness.md` both cover the same scripts.
3. **What reused paths require and write.**
   - The `plan.sh validate` parser is line-oriented and single-file. It skips fenced blocks and emits through `finding()`. Reading a second file is a `getline` loop in END, and it must also skip fences in the spec.
   - `plan.sh import` keys only on Task headings and the existing marks, so it ignores the new lines.
   - The run record opens after pre-flight in the worktree, so an outcome from a check run before pre-flight has to wait for it. D5 writes the outcomes alongside pre-flight's answers, which are already held the same way.
   - On a second pass (the spec is redrafted after the intent check), the check is re-run only if a decision changed, since the map is what it reads.
4. **What the walk ruled out.**
   - A checker agent file: the repo dispatches reviewers by brief.
   - Keying coverage on prose mentions of "D1" in steps: board Task 5's step text says "read back against the design's D1 to D4", which would count the docs task as building four decisions.
   - Recording check outcomes in the spec: the spec is signed and then frozen, and the run record is where outcomes live.
   - Running the intent check after sign-off: the partner would then sign a spec whose gaps were not yet known.

## Verification (for the implementation run)

- `bun test`: new cases in `tests/sluice-plan.test.ts` for each new validate finding (expected messages written by hand), new prose pins in `tests/sluice-skill.test.ts`, and `tests/eval-plugins.test.ts` green after regeneration.
- `bash skills/sluice/scripts/plan.sh validate` on this run's own plan, which will carry Spec and Builds lines.
- The three new eval cases run with `claude plugin eval`, with their results recorded as the existing cases' are.
