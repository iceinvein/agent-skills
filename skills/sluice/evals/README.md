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

Seven cases scaffold a small Node repo and then change it, so they need the
scaffold flag and a tool grant. From the repo root:

```bash
claude plugin eval skills/sluice --scaffold --allow-tools Bash Write Edit
```

`--case` takes one glob and is not repeatable, so the one case that needs
less runs on its own:

```bash
claude plugin eval skills/sluice --case 'bypass-*'
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

Every case has been run end to end at least once and scored 1.00. The two that
needed the least (`bypass-question-stays-silent`, `superpowers-conflict-stands-down`)
were run at `--runs 1 --ablation none`; the other six were run the same way, and
`deep-plan-across-subsystems` and `main-new-interface` twice each after the
fixes below.

Three defects the first full pass turned up, all in the suite rather than in
sluice:

- `announces-<channel>-channel` matched `<channel> channel` anywhere in the
  trace, and the trace carries SKILL.md's routing table, which names all four.
  Those graders passed whenever the skill loaded. They now anchor on the
  announcement opening an assistant message, the same anchor `run-stats.sh`
  meters by. `fast-flag-on-existing-command` and
  `explicit-instruction-collapses-to-fast` still carry the old pattern.
- `deep-plan-across-subsystems` shipped no `fixture.sh`, so the run landed in an
  empty tree and the case flipped between designing against the prompt alone and
  stopping to ask where the repo was. It has a fixture now: three callers
  through one upstream client. Its `no-implementation-yet` grader went with it,
  because `file_exists: 'src/**', exists: false` reported absent against a tree
  holding four source files.
- `shape-agreed-before-building` was an `llm` grader over the trace, and the
  judge is given a head-and-tail window of it. In a run this long the shape
  statement lands in the dropped middle, so the judge voted FAIL six times out
  of six on runs that had stated the shape plainly. `focus` accepts only
  `last_message`, `trace` or a file, and `main` agrees in a message rather than
  a file, so there was no slice to point it at. It is a regex over the
  chronological trace now, which pins the order but not whether a
  recommendation came with the shape.
