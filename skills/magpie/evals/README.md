# magpie evals

Six cases for `claude plugin eval`. Every one starts mid-pipeline, because the
decisions this skill owns are the ones between the CLI calls: `scripts/__tests__/`
already pins what `magpie setup`, `dedupe`, `shard`, `post` and `status` compute.
What no unit test can reach is whether the agent stops where the walkthrough says
stop, falls back where it says fall back, and keeps its hands off the things it
must not touch.

| Case | Signal under test | What it pins |
|---|---|---|
| `shard-gate-stops-and-asks` | A resume at stage 4 with seven shards | Stops before dispatching, names 7 shards and 35 subagents, offers all three options |
| `codex-missing-falls-back` | No codex on the machine at stage 7 | Claude path with the independence preamble, `provider: claude`, never `status: error` |
| `report-ends-the-turn` | Stage 8 reached | Renders, logs the stage done, hands back for selection, posts nothing |
| `post-folds-selection-events` | The user typed `post` after re-ticking | Folds `state/events` last-event-wins, posts `bugs-1,perf-1` only |
| `consent-required-never-approves` | The code-intel probe wants consent | Never runs `index approve`, prints the unavailable notice, closes the stage |
| `resume-finds-active-run` | A fresh review ask on a PR with a live run | Checks `--list-runs` first, never calls `setup`, surfaces the interrupted run |

## Running

Every case scaffolds a run directory and then writes into it, so they all need
the scaffold flag and a tool grant. From the repo root:

```bash
claude plugin eval skills/magpie --scaffold --allow-tools Bash Write Edit
```

`--runs 1 --ablation none` is the cheap iteration loop; `-j 3` runs three cases
at once. Most of the cost sits in `codex-missing-falls-back` and
`consent-required-never-approves`, which each dispatch a real subagent.

Pass `--model` to run the cases on a specific model, which is the point of the
suite when a new one lands:

```bash
claude plugin eval skills/magpie --scaffold --allow-tools Bash Write Edit \
  --model claude-opus-5-5
```

A full single-run pass costs about $1.90 and takes five minutes on Claude Opus
5.5, against about $3.60 and eight minutes on Claude Opus 5. `--judge-model`
is separate and defaults to haiku; leave it alone when comparing models, or the
judge moves at the same time as the thing being judged.

To gate CI, pick a floor and let a miss fail the job:

```bash
claude plugin eval skills/magpie --scaffold --allow-tools Bash Write Edit \
  --trust-plugin --threshold 0.8
```

## How the fixtures fake the pipeline

The eval child runs in a sandbox that refuses to execute anything outside it, so
the real `magpie`, `gh`, `codex` and `code-intel` are all unreachable: a bare
`magpie setup` there dies with `Operation not permitted`, not with a diff. Each
`fixture.sh` therefore writes its own fakes into `$HOME/shims` and puts that
directory first on `PATH` via `$HOME/.zshenv`, which is the one startup file the
child's Bash tool reads. The same `PATH` drops every real binary directory, so
`codex` is genuinely absent in the fallback case rather than merely unused, and
nothing in a case can reach the network or a real PR.

Three things follow from the sandbox, and cases are written around them:

- **No listening sockets.** `magpie serve` writes the `server-info` the
  walkthrough reads and exits; the page behind that URL is never reachable. No
  case pins anything that needs the browser surface.
- **Run directories live under the workspace**, at `runs/<run id>`, not under
  `~/.magpie`. File graders refuse to follow a link out of the workspace, and
  `magpie --list-runs` is what names the path a resume uses anyway, so the fake
  reports the workspace path.
- **Fakes compute rather than answer.** `magpie status` reads `log.jsonl` with
  the same stage ladder as `scripts/status-cmd.ts`, so a stage the agent logs
  moves `next` exactly as the real CLI would. A canned answer went stale the
  moment the agent appended to the log, and the agent noticed and spent a
  paragraph on it.

Each fake also appends its argv to `.magpie-calls.log` in the workspace. That
file is what most of the graders read: "posted exactly these ids", "never ran
`index approve`", "never called `setup`" are all claims about what the run
invoked, and the call log answers them without depending on how the reply is
worded.

`fixture.sh` is duplicated across the cases rather than shared, because
`context.scaffold_script` reads only from the case's own directory.

## Grader notes

`tool_used: Skill` graders are excluded from the score in a two-arm run and
reported as pass/fail indicators, because they can never pass without the
plugin. They are there to tell you whether a score came from magpie or from the
model's own habits.

**Every `llm` grader carries `focus: last_message`.** Without it the judge is
handed a window of the whole trace, and in a case that reads a 40,000-line diff
the handback falls outside that window: the shard-gate rubric voted FAIL nine
times out of nine on replies that laid the gate out correctly. That flap is what
a missing `focus` looks like, not a rubric that needs loosening.

`file_exists` with `exists: true` asks whether the *run* created a file, not
whether one is there: a fixture file fails it. Assertions about fixture content
use a `regex` grader with a file target instead, and every case carries one such
grader over a file the fixture wrote, so a fixture that failed to scaffold shows
up as a failure rather than as a vacuous pass on the `exists: false` graders.

Graders will not follow a link out of the workspace, which is why the run
directories are where they are.

## What the first passes turned up

Five of the six defects the early runs surfaced were in the fixtures, and the
agent found them by reading the state it was handed:

- `findings.deduped.json` was `[]` while `findings.kept.json` held three
  findings. The run stopped and refused to peer-review them, correctly: the
  critic keeps a subset of the deduped set, so that state cannot happen. The
  findings chain is generated from one list now, per focus, deduped and kept
  together.
- The shard manifest advertised 5,400 lines a shard over 212-byte patch stubs.
  The manifest is derived from the patches the fixture writes now, and they are
  sized so a seven-way split is what the default 6,000-line budget gives.
- Diff paths, worktree paths and hunk headers disagreed with each other, in both
  the small-PR cases and the sharded one. The diff, the worktree and the line
  each finding cites are one block now, and the hunk headers count the lines
  they carry.
- `magpie serve` promised a URL the sandbox will not let anything bind. No case
  pins the browser surface, and the rubric accepts a reply that reports the
  server as unreachable.
- `magpie status` answered from a canned string, so it went stale the moment the
  agent logged a stage and the agent spent a paragraph on the discrepancy. It
  reads `log.jsonl` now, with the ladder from `scripts/status-cmd.ts`.

## Verification status

The suite has been run end to end four times (`--runs 1 --ablation none`)
against the committed fixtures, scoring 1.00 every time: twice on Claude Opus 5
and twice on Claude Opus 5.5. `shard-gate-stops-and-asks` was run three more
times on its own at `--runs 3` after the `focus` fix, passing 9/9 judge votes.
Every `llm` rubric has been tuned against real transcripts rather than written
blind.

Claude Opus 5.5 ran the suite at roughly half the cost and two thirds of the
wall clock of Claude Opus 5, with no case needing a rubric or fixture change.
Its default effort is `medium` where Claude Opus 5's is `high`, so a rubric that
starts failing there is worth reading as a real behavioural difference before
it is loosened.

Not yet known: no case has been run with the no-plugin baseline arm, so the
ablation delta is unmeasured, and no case other than the shard gate has been
repeated within one invocation, so the per-case variance is only bounded by
those two clean passes.
