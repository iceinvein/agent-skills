# Role briefs

Each role is a separate dispatch. Pass the brief below plus only the inputs it
names; anything extra leaks the context the ordering exists to keep out. `RUN`
is the run directory, `.bug-hunter/<YYYY-MM-DD>-<slug>/` at the caller's repo
root. `SCRATCH` is the scratch worktree.

## Scenario author

**Inputs:**
- The target, as a one-line description and a list of changed files.
- Intent sources: the request or ticket text from the caller, commit messages
  on the target, specs and docs in the repo that cover the changed area,
  `CLAUDE.md`/`AGENTS.md`.
- Changed signatures and exports: function, method and type declarations,
  with their docstrings, but not their bodies. Extract them for the author
  (from the diff's hunk headers and declaration lines) rather than pointing
  the author at the files.
- Callers of the changed exports, found by search: the call sites, which show
  how the code is meant to be used.
- Existing tests that touch the changed area, which show what is already
  pinned and what nobody wrote down.
- Invariants the target states about itself: file-level and declaration
  comments that say what must hold ("stays in lockstep with X", "throws on
  input it cannot parse"). Extract them with the signatures, quoted with file
  and line, not the bodies around them.
- Sibling implementations: code the target says it mirrors or matches, or
  that the repo's docs say does the same job. Give their paths. A sibling
  that is itself part of the target is a changed body and is not given.

**Brief:**

> You write QA scenarios for a change you will not see the implementation of.
> Do not open the body of any changed function, method or file, even to check
> a detail; if a scenario needs a fact only the body holds, the scenario's
> expected result has no source, and it belongs in `scenarios.md` as an open
> question.
>
> First write `RUN/intent.md`: numbered claims, `I1`, `I2`, ... Each claim is
> one checkable statement of what the change is meant to do, with its source
> (file and line, commit SHA, or "request"). Quote the source where you can.
> Do not infer a claim from a test's expected value alone: a test records what
> the code did when it was written, which may be the bug.
>
> Collect claims from every source that speaks to the target's behaviour, not
> only the spec: invariants the code states about itself, sibling or mirrored
> implementations the target says it matches, the repo's existing tests, and
> its docs. You may open a sibling implementation's body: it is an intent
> source, not the target. Read what it does with the inputs your scenarios
> will use and state that as a claim, with the sibling's file and line as the
> source and the statement that ties the target to it (also with file and
> line). An existing test is a source when it pins behaviour on code the
> target says it matches, or on unchanged code; it is not one for the
> target's own changed behaviour. A claim must state the behaviour concretely
> enough to derive an expected value. A vague comment ("handles bad input"),
> or a sibling the target never says it matches, is not a claim; note it, and
> a scenario that rests on it is `open`.
>
> Then write `RUN/scenarios.md`: numbered scenarios, `S1`, `S2`, ... Each
> has a one-line label saying what it tests, names its catalog category
> (`references/scenario-catalog.md`), and gives the setup and action in QA
> terms, the expected result, and the claim it rests on. Where
> the claims do not settle the expected result, write the scenario anyway,
> mark it `open`, and state the question. Skip scenarios existing tests
> already pin. Prefer ten sharp scenarios to forty shallow ones; work through
> every catalog category and say which ones the target gives no purchase on.

**Outputs:** `RUN/intent.md`, `RUN/scenarios.md`.

## Executor

**Inputs:**
- `RUN/intent.md`, `RUN/scenarios.md`.
- `SCRATCH`, with full read access to the code, bodies included.

**Brief:**

> Find how this repo runs its tests: read its manifests (`package.json`,
> `Cargo.toml`, `go.mod`, `pyproject.toml`, `Makefile` and the like) and
> `CLAUDE.md`/`AGENTS.md`. Use the repo's own runner and test framework, and
> put each repro where that framework expects tests. Do not install a new test
> dependency. If the repo has no runnable test setup, stop and say so.
>
> For each scenario worth trying, write one repro in `SCRATCH` that asserts
> the scenario's expected result exactly as `scenarios.md` states it. Do not
> adjust an expected value after reading the body; if the body convinces you
> the scenario is wrong, record that against the scenario and leave the
> assertion as written. Run each repro alone with a command that runs only
> it, from the repo root.
>
> Record every scenario as `pass`, `fail` (assertion failed: give expected and
> observed), `error` (the repro did not run: say why), or `skipped` (say why).
> A failure from setup, a missing service or a compile error in the repro is
> `error`, never `fail`.

**Outputs:** per scenario, its status, the repro's file paths relative to the
repo root, the command, and for each `fail` the expected and observed values.
Repro files stay in `SCRATCH`.

## Refuter

**Inputs:**
- `RUN/intent.md`.
- For each `fail` from the executor: the scenario text, the repro files, the
  command, expected and observed. Not the executor's reasoning.
- The target commit, to build a clean worktree from.

**Brief:**

> You are trying to show each reported bug is not one. For each failing repro:
>
> 1. Create a fresh `git worktree` at the target commit (with the target's
>    uncommitted changes applied, if it has any), write in only this repro's
>    files, and run its command from the root. Remove that worktree after.
>    If it does not fail with the reported observed value, reject it: a repro
>    that fails only alongside the executor's other files proves nothing.
> 2. Find the claim the scenario cites in `intent.md` and read its source.
>    Does the expected value follow from that claim, without help from the
>    implementation or from what a reasonable product "would" want? If yes,
>    confirm. A claim from an invariant the code states, a sibling
>    implementation the target says it mirrors, an existing test or a doc
>    counts the same as a spec: if the target contradicts it, confirm, citing
>    that source by file and line. Check the tie yourself: open the cited
>    lines and confirm they say what the claim says, and for a sibling, that
>    it does behave that way on the repro's input. If the claim is silent,
>    vague, ambiguous, or contradicted by another claim, or rests on a sibling
>    the target never says it matches, demote the finding to an ambiguity and
>    write the question product has to answer.
> 3. Check the repro tests the target and not its own setup: a mocked
>    dependency returning something the real one never would, or a fixture
>    that breaks an invariant the caller guarantees, is a rejection.

**Outputs:** per failure, `confirmed`, `ambiguity` (with the question) or
`rejected` (with the reason). Confirmed repros become `bugs` entries in
`findings.json`, with the exact file contents the clean run used. Scenarios
marked `open` by the author and findings demoted here become `ambiguities`.
Scenarios that passed become `covered`.
