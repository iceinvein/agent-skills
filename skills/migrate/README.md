# migrate

Source-agnostic legacy migration mapping. `migrate` walks a legacy codebase
through probe, enumerate, seam, extract, parity, and queue, building an
auditable requirements ledger with mandatory citations instead of a
self-reported one. It enumerates the legacy surface from two independent
directions per lens, derives a capability seam empirically rather than by
guesswork, extracts cited functional requirements, plans parity against the
source, and routes every ambiguity to a batch decision queue for a human to
adjudicate. The coverage arithmetic, citation resolution, and phase ordering
are enforced by a bundled Bun CLI instead of being self-reported. Two more
phases, adjudicate and handoff, complete the walkthrough but ship no CLI verb
yet; see the phases table below.

## Using it

Invoke `/migrate` in a target repo that is a git working copy, pointed at a
read-only checkout of the legacy source. The skill (`SKILL.md`) is the
walkthrough: it names, phase by phase, what to read, what to dispatch, and
what `migrate` command closes that phase out. Each phase's manual under
`references/phases/` carries the actual judgment calls, loaded only when
that phase is current so a run never pays for prose it does not need yet.

### The phases

| # | Phase | Manual | What it produces |
|---|---|---|---|
| 0 | Probe | `references/phases/probe.md` | `.migrate/config.toml` (detected source stack, basis, target profile) and `.migrate/parity-basis.md` (the detection evidence, hand-written) |
| 1 | Enumerate | `references/phases/enumerate.md` | `elements.jsonl` and a lens census record per surface |
| 2 | Seam | `references/phases/seam.md` | `capabilities.jsonl`, `seam.json`, `seam.md`: the capability partition and its evidence |
| 3 | Extract | `references/phases/extract.md` | `requirements.jsonl`, attribute/rule-sweep/closer census records, terminal element dispositions |
| 4 | Parity | `references/phases/parity.md` | `deltas.jsonl` and a parity plan on every non-queued requirement |
| 5 | Queue | `references/phases/queue.md` | Queue items carrying evidence, options and a recommendation for anything ambiguous |
| 6 | Adjudicate | none yet | No verb ships in this version; `migrate status` and `migrate queue list` are the terminus |
| 7 | Handoff | none yet | Same as adjudicate: no verb yet |

A run in this version stops at the queue. `adjudicate` and `handoff` have no
CLI verbs to complete them, so `migrate check --phase queue` is the
practical terminus: its exit 0 is what "done, for now" means. Plain `migrate
check` gates every phase through `handoff` and cannot pass yet for the same
reason. `references/run-ops.md` covers what applies across every phase
rather than any one of them: subagent dispatch, the batch-checkpoint
discipline, and what happens when two agents contend for the store lock.

### Recipes

Enumerate reads the source stack `probe` detected and looks for a matching
file in `references/recipes/`, one file per stack family
(`references/recipes/aspnet.md` covers `aspnet-webforms`, `aspnet-mvc`, and
`aspnet-webapi`). A recipe answers one narrow question: for each declared
surface type, at least two independent directions for enumerating it and the
probe command that realises each one. Nothing else; the lens contract itself
lives once in `enumerate.md`, and a recipe does not restate it, carry
classification rules, or gate anything.

If no file matches the detected stack, that is contract-only mode: a
supported path, not a degraded one. The enumerating agent derives its own two
directions per surface, and the census gates them exactly as it would a
recipe's.

**Adding a stack is one new file in `references/recipes/` and no edit
anywhere else.** `SKILL.md`, the phase manuals, and the CLI never name an
individual stack; they only read `[source].stack` and look in that
directory. See `references/recipes/README.md` for the exact file shape.

## Checking as you go

```
migrate check --phase <current-phase>
```

bounds the run-state gate at that phase; the other nine gates always read
the whole store, so a coverage or census gap past your current phase still
fails on its own gate regardless of `--phase`. Citations are checked by
default; pass `--no-citations` to skip that gate.

## Fixtures

Two fixtures, each with a committed `GROUND-TRUTH.md`, drive the skill end to
end:

- **`fixtures/tiny-express/`**: a small Express/Node app, twelve elements
  across all eight default surfaces. Its stack (`express`) matches no file
  in `references/recipes/`, so it proves the contract-only path: enumerate
  deriving its own two directions per surface with no recipe to lean on, and
  the census gating them exactly the same as it would a recipe's.
- **`fixtures/tiny-webforms/`**: a small ASP.NET Web Forms app, sixteen
  elements across the same eight surfaces. Its stack (`aspnet-webforms`)
  matches `references/recipes/aspnet.md`, so it is that recipe's first run
  against committed code, not just the throwaway trees it was written
  against.

