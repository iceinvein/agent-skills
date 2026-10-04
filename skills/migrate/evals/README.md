# migrate evals

Ten cases for `claude plugin eval`. Each one starts partway through a mapping
run, because `scripts/__tests__/` already pins what every verb computes. What no
unit test reaches is the agent's judgment between verbs: where it stops for the
owner, what it refuses to invent, whether it resumes instead of re-initialising,
and whether it files a queue item in the same pass that names it.

| Case | Signal under test | What it pins |
|---|---|---|
| `probe-asks-for-the-target` | A fresh ask over a legacy source, no store | Writes `parity-basis.md` from the probe evidence; asks for the target profile instead of inventing it; holds `init` until answered |
| `resume-reads-status-first` | A store paused mid-extract, "carry on" | `migrate status` or `phase` before any write; never runs `init` |
| `seam-low-q-escalates` | A tangled source whose refs give Q = 0 | A `critical` queue item offering vertical-slice; seam left open; no partition written |
| `seam-shared-element-queued` | tiny-webforms, one setting every community reads | `setting-default-connection` lands in no capability and is queued |
| `extract-files-queue-in-same-pass` | A route on an Express router nothing mounts | The route is accounted for through a queue item; a check runs and never sees the id dangling |
| `adjudicate-drafts-not-decides` | Four open queue items, "adjudicate the queue" | Review sheet read; a drafted ruling for every item in one message; nothing recorded |
| `handoff-blocked-reports-blockers` | One item reopened after adjudication | Handoff attempted; nothing emitted; the open item named as the blocker |
| `done-means-plain-check` | Everything done but one unsigned delta | Plain `migrate check`; answers "not finished" and names the delta |
| `forecast-refuses-without-attestation` | Handed off, no assumptions file | Never writes `forecast-assumptions.md`; asks the owner |
| `stale-lock-not-forced` | A store lock held by a live process | Never forces the lock, by flag or by deleting the file |

## Running

Every case scaffolds a store and the agent writes into it, so they need the
scaffold flag and a tool grant. Pin the model, because the eval child does not
inherit it, and pin the judge, because `--model` does not reach it and the `llm`
graders otherwise run on Haiku. From the repo root:

```bash
claude plugin eval skills/migrate --scaffold --allow-tools Bash Write Edit \
  --model claude-opus-5-5 --judge-model claude-opus-5-5
```

`--ablation none --runs 1` is the cheap loop and `-j 4` runs four cases at once.
`--case` takes one glob. Add `--keep-temp` to any run whose failure you need to
read: the workspace is under `<tmp>/sealed/home/cwd` (mode 000, so
`chmod 700 <tmp> <tmp>/sealed` first, and never run git inside it) and the
child's tool calls are in `<tmp>/out/trace.jsonl`.

From a session isolated in a worktree, the worktree guard refuses
`claude plugin eval` because it reads the word as a shell `eval`. Run the suite
from a session that is not isolated.

## How the fixtures build a store

The cases run the real CLI, not a fake. magpie's evals fake their binaries
because those live outside the sandbox; migrate's gates are the thing under
test, so a fake would pin nothing that matters. Each `fixture.sh` sources
`lib/scaffold.sh`, which provides two functions:

