# sluice evals

Fifteen cases for `claude plugin eval`. Nine pin the routing decision: which
channel the run names, and whether the behaviour that channel owes actually
happened. Six pin what a deep run does after pre-flight, where the question is
no longer which channel but whether the run keeps going.

| Case | Signal under test | What it pins |
|---|---|---|
| `bypass-question-stays-silent` | A question, no code change | Answers it, announces nothing, writes nothing |
| `fast-flag-on-existing-command` | A new flag on an existing command | Fast channel; test edited and run before the source |
| `main-new-interface` | Adds a port the repo does not have | Main channel; shape stated with a recommendation before building |
| `deep-plan-across-subsystems` | A plan asked for, three subsystems | Deep channel; design written to `docs/specs/`; stops before code |
| `deep-plan-asks-the-fork` | The same plan with nothing saying where the counters can live | One question with a recommendation before any design; no spec yet |
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

Fourteen cases scaffold a small Node repo and then change it, so they need the
scaffold flag and a tool grant. Pin the model, because the eval child does not
inherit it, and pin the judge, because `--model` does not reach it and the
`llm` graders otherwise run on Haiku. From the repo root:

```bash
claude plugin eval skills/sluice --scaffold --allow-tools Bash Write Edit \
  --model claude-opus-5-5 --judge-model claude-opus-5-5
```

`--case` takes one glob and is not repeatable, so the one case that needs
less runs on its own:

```bash
claude plugin eval skills/sluice --case 'bypass-*'
```

Useful while iterating on graders: `--ablation none` drops the no-plugin arm
and halves the cost, and `--runs 1` drops the repeats. Traces are deleted when a run
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
every score below is a single sample rather than a mean. Every `llm` verdict in
this section came from the default Haiku judge except the last decides run,
which was judged by Opus 5.5.

- **Pass 1:** the whole suite (USD 8.65, `results/2026-09-23T04-43-43-222Z`).
- **Rerun:** the deep cases (USD 6.44, `...T04-54-55-819Z`) and
  `explicit-instruction-collapses-to-fast` (USD 0.30, `...T04-54-57-642Z`)
  again with `--keep-temp`, same suite.
- **Pass 2:** the deep cases after the fixture and grader fixes below
  (USD 10.55, `...T06-24-47-981Z`). Homebrew git was installed by then, but two
  of the six runs did not use it (below).

| Case | Pass 1 | Rerun | Pass 2 | Reading |
|---|---|---|---|---|
| `bypass-question-stays-silent` | 1.00 | | | |
| `fast-flag-on-existing-command` | 1.00 | | | |
| `main-new-interface` | 1.00 | | | |
| `deep-plan-across-subsystems` | 1.00 | | | |
| `explicit-instruction-collapses-to-fast` | 0.75 | 1.00 | | Pass 1 ended on a merge/PR question and the judge failed it 3/3; the rerun ended without one and passed |
| `superpowers-conflict-stands-down` | 1.00 | | | |
| `announcement-reaches-the-ledger` | 1.00 | | | Routed fast, then re-routed to main with a second route call |
| `fast-reads-the-unmentioned-convention` | 1.00 | | | |
| `deep-run-finishes-every-task` | 0.73 | 0.73 | 1.00 | Pass 2 committed every remaining task (Task 1 lands in the fixture) |
| `deep-run-blocks-on-a-real-decision` | 0.75 | 0.50 | 1.00 | Pass 2 landed Tasks 2 and 3 and blocked Task 4 on the contract |
| `deep-run-survives-a-milestone` | 0.67 | 0.67 | 1.00 | Pass 2 carried all six tasks past the milestone and committed them |
| `deep-run-decides-a-non-blocking-choice` | 0.82 | 1.00 | 0.73 | Pass 2 decided the prefix and finished, then listed two findings outside the plan as "Decisions for you"; the judge split 2 to 1 (below) |
| `deep-run-waits-for-a-running-agent` | 0.13 | 0.63 | 0.63 | Pass 2 waited on every agent and handed back after the last; the judge failed it 3/3, most likely on its **Still open** section (below) |
| `deep-run-fans-out` | 0.13 | 0.13 | 1.00 | Pass 2 ran Tasks 1 to 3 at once in worktrees it cut by hand (the harness refused isolation), then the flip |

Pass 1 and the rerun measure the sandbox as much as sluice, for the git reason
below. Pass 2 is the first read where every deep case had working git.

