# sluice evals

Fourteen cases for `claude plugin eval`. Eight pin the routing decision: which
channel the run names, and whether the behaviour that channel owes actually
happened. Six pin what a deep run does after pre-flight, where the question is
no longer which channel but whether the run keeps going.

| Case | Signal under test | What it pins |
|---|---|---|
| `bypass-question-stays-silent` | A question, no code change | Answers it, announces nothing, writes nothing |
| `fast-flag-on-existing-command` | A new flag on an existing command | Fast channel; test edited and run before the source |
| `main-new-interface` | Adds a port the repo does not have | Main channel; shape stated with a recommendation before building |
| `deep-plan-across-subsystems` | A plan asked for, three subsystems | Deep channel; design written to `docs/specs/`; stops before code |
| `explicit-instruction-collapses-to-fast` | Main-shaped work plus "just do it" | Collapses to fast; no design, no proposal |
| `superpowers-conflict-stands-down` | Repo mandates the superpowers sequence | Stands down once, names no channel |
| `announcement-reaches-the-ledger` | A flag that a repo rule turns into a new export | `status.sh route fast`, then `status.sh route main` once the rule is read |
| `fast-reads-the-unmentioned-convention` | Flags live in a table the prompt never names | The flag lands in the registry table and the generated `--help` |

Execution, where the run is already past both stops:

| Case | Signal under test | What it pins |
|---|---|---|
| `deep-run-finishes-every-task` | Signed-off plan, three tasks left | All three reach done in one turn; no checking in between tasks |
| `deep-run-blocks-on-a-real-decision` | Task 4 collides with a published contract | Tasks 2 and 3 land, Task 4 is marked `blocked`, the turn ends on one question |
| `deep-run-survives-a-milestone` | Six tasks, the first three named a milestone | All six done; the Stop hook never had to refuse; the final message is a handback |
| `deep-run-decides-a-non-blocking-choice` | A task leaves a choice open and says either is fine | Decided, written into the record, no task blocked, no decision list at the end |
| `deep-run-waits-for-a-running-agent` | Every task goes to an implementer agent | A `T2:` labelled dispatch; the handback comes after the last result |
| `deep-run-fans-out` | Three disjoint tasks under a worktree-per-implementer answer | Three dispatches in one message, then the flip; also the baseline for a time-budget A/B |

## Running

Thirteen cases scaffold a small Node repo and then change it, so they need the
scaffold flag and a tool grant. Pin the model, because the eval child does not
inherit it. From the repo root:

```bash
claude plugin eval skills/sluice --scaffold --allow-tools Bash Write Edit \
  --model claude-opus-5-5
```

`--case` takes one glob and is not repeatable, so the one case that needs
less runs on its own:

```bash
claude plugin eval skills/sluice --case 'bypass-*'
```

Useful while iterating on graders: `--ablation none` drops the no-plugin arm
and halves the cost, `--runs 1` drops the repeats, and `--judge-model sonnet`
settles an `llm` grader that keeps flipping. Traces are deleted when a run
ends, so a failing `llm` grader cannot be read back afterwards; add
`--keep-temp` to any run whose failures you will need to diagnose.

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

The `announces-<channel>-channel` graders accept either of two anchors: a Bash
call running `status.sh route <channel>`, or the words `<channel> channel`
opening an assistant text block. The route call is there because Opus 5.5 can
return prose written between tool calls as a paraphrased thinking summary,
which leaves the literal announcement nowhere in the trace; a tool input is kept
as written. Either anchor excludes SKILL.md's own routing table, which the trace
also carries.

The fixtures are deliberately small. `fixture.sh` is duplicated across the
cases that use it rather than shared, because `context.scaffold_script` reads
only from the case's own directory.

## Verification status

### Opus 5.5, 2026-09-23

CLI 2.1.280, `--model claude-opus-5-5`, one run per case, no no-plugin arm, so
every score below is a single sample rather than a mean. Three passes: the
whole suite (USD 8.65), then the failing deep cases (USD 6.44) and
`explicit-instruction-collapses-to-fast` (USD 0.30) again with `--keep-temp`.
Results are under `results/2026-09-23T04-43-43-222Z`, `...T04-54-55-819Z` and
`...T04-54-57-642Z`.

