# Run record: sluice on four harnesses

Plan: `docs/plans/2026-08-23-sluice-cross-harness.md`
Design: `docs/specs/2026-08-23-sluice-cross-harness.md`
Base: `c5171c1`
Task status, bases and commits live in `.sluice/run.json`, not here. Read it with
`status.sh show`. This file carries the reasons and the findings that belong to a
task other than the one that surfaced them.

## Pre-flight

Settled before Task 1's first edit. The answers are in `run.json`; these are the
reasons they went that way.

**Review: tier 3 only, three of nine dispatched.** Nine of nine tasks qualify
under the tier table, because every task in this plan edits existing files or
ships prose, so there is no tier-0 row to be had. That is a property of the work
rather than a sign the tasks are interleaved, and reviewing all nine would roughly
double the plan. The three chosen are where being wrong is expensive: Task 1
because Tasks 2 and 3 are built blind against its signature and a wrong contract
propagates to both, Task 8 because it carries the flip, and Task 9 because the
meter's exit paths are what every handback depends on. The remaining six get a
`git show --stat` read against their Contract and Touches, which confirms the
offer landed and nothing outside the declared paths moved, and confirms nothing
about quality. Those six are review outstanding, and will be named as such at the
integration event rather than quietly.

**Model: two of nine on the cheaper model.** Tasks 2 and 3 only. Both are one
guarded `writeBundle` call against Task 1's exact signature, with an existing
adapter test file to pattern-match, and nothing in either turns on judgement.
Ratified rather than freshly judged: the plan marked them when their Contract and
Touches were written. Tasks 1, 8 and 9 are tier 3 and disqualified from a
downshift. Tasks 4, 5 and 6 were offered for downshift and declined, so they stay
on this session's model; they are bash and jq against tests written first, which
is close to mechanical, but they are edits to the skill's own tooling and a
misread there is expensive to find later.

**Workspace: one worktree per concurrent implementer, agents commit their own
tasks.** The graph has real parallelism to spend it on: once Task 1 lands, Tasks
2, 3, 4 and 6 have disjoint Touches and can run at once, four wide. Known
friction accepted with the answer: this repo gitignores `node_modules`, so each
fresh worktree needs its own `bun install` before `bun test` runs, and each
concurrent implementer pays that once. The flip runs alone regardless of this
answer.

## Findings deferred to another task

None yet.

## Notes

- Nothing is committed on `master` for this run except the plan, the design and
  this record, which belong to me rather than to any task and appear in no task's
  Touches.
