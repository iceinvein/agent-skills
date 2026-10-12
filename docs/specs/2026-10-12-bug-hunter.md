# bug-hunter: a skill that proves logic bugs, and the eval that earns it a gate

## Context

Agent-written code passes its own tests and still fails when QA hits a scenario
nobody wrote down. PR review reads a diff and gives an opinion. This skill runs
the code and proves a bug with a failing reproduction, checked against what the
change was *meant* to do. Scope is logic and correctness first. It triggers as a
skill for now; once the eval shows it is precise enough, it becomes a sluice
gate that runs after an agent claims a change is done (a separate design, later).


## Decisions

**Where it lives.** The skill goes in `agent-skills/skills/bug-hunter/`, next to
sluice, with `claude plugin eval` behaviour cases in its `evals/`. The
historical benchmark goes in `~/Documents/projects/bug-hunter/` (this directory,
`git init`'d). That benchmark is mined from workings and snowvault, so it stays
out of the published package.

**No repro, no finding.** A bug is reported only with a reproduction that fails
and states which intent claim it violates. Anything else is either an ambiguity
or nothing.

**Intent before implementation, enforced by dispatch rather than discipline.**
An agent that reads the code first takes its expected values from the code and
confirms the bug as a feature. The skill orchestrates three roles:

| Role | Sees | Produces |
|---|---|---|
| Scenario author | Intent sources (request, commit message, specs, docs), changed signatures and exports, callers, existing tests. **No function bodies.** | `intent.md` (claims, each with its source) and `scenarios.md` (QA-style scenarios, each with an expected result tied to a claim) |
| Executor | Everything, in a scratch git worktree | One runnable repro per scenario worth trying; records pass or fail |
| Refuter | Each failing repro, plus `intent.md` | Confirms (the repro fails in a clean run and the expected value really follows from the intent), demotes it to an ambiguity, or rejects it |

Without dispatch, one agent runs the roles in sequence and writes `scenarios.md`
before opening any changed body. A behaviour eval pins that order.

**Language-agnostic.** The executor works out how to run tests from the repo's
manifests and `CLAUDE.md`/`AGENTS.md`, then writes repros in the repo's own
test framework. The skill ships no per-language scripts.

**The skill never touches the caller's tree.** All hunting happens in a
worktree. Output goes to `.bug-hunter/<date>-<slug>/`:
- `report.md`: three buckets, **bugs** (repro path, run command, violated
  claim), **ambiguities** (questions for product), **covered** (scenarios that
  passed).
- `findings.json`: the same content, for the grader and, later, for sluice.

Promoting a repro into the tree as a regression test is the caller's job. In
the future gate, that is sluice handing it to the implementer.

**The scenario catalog is a reference file, not prose in SKILL.md.**
`references/scenario-catalog.md` lists the categories where QA finds bugs:
- boundaries
- sequence and state (repeat, double submit, retry after partial failure, order)
- combinations of flags, options and roles
- time (timezone, DST, month end, midnight)
- data shape (null vs missing vs empty, duplicates, ordering, unicode, size)
- arithmetic (rounding, money, units, integer division)
- partial failure
- environment (stale cache, config, feature flags)

## The historical benchmark (bug-hunter dir)

**Mine.** Collect `fix(...)` commits that change both source and tests and have
a message body. That is 510 in workings and 130 in snowvault. Drop ci, deps,
docs and infra scopes.

**Classify.** A `claude -p` pass reads each commit message and diff stat and
labels it `logic` / `cosmetic` / `infra`, with a one-line wrong-vs-right
summary. Only `logic` cases are kept. The commit message is the answer key.

**Two case kinds, chosen by blame on the lines the fix changed:**
- **Fresh** (introducing commit at most ~20 commits before the fix): the hunt
  runs at the introducing commit, scoped to that commit's diff, with its
  message as intent. This replays the future gate exactly.
- **Latent** (older): the hunt runs at the commit before the fix, scoped to the
  *package or directory* of the touched files rather than the exact files, with
  repo docs and specs as intent. This is the QA-found shape. Recall here reads
  optimistically, because the scope still narrows the search, and the report
  says so.

**No leakage.** Each workspace is a single-branch clone that ends at the hunt
commit, so no future commits exist in its object store. The fix message and
ticket are never given to the hunter. The hunter runs headless (`claude -p`)
sandboxed to the workspace, and any run whose trace reads outside the
workspace is invalidated.

**Grading is behavioural first.** A case is *found* if a confirmed repro
**fails at the commit before the fix and passes at the fix**. The grader
applies the repro to both commits and runs the repro command it recorded. If
the repro no longer applies (API drift), an LLM judge matches the finding
against the fix message, and the result is labelled `judged`, not `proven`.

**Precision.** Confirmed findings that don't match the case's bug go to a
triage file (`real` / `not-a-bug` / `ambiguity-mislabelled`), filled in by you.
The precision number comes from that file.

**Baseline arm.** The same model, workspace and scope with the prompt "find
bugs in this change and prove them with failing tests", without the skill. The
skill has to beat this, otherwise it adds nothing.

**Report per run:** recall (proven / judged), precision (triaged), ambiguity
count, and cost and time per case, each against the baseline.

**Pilot first:** 20 logic cases, 10 per repo, mixing TS, Rust and Go, fresh and
latent, preferring unit-tier tests. Snowvault database-tier cases run serially
because the worktrees share one database (its `CLAUDE.md`). Scale up only once
the pilot's numbers are believable.

**Tooling.** Bun + TypeScript (matching agent-skills), shelling out to `git`
and `claude -p`. No new dependencies.

## Behaviour evals (`skills/bug-hunter/evals`, `claude plugin eval`)

Small scaffolded fixtures in the style of the sluice cases. Each pins one
behaviour:
1. A spec'd boundary bug → reported with a failing repro tied to the spec claim.
2. Spec silent on a case → reported as an ambiguity, not a bug.
3. Correct code → no bug findings.
4. The caller's tree is unchanged after the run.
5. `scenarios.md` exists before any changed function body is read (trace order).

## Out of scope (named so nothing reads as done)

- The sluice gate itself: its own design once pilot precision clears a bar you
  set.
- Fetching ticket text (Linear): v1 uses repo-local intent only, because later
  ticket comments would leak the bug.
- Automatic precision from later history ("did a later commit fix this
  finding?"): v2.

## Proposed order (the plan will be written after sign-off)

1. Benchmark miner, classifier, case builder → pilot case set (shippable on its own).
2. Skill v0 plus behaviour evals.
3. Runner and grader, with the baseline arm → first pilot numbers.

## Verification

- Behaviour evals: `claude plugin eval skills/bug-hunter --scaffold --allow-tools Bash Write Edit --model claude-opus-5-5 --judge-model claude-opus-5-5`.
- Grader self-check: on each pilot case, the fix commit's own added test must
  grade as *found* (fails before, passes after). This proves the grading
  wiring before any hunter runs.
- Leak check: in each workspace, `git log --all` shows no commit after the
  hunt commit.
- Pilot run of both arms over 20 cases, with the report table produced from
  the run's own output.