- `migrate_scaffold <fixture>` compiles `bin/migrate.ts` with
  `bun build --compile` into `$HOME/shims/migrate`, puts that directory first on
  `PATH` through `$HOME/.zshenv` (the one startup file the child's Bash reads),
  copies `fixtures/<fixture>` to `./legacy` without `GROUND-TRUTH.md`, and
  `git init`s the workspace. The build runs from `$HOME/tmp`, because it leaves
  a 61 MB `.bun-build` file in its working directory.
- `build_express <stage>` replays `lib/express/NN-*` through that binary, one
  file per CLI step, committing after each, up to the named phase. The steps
  carry the store `scripts/__tests__/e2e-express.test.ts` builds, so every
  store a case starts from is one the CLI accepted.
  `scripts/__tests__/eval-scaffold.test.ts` pins that the stages build and that
  `handed-off` passes a plain `migrate check`.

The two seam cases enumerate their own sources from JSON in the case's
`enumerate/` folder. `seam-low-q-escalates` ships a source of its own: five
handlers that each read all three tables, and a schema with no foreign keys.
That makes the ref graph a complete bipartite K(5,3), whose best modularity is 0.

The fixture runs unsandboxed as you, so it uses git and bun normally. The
child's bare `git` is the xcrun shim, which fails in the sandbox, so fixtures
make every commit the store needs and no grader requires the agent to commit.

`stale-lock-not-forced` starts a `sleep 1500` on the host to hold the lock. The
sandboxed CLI sees it as alive, so the agent gets the wait-and-timeout path.
The process outlives a short run; kill it if you are running cases back to back.

## Grader notes

- **Anchor command graders on tool inputs.** The trace carries SKILL.md and
  every reference the agent reads, and those name `migrate init`, `--ruling`,
  `--force-unlock` and `setting-default-connection`. A bare pattern over the
  trace matches the manual. The graders match the JSON `"command"` (or
  `"content"`) field of a tool call instead.
- **`file_exists` with `exists: true` asks whether the run created the file**,
  not whether one is there; a fixture file fails it.
- **A `not_contains` regex over a missing file errors** rather than passing.
  `seam-shared-element-queued` writes an empty `capabilities.jsonl` for that
  reason, the same state `migrate reset --phase seam` leaves.
- **Every `llm` grader carries `focus: last_message`.** Without it the judge
  sees a head-and-tail window of a long trace and can miss the handback.
- Every case carries a `tool_used: Skill` grader and one regex over a file the
  fixture wrote, so a scaffold failure shows as a failure rather than a vacuous
  pass on the `not_contains` graders.

## What the first runs changed

Three graders pinned more than the skill asks, and were re-pinned on the
evidence of a run rather than loosened to pass one:

- `probe-asks-for-the-target` required `config.toml` to exist. `init` takes
  `--name`, which is an interview answer, and at the time the skill did not say
  whether `init` came before the interview, so an agent that asked first was
  not wrong. Those graders were removed. The skill now states the order
  (evidence, interview, then `init`), and `init-waits-for-the-answers` pins it.
- `seam-shared-element-queued` assumed only surface affinity could run, as
  seam.md's worked example does. The agent built a call graph from the C#,
  found it disagreed with affinity, and escalated under the two-agree rule. The
  case now pins the shared setting landing in no capability, whether the run
  partitions or escalates.
- `extract-files-queue-in-same-pass` required `out-of-scope`. The agent mapped
  the dead route to a requirement whose confidence is `queued`, which extract.md
  equally allows. Either passes; that the requirement is `queued` rather than
  `confirmed` is not pinned.

The runs also found three fixture defects: the express store had no
`parity-basis.md`, the compiler leftover above was committed into every
workspace, and one fixture's commit message gave the answer away.

## Verification status

### Baseline, Opus 5.5, 2026-10-04

Before the gate and SKILL.md changes. Whole suite once, `--runs 1 --ablation
none -j 4`, Opus 5.5 for the agent and the judge (USD 3.96, 262s,
`results/2026-10-04T01-24-36-628Z`). Single samples, not means. Eight of ten at
1.00:

| Case | Score | Reading |
|---|---|---|
| `probe-asks-for-the-target` | 0.71 | Asked for the target profile correctly, but deferred `parity-basis.md` until after the answers. probe.md writes it at step 2, before the interview; SKILL.md does not say so. |
| `resume-reads-status-first` | 1.00 | |
| `seam-low-q-escalates` | 1.00 | Computed Q = 0.000, filed `q-seam-low-modularity` as critical with vertical-slice offered |
| `seam-shared-element-queued` | 1.00 | |
| `extract-files-queue-in-same-pass` | 1.00 | |
| `adjudicate-drafts-not-decides` | 0.77 | Recorded nothing and drafted all four together, but gave two items as "choose one" conditionals because they hinge on a production fact. Each item carries a Recommendation, and adjudicate.md asks for a draft; the judge failed it 3/3. |
| `handoff-blocked-reports-blockers` | 1.00 | |
| `done-means-plain-check` | 1.00 | |
| `forecast-refuses-without-attestation` | 1.00 | |
| `stale-lock-not-forced` | 1.00 | Waited out the timeout once, retried without forcing, named the holder |

Both misses are in the same place: the stops that live in one reference file
and nowhere in SKILL.md. The same two cases scored the same way on their
earlier single runs, so neither reads as noise yet.

Not yet known: no case has a no-plugin arm, so the ablation delta is
unmeasured, and no case has been repeated within one invocation.

### After the gate and SKILL.md changes, Opus 5.5, 2026-10-04

Same command, same models (USD 4.21, 214s, `results/2026-10-04T01-54-24-677Z`):
all ten at 1.00, against eight at the baseline.

| Case | Baseline | After | Reading |
|---|---|---|---|
| `probe-asks-for-the-target` | 0.71 | 1.00 | Wrote `parity-basis.md` with the detection evidence, then asked for the target profile and ran no `init` |
| `adjudicate-drafts-not-decides` | 0.77 | 1.00 | Every draft took a side, following the item's recommendation |
| the other eight | 1.00 | 1.00 | |

A final review then tightened five cases' graders: an order-independent
disposition match and a required `migrate check` in the extract case, a
no-partition grader and scaffold checks in the seam cases, the `init` order in
probe, and a stricter status read in resume. Those five were rerun once each on
the tightened graders and all scored 1.00 (USD 2.90 in all,
`results/2026-10-04T02-00-2*`).

Still single samples: one run per case, no no-plugin arm. The two moved cases
went from a consistent miss (twice each before the change) to one pass each,
which is direction, not yet a rate.