**Git inside the eval sandbox.** A bare `git` resolves to `/usr/bin/git`,
Apple's xcrun shim, which fails there because it cannot write its cache under
`/var/folders`. The real binaries run when called by full path: the sandbox
refuses listing `/Library/Developer/CommandLineTools`, but
`/Library/Developer/CommandLineTools/usr/bin/git` executes and commits, and so
does Homebrew's `/opt/homebrew/bin/git`. The child's Bash tool resolves a bare
`git` to the shim even with `/opt/homebrew/bin` first on PATH, under zsh and
bash alike, while `/usr/bin/env git` finds Homebrew's. In pass 2, four runs
(decides, fans-out, survives, waits) used Homebrew's git; blocks called the
Command Line Tools git by full path, and finishes put a wrapper for it on its
own PATH. The rerun's fans-out saw the listing refusal and stopped, so "no git"
in the earlier passes was partly a misreading of that refusal. Every pass-2
commit is the agent working around the harness, so a deep score on this
machine still depends on it; a Linux runner, where `git` is an ordinary binary,
gives the clean read.

**Fixed between the rerun and pass 2.**

- `deep-run-blocks-on-a-real-decision` carried a second contract break: Task
  3's Contract made `sink` a required parameter of the published `deploy`.
  `sink` now defaults to a printing sink, so Task 4 is the only collision, and
  every deep fixture's Task 2 now says the existing dry-run test gains the new
  key set to false rather than claiming it still passes.
- The three handback judges now say that ending on the finish choice
  (`references/finish.md`) is part of a handback, and the waits judge reads the
  last message rather than an elided trace; the order it used to judge is held
  by `every-task-done`.
- The Stop hook lets a turn end while a task is `active` or `review`, so a run
  waiting on its agents is no longer refused. No pass-2 trace carries the
  hook's refusal text.

**Open.**

- `deep-run-waits-for-a-running-agent`: the run did what the case pins and said
  "the suite passes 12/12", and none of the grader's FAIL clauses happened. The
  likeliest cause is its **Still open** section, led by "`npm test` hasn't
  passed yet" (inside the sandbox `npm test` exits 255 while `node --test`
  passes) and four more open items, which a judge can read as outstanding work.
  finishes and survives gave a milder `npm test` note against the same "suite
  as green" wording and passed 3/3. One sample; the grader or the fixture's
  `test` script may need to account for the sandbox.
- `deep-run-decides-a-non-blocking-choice`: its final message listed two
  findings outside the plan as "Decisions for you", which matches the grader's
  FAIL clause for any list of decisions, not the choice the case is about.
  Whether a handback may raise those is a grader policy question. This grader
  also did not get the finish-choice sentence the other three did, and the
  message ends on the finish options.

**Pass 3, after the grader fixes and the widened route marker.** The seven
cases whose graders changed since their last run, once each (USD 4.90 in all,
`results/2026-09-23T13-30-16-*`, one directory per case):

| Case | Pass 3 | Reading |
|---|---|---|
| `announcement-reaches-the-ledger` | 1.00 | |
| `fast-flag-on-existing-command` | 1.00 | |
| `explicit-instruction-collapses-to-fast` | 1.00 | |
| `main-new-interface` | 1.00 | |
| `deep-plan-across-subsystems` | 1.00 | |
| `deep-run-waits-for-a-running-agent` | 1.00 | Handback judge passes on the last message |
| `deep-run-decides-a-non-blocking-choice` | 0.82 | Handback judge passes; `record-names-the-prefix` fails (below) |

`deep-run-decides-a-non-blocking-choice` misses on the run record in two of
its four runs so far. In pass 3 the controller copied the open choice into
Task 1's brief ("The prefix is `->` or `>>`. Either is acceptable ..."), let
the implementer pick, and never wrote which one it chose. That is a gap in the
skill rather than the grader: nothing in `references/deep-channel.md` tells the
controller to settle a choice the plan leaves open before dispatch and log it
in the run record.

The dispatch brief section now says exactly that. Rerun once afterwards (USD
1.34, `results/2026-09-23T15-00-42-301Z`):
the brief read "The prefix is `->` (decided)" and `record-names-the-prefix`
passed. The handback judge split FAIL PASS FAIL on a message that reported
everything done and green, then raised dry-run behaviour the spec does not
cover as "Needs your decision" and offered a test fix before finishing. The
grader now allows out-of-plan findings, so this is the borderline between a
finding and a question put to the user; one sample does not settle it.

