# migrate

Source-agnostic legacy migration mapping. `migrate` enumerates a legacy
system's surface from two independent directions per lens, derives a
capability seam empirically rather than by guesswork, extracts cited
functional requirements, plans parity, and routes every ambiguity to a batch
decision queue. The coverage arithmetic and citation resolution are enforced
by a bundled Bun CLI instead of being self-reported.

This milestone ships the store, the config, and the nine-gate `check`
command, proven end to end against a fixture source. The phase walkthrough
and the stack recipe packs that drive an actual migration are Milestone 2;
see `SKILL.md`.

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
| `.migrate/forecast-assumptions.md` | prose | owner-attested forecast inputs, opt-in |
| `.migrate/queue/q-<slug>.md` | prose | evidence, options, recommendation |
| `.migrate/.env` | secrets | runtime-lens credentials, gitignored |
| `docs/migrate/*.md` | generated | human-readable views, written by `migrate report` |

## CLI

| Command | Does |
|---|---|
| `migrate init --source <path> --scope <text> --name <target>` | Writes `.migrate/config.toml` |
| `migrate import <elements\|reqs\|deltas> <batch.json>` | Validated bulk append to the store |
| `migrate census <record.json>` | Records a lens accounting record |
| `migrate queue add <file.md>` | Adds a queue item |
| `migrate queue list [--open]` | Lists queue items, severity first |
| `migrate queue show <id>` | Prints one queue item |
| `migrate check [--citations] [--leaks]` | Runs the gates |
| `migrate status` | Phase state, counts, resume pointer |
| `migrate reset --phase <phase>` | Clears one phase's derived rows |
| `migrate report [--out <dir>]` | Renders markdown views |

Run `migrate --help` for the same list from the CLI itself.

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

The fixture at `fixtures/tiny-express/` is a tiny, deliberately small Express
app with a known ground truth (`GROUND-TRUTH.md`): two routes and one table.
`scripts/__tests__/e2e.test.ts` drives the real CLI as a subprocess over a
copy of that fixture, through `init`, `import`, `census`, and `check`, and
shows the gate failing on unaccounted elements before it passes once every
element is mapped and cited.