`scripts/__tests__/e2e-express.test.ts` and
`scripts/__tests__/e2e-webforms.test.ts` copy the respective fixture to a
temp directory and drive the real CLI as a subprocess, probe through queue,
through `init`, `import`, `census`, `phase`, `queue add`, `queue list`, and
`check`, reconciling every row against the fixture's ground truth. Both end at
`migrate check --phase queue` on exit 0, and then show plain `migrate check`
failing on exactly `adjudicate` and `handoff`, the two phases with no verb in
this version.

Both show gates in both directions. Failing before they pass: the mid-run check
after enumerate names the three closer records extract has not written yet, and
the `deltas` gate names the sanctioned difference each run files unsigned
before an owner signs it. Failing after they pass: each run closes green, then
mutates the store (nulling every parity plan, then removing an element row) and
asserts the gate that should catch it does.

## Documentation

- **[docs/reference.md](docs/reference.md)** is what you need to drive the CLI:
  the batch-file and census formats with worked examples, the row schemas and
  their grammars, what each of the ten gates enforces, and the exit-code
  convention. Ships with the installed skill.
- **[docs/architecture.md](docs/architecture.md)** is for working on the skill
  itself: the module map, the rule that decides what belongs in the CLI rather
  than the prompt, how to add a gate or a surface type, the testing
  conventions, and the known limits.

## Store layout

The store lives at `.migrate/` in the target repo and is committed.

| Path | Shape | Holds |
|---|---|---|
| `.migrate/config.toml` | declarative | source pointer and scope, detected source stack, target profile, surface-type set, closer set, handoff adapter |
| `.migrate/elements.jsonl` | rows | surface ledger |
| `.migrate/requirements.jsonl` | rows | functional requirements and their dispositions |
| `.migrate/capabilities.jsonl` | rows | the seam partition |
| `.migrate/seam.json` | object | run-level seam metadata: validators run, modularity, status |
| `.migrate/deltas.jsonl` | rows | sanctioned delta catalog |
| `.migrate/census.jsonl` | rows | one accounting record per lens run |
| `.migrate/phases.json` | object | per-phase status, batches, resume pointers |
| `.migrate/seam.md` | prose | validator scripts and their raw output |
| `.migrate/parity-basis.md` | prose | runnable-versus-source-only detection evidence |
| `.migrate/queue/q-<slug>.md` | prose | evidence, options, recommendation |
| `.migrate/.env` | secrets | runtime-lens credentials, gitignored |
| `docs/migrate/*.md` | generated | human-readable views, written by `migrate report` |

## CLI

| Command | Does |
|---|---|
| `migrate init --source <path> --scope <text> --name <target>` | Writes `.migrate/config.toml` |
| `migrate import <elements\|reqs\|deltas> <batch.json>` | Validated bulk append to the store |
| `migrate census <record.json>` | Records a lens accounting record |
| `migrate phase [<name>] [--status <s>]` | Prints phase state, or sets one phase's status to any value you name |
| `migrate queue add <file.md>` | Adds a queue item |
| `migrate queue list [--open]` | Lists queue items, severity first |
| `migrate queue show <id>` | Prints one queue item |
| `migrate check [--phase <p>] [--no-citations] [--leaks]` | Runs the gates |
| `migrate status` | Phase state, counts, resume pointer |
| `migrate reset --phase <phase>` | Clears one phase's derived rows and returns it to `pending` |
| `migrate report [--out <dir>]` | Renders markdown views |

Run `migrate --help` for the same list from the CLI itself.

**Four commands write a phase's status, each to a different extent.** `phase
--status <s>` is the only one that writes any value you ask for, and the only
one whose whole purpose is that write. `reset --phase <p>` also writes it
directly, but only ever to `pending`, and it empties that phase's `batches`
list at the same time. `import` and `census` touch `phases.json` incidentally,
each moving a phase to `running` (unless it is already `done`) when they record
a batch. Nothing else writes it at all.

A lock failure on `import`, `census`, `phase --status`, or `reset` exits `3`;
pass `--force-unlock` once you have confirmed no other agent is actually
writing.

## Install

```
bunx @iceinvein/agent-skills install migrate -g
```

This skill ships in two parts: the prompt (`SKILL.md`) and a companion Bun
CLI (`bin` + `scripts`). The agent-skills installer writes both into
`~/.claude/skills/migrate/` and then runs the bundled `install.sh` as a
postinstall step, which symlinks `bin/migrate` onto your PATH (preferring
`/usr/local/bin`, falling back to `~/.local/bin`). Removing the skill with
`agent-skills remove migrate -g` runs `uninstall.sh` first to undo the PATH
symlink.

If you cloned this repo and want to run from source, you can also invoke
`./install.sh` directly: it does the PATH-link step against the local source
tree.

## Development

```
bun test              # Run all tests
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```
