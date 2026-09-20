# sluice evals

Eight cases for `claude plugin eval`. Six pin the routing decision: which
channel the announcement names, and whether the behaviour that channel owes
actually happened. Two pin what a deep run does after pre-flight, where the
question is no longer which channel but whether the run keeps going.

| Case | Signal under test | What it pins |
|---|---|---|
| `bypass-question-stays-silent` | A question, no code change | Answers it, announces nothing, writes nothing |
| `fast-flag-on-existing-command` | A new flag on an existing command | Fast channel; test edited and run before the source |
| `main-new-interface` | Adds a port the repo does not have | Main channel; shape stated with a recommendation before building |
| `deep-plan-across-subsystems` | A plan asked for, three subsystems | Deep channel; design written to `docs/specs/`; stops before code |
| `explicit-instruction-collapses-to-fast` | Main-shaped work plus "just do it" | Collapses to fast; no design, no proposal |
| `superpowers-conflict-stands-down` | Repo mandates the superpowers sequence | Stands down once, names no channel |

Execution, where the run is already past both stops:

| Case | Signal under test | What it pins |
|---|---|---|
| `deep-run-finishes-every-task` | Signed-off plan, three tasks left | All three reach done in one turn; no checking in between tasks |
| `deep-run-blocks-on-a-real-decision` | Task 4 collides with a published contract | Tasks 2 and 3 land, Task 4 is marked `blocked`, the turn ends on one question |

## Running

Six cases scaffold a small Node repo and then change it, so they need the
scaffold flag and a tool grant. From the repo root:

```bash
claude plugin eval skills/sluice --scaffold --allow-tools Bash Write Edit
```

`--case` takes one glob and is not repeatable, so the two cases that need
less run one command each:

```bash
claude plugin eval skills/sluice --case 'bypass-*'
claude plugin eval skills/sluice --case 'superpowers-*' --scaffold
```

Useful while iterating on graders: `--ablation none` drops the no-plugin arm
and halves the cost, `--runs 1` drops the repeats, and `--judge-model sonnet`
settles an `llm` grader that keeps flipping.

To gate CI, pick a floor and let a miss fail the job:

```bash
claude plugin eval skills/sluice --scaffold --allow-tools Bash Write Edit \
  --trust-plugin --threshold 0.8
```

## Scoring notes

`tool_used: Skill` graders are excluded from the score in a two-arm run and
reported as pass/fail indicators, because they can never pass without the
plugin. They are there to tell you whether a score came from sluice or from
the model's own habits.

The two stops a deep run is allowed are both before Task 1: design sign-off and
plan-plus-pre-flight. `deep-plan-across-subsystems` pins the first. Everything
after pre-flight is covered by the two execution cases, which is where a run
that checks in per task would show up. Their `.sluice/run.json` fixtures were
produced by `status.sh` and `plan.sh import` rather than typed by hand, so the
tiers and the graph columns match what the plan actually says; the plans pass
`plan.sh validate` with no errors and the scaffolded suites start green.

The fixtures are deliberately small. `fixture.sh` is duplicated across the
cases that use it rather than shared, because `context.scaffold_script` reads
only from the case's own directory.

## Verification status

`bypass-question-stays-silent` and `superpowers-conflict-stands-down` have each
been run once (`--runs 1 --ablation none`) and scored 1.00, so the fixture's
`CLAUDE.md` does reach the child session. The six scaffold-and-write cases have
been checked for grader reachability under the full flag set and produce no
warnings, and their fixtures were run directly to confirm the plan validates and
the suite starts green, but no agent has been run against them end to end.
Expect to tune their `llm` rubrics on the first real pass.