Rerun with `--judge-model claude-opus-5-5` (USD 1.85, judging USD 0.024 against
about USD 0.003 for Haiku, `results/2026-09-23T15-12-03-033Z`): 1.00, the handback judge
PASS PASS PASS on a message of the same shape (everything done and green, then
one "Decision for you" on the same uncovered dry-run behaviour). A fresh agent
run, not a re-judge of the old message, but the pattern that split Haiku did
not split Opus. The split verdicts above are as likely the judge as the run.

**Full pass, Opus 5.5 judge.** All fourteen cases once each with
`--judge-model claude-opus-5-5` (USD 11.50, 591s at `-j 4`,
`results/2026-09-23T15-29-36-693Z`). The current baseline; ten at 1.00:

| Case | Score | Reading |
|---|---|---|
| `bypass-question-stays-silent` | 1.00 | |
| `fast-flag-on-existing-command` | 1.00 | |
| `explicit-instruction-collapses-to-fast` | 1.00 | |
| `announcement-reaches-the-ledger` | 1.00 | |
| `fast-reads-the-unmentioned-convention` | 1.00 | |
| `deep-run-finishes-every-task` | 1.00 | |
| `deep-run-blocks-on-a-real-decision` | 1.00 | |
| `deep-run-survives-a-milestone` | 1.00 | |
| `deep-run-decides-a-non-blocking-choice` | 1.00 | |
| `deep-run-waits-for-a-running-agent` | 1.00 | |
| `main-new-interface` | 0.71 | The shape was stated mid-turn and landed as a thinking summary, which the text-anchored grader cannot see (below) |
| `deep-plan-across-subsystems` | 0.75 | Asked one design question (where the shared counters live) before writing any design, so `docs/specs/` was empty at the stop |
| `superpowers-conflict-stands-down` | 0.50 | Announced "Fast channel" and ran `route fast` before reading `CLAUDE.md`, then retracted and stood down; the retraction names the channel |
| `deep-run-fans-out` | 0.63 | Sent Tasks 1 to 3 in one message with worktree isolation, which the harness refused; hand-cut worktrees failed on the nested-git shim, so it fell back to serial and the judge failed what ran |

What each says:

- `main-new-interface` is the thinking-summary problem the route call was
  built for, surfacing in a grader that still reads only `"text"`: the
  summary did name `build()`, `upload()` and `activate()`. Either the grader
  also reads `"thinking"`, or the skill has main state the shape in the
  announcing message, the one that opens the turn and stays text.
- `deep-plan-across-subsystems` sits between two rules: intent is agreed one
  question at a time, and a design stop writes the design down first. The
  question was a real fork (network store or local file). Which rule wins at
  the design stop is a skill decision, not a grader one.
- `superpowers-conflict-stands-down` is 5.5 getting to work quickly: it routed
  before it had read the repo's instructions. The skill's Conflicts section
  says to stand down in the same breath as naming a channel; it does not say
  to read the repo's own instructions before routing. In a normal session
  Claude Code loads the project `CLAUDE.md` up front, so this may be sharper in
  the eval child than in real use.
- `deep-run-fans-out` is the sandbox, as in the rerun.

**After the three fixes.** SKILL.md now has the router read the repo's own
instructions before naming a channel; `deep-channel.md` has a fork only the
partner can settle asked first, as one question with a recommendation; the main
shape grader reads narration thinking blocks as well as text; and the
deep-plan fixture's README states where the processes run and what they share,
so that case has no such fork. A new case, `deep-plan-asks-the-fork`, keeps the
old README and pins the question. Once each, Opus 5.5 judge (USD 0.98 in all,
`results/2026-09-24T*`):

| Case | Score | Reading |
|---|---|---|
| `superpowers-conflict-stands-down` | 1.00 | Read `CLAUDE.md` before writing anything and stood down without naming a channel |
| `main-new-interface` | 1.00 | |
| `deep-plan-across-subsystems` | 1.00 | Wrote the design with the deployment given |
| `deep-plan-asks-the-fork` | 1.00 | Asked where the counters live, recommended Redis, wrote no design |

**Time-budget baseline, weak.** `deep-run-fans-out` pass 2 took 487s at USD
2.73. The concurrent phase (Tasks 1 to 3) took about 30s; about 70s went to
cutting worktrees by hand after the harness refused isolation, and most of the
rest is the serial flip, two review rounds and the final review. It is a
baseline for the whole run, not a clean fan-out measurement.

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
