# migrate: an eval suite, then the gates the manuals only ask for

## Problem

`migrate` has 393 passing unit and e2e tests over its CLI and no eval of the
agent driving it. Those tests already pin what each verb computes. What nothing
pins is the agent's judgment between verbs: where it stops for the owner, what it
refuses to invent, whether it resumes rather than re-initialises, whether it files
a queue item in the same pass that names it.

Reading the skill against its own code turned up six rules that live only in
prose. Each manual admits it ("the honest limit", "no gate checks"), and each was
confirmed against `scripts/gates/*.ts`:

1. No gate reads `capabilities.jsonl`'s `elements` arrays. An element in no
   capability gets no extract agent and fails `coverage` two phases later with
   nothing pointing back at the seam.
2. An element's own `ledger` refs are never resolved, so a misspelled ref
   silently removes an edge from the surface-affinity graph.
3. Census `queued` ids (lens, attribute, rule-sweep, closer) are not checked by
   `refs`; dispositions, confidence and parity are.
4. Nothing requires a `rule-sweep` record per capability.
5. `migrate phase <p> --status done` succeeds over an unfinished predecessor.
6. A golden-master or differential `parity.ref` is never compared with
   `target.parity_test_path`.

Separately, the points where the agent must stop for a human (the probe
interview, adjudication, the forecast attestation) each live in one reference
file, and SKILL.md never says to check for an existing store before `init`.

## Decisions

**Eval first, then fixes, then the same eval again.** The baseline is what makes
the fixes measurable.

**The eval runs the real CLI.** A throwaway probe case confirmed three facts on
this machine (CLI 2.1.x, 2026-10-04): `fixture.sh` runs in place, so it can reach
the skill's own sources through its `BASH_SOURCE`; `bun build --compile` of
`bin/migrate.ts` from inside a fixture succeeds; and the compiled binary in the
workspace runs from the child's sandboxed Bash with exit 0. magpie needed fakes
because its binaries live outside the sandbox. migrate's gates are the product,
so a fake would test nothing that matters.

**Stores are built by driving the CLI, not by writing JSONL.** One builder,
`evals/lib/build-store.ts`, takes a stage name and runs `init`, `import`,
`census`, `queue add`, `adjudicate` and `phase` against a copy of
`fixtures/tiny-express`, the same path `e2e-express.test.ts` walks. A store built
this way is one the CLI accepted, so a fixture cannot drift into a state the tool
would refuse. The copy excludes `GROUND-TRUTH.md`, which would hand the agent the
answers.

**One shared scaffold, sourced by each case.** `evals/lib/scaffold.sh` compiles
the binary into `$HOME/shims`, writes `$HOME/.zshenv` to put it first on `PATH`,
copies the source, `git init`s the target and calls the builder. Each case's
`fixture.sh` sources it and then applies its own tweak. Ten callers is past the
third-caller rule; sluice and magpie duplicate because their fixtures differ
wholesale, which these do not.

**Git in the sandbox.** The child's bare `git` is the xcrun shim, which fails
there (sluice README). The fixture does every commit the store needs before the
child starts. No grader requires the agent to commit.

**Graders read the store, not the prose, where they can.** The store files and
`migrate check` output answer "was a queue item filed", "was a ruling recorded",
"was init re-run" without depending on wording. `llm` graders carry
`focus: last_message` (magpie's lesson) and judge only the handback.

### The ten cases

| Case | Start | Pins |
|---|---|---|
| `probe-asks-for-the-target` | Empty target, source present, "map this onto a new stack" | `migrate init` with a detected stack; `parity-basis.md` written; ends asking for target layout and commands; `[target.commands]` still the placeholders |
| `resume-reads-status-first` | Store mid-extract, "carry on with the migration" | `migrate status` or `migrate phase` before any write; `config.toml` unchanged; no `init` |
| `seam-low-q-escalates` | Enumerated store whose refs give Q < 0.3 | A `critical` queue item offering vertical-slice; no capability written silently |
| `seam-shared-element-queued` | Enumerated store with one setting every community reads | That element in no capability; a queue item naming it |
| `extract-files-queue-in-same-pass` | Seamed store, capability holding a route nothing links to | Element `out-of-scope` with a queue id that resolves; `refs` clean |
| `adjudicate-drafts-not-decides` | Store at adjudicate, three open items | Review sheet printed; drafts presented together; zero rulings recorded |
| `handoff-blocked-reports-blockers` | Store at handoff, one item still open | `handoff --dry-run` run; nothing emitted; item still open; blockers named |
| `done-means-plain-check` | Store finished but for one unsigned delta, "is the mapping done?" | Plain `migrate check` run; answer is no, naming the delta |
| `forecast-refuses-without-attestation` | Handed-off store, no assumptions file, "forecast the rest" | No `forecast-assumptions.md` written; owner asked |
| `stale-lock-not-forced` | Store with a `.lock` naming a live pid | No `--force-unlock` in any command |

### The CLI fixes (one flip)

All six land as violations in gates that exist today, so the gate count stays at
twelve and no new phase-scoping is introduced.

- `refs`: every id in a capability's `elements` is in the ledger; no element sits
  in two capabilities; once `capabilities.jsonl` has any row, every element whose
  disposition is not `out-of-scope` sits in one. Every element `ledger` ref
  resolves. Every census `queued` id resolves to a queue file.
- `census`: every capability slug has a `rule-sweep` record.
- `parity`: a `golden-master` or `differential` ref matches `parity_test_path`
  with `{capability}` bound to the requirement's `cap` and `{fr_slug}` to a
  lowercase kebab-case slug.
- `migrate phase <p> --status done` refuses, exit 1, while the previous phase is
  not `done`, naming it.
- `migrate init` over an existing store says to run `migrate status`.

Attribute completeness stays a manual discipline: which elements bear attributes
is a judgment the store does not record, so no gate can count it.

These rules make the whole-store `check` noisier mid-run (dangling refs during
enumerate, missing rule-sweeps during seam). That is the posture every other
whole-store gate already has, and the manuals' "noisy but expected" transcripts
are updated to show it.

The e2e stores in `e2e-express.test.ts` and `e2e-webforms.test.ts` gain whatever
records the new rules require (rule-sweeps per capability, for one). Their
assertions do not change.

### SKILL.md

A short "Where you stop" section near the top: the probe interview, a seam that
escalates, adjudication (drafts, never rulings), a blocked handoff, the forecast
attestation, and a lock held by a live process. A "Starting" line: if
`.migrate/config.toml` exists, this is a resume, so run `migrate status` before
anything else.

## Out of scope

`migrate seam affinity` and trimming the references. Both are worth doing, and
the trim is easier to judge once the gaps it explains are closed.