| Case | Pass 1 | Rerun | Reading |
|---|---|---|---|
| `bypass-question-stays-silent` | 1.00 | | |
| `fast-flag-on-existing-command` | 1.00 | | |
| `main-new-interface` | 1.00 | | |
| `deep-plan-across-subsystems` | 1.00 | | |
| `explicit-instruction-collapses-to-fast` | 0.75 | 1.00 | Pass 1 ended on a merge/PR question and the judge failed it 3/3; the rerun ended without one and passed |
| `superpowers-conflict-stands-down` | 1.00 | | |
| `announcement-reaches-the-ledger` | 1.00 | | Routed fast, then re-routed to main with a second route call |
| `fast-reads-the-unmentioned-convention` | 1.00 | | |
| `deep-run-finishes-every-task` | 0.73 | 0.73 | Every task built, suite green, nothing committed; judge failure likely git, finish question not ruled out (below) |
| `deep-run-blocks-on-a-real-decision` | 0.75 | 0.50 | Stopped before Task 2; the fixture has a second contract break the case does not account for (below) |
| `deep-run-survives-a-milestone` | 0.67 | 0.67 | All six tasks built past the milestone, nothing committed; same reading as finishes-every-task |
| `deep-run-decides-a-non-blocking-choice` | 0.82 | 1.00 | Pass 1 did not write the choice into the record; the rerun did |
| `deep-run-waits-for-a-running-agent` | 0.13 | 0.63 | Pass 1 never dispatched; the rerun dispatched, waited and committed, and its judge was shown a trace with every dispatch and result elided (below) |
| `deep-run-fans-out` | 0.13 | 0.13 | Paused before Task 1 because no worktree could be cut without git |

**Git does not run inside the eval sandbox on this machine.** `/usr/bin/git` is
Apple's xcrun shim, and inside the sandbox it can neither read
`/Library/Developer/CommandLineTools` nor write its cache under
`/var/folders`, so every call fails; the Xcode copy under `/Applications` was
reachable in one run by exporting its path. Nothing documented lets a case or a
flag reach it. The deep execution cases commit per task and cut worktrees, so on
this machine `deep-run-fans-out` stops, correctly, before it starts, and every
other deep execution case either builds without committing or has to find its
own git. Those scores measure the sandbox as much as sluice and should not be
read as a 5.5 baseline for execution.

**Three suite defects the traces show, none fixed yet.**

- `deep-run-blocks-on-a-real-decision` has a second break its graders do not
  know about. Its `API.md` publishes `deploy` from `src/cli/index.js` as
  importable downstream, and Task 3's Contract makes `sink` a required second
  parameter, so Task 3 breaks the published signature too. Both 5.5 runs named
  that break; pass 1 also caught that Task 2's plan text contradicts the
  existing dry-run test. Stopping before Task 3 therefore has a real basis, and
  only leaving Task 2 unbuilt is a clean miss; pass 1 also made resuming
  conditional on git. The case needs `sink` to default to a printing sink, or
  `deploy` out of `API.md`, before its score can say anything about 5.5. The
  2026-09-20 pass scored it 1.00, which may only mean that model did not notice
  the Task 3 break.
- The handback judges in `deep-run-finishes-every-task`,
  `deep-run-survives-a-milestone` and `deep-run-waits-for-a-running-agent` FAIL
  a final message that "asks whether to proceed". All three runs ended on the
  merge, PR or leave-it choice that `references/finish.md` requires, and the
  waits run failed its judge with every commit in place. The judges give no
  reason beyond their votes, so a judge reading the required finish question
  as a check-in is not ruled out. The grader prompts should say that question
  is part of a handback.
- The `deep-run-waits-for-a-running-agent` judge (`focus: trace`) received
  100 KB of a 448 KB trace with the middle elided, and what it was shown holds
  no dispatch and no agent result, so it could not check the order it is asked
  about. This is the head-and-tail window failure described for
  `shape-agreed-before-building` below; the order wants a `tool_order` or regex
  grader instead.

**No time-budget baseline.** `deep-run-fans-out` never reached a dispatch, so
the A/B the design proposed (the brief with and without a sentence saying time
matters) has no baseline yet.

### Opus 5, 2026-09-20

Every case has been run end to end at least once and scored 1.00. The two that
needed the least (`bypass-question-stays-silent`, `superpowers-conflict-stands-down`)
were run at `--runs 1 --ablation none`; the other six were run the same way, and
`deep-plan-across-subsystems` and `main-new-interface` twice each after the
fixes below. That was the eight-case suite. The result directories from that
day that record a model name `claude-opus-5`; the two committed here do not
record one.

Three defects the first full pass turned up, all in the suite rather than in
sluice:

- `announces-<channel>-channel` matched `<channel> channel` anywhere in the
  trace, and the trace carries SKILL.md's routing table, which names all four.
  Those graders passed whenever the skill loaded. They now anchor on the
  announcement opening an assistant message, the same anchor `run-stats.sh`
  meters by. The two fast cases were brought onto the same anchor on
  2026-09-23.
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
