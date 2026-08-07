# migrate architecture

How the skill is built, why it is shaped this way, and how to extend it. For the
file formats and gate behaviour, see [reference.md](reference.md).

## The boundary rule

Three parts, one rule that decides which part gets a given piece of work.

- **The skill** (`SKILL.md`, and the phase manuals arriving in Milestone 2)
  holds judgment: what to look for in a legacy codebase, how to decide a
  requirement is confirmed rather than inferred, when to escalate to the queue.
- **The CLI** (`bin/`, `scripts/`) holds anything that must not be
  self-reported: the store, the arithmetic, the gates.
- **The references** are loaded just in time, so a run pays only for the phase
  it is in.

The rule is the point of the whole design. The method this generalises asked
agents to hand-write lines like `table census: 45 tables in source (43 ddl + 40
orm, deduped), 44 in ledger, 1 added` and to hand-verify the sum. Those numbers
were wrong twice on a real campaign. A number the tool can compute should never
be a discipline an agent must maintain, so anything countable moved into the
CLI, and anything requiring judgment stayed in the prompt.

When adding something, ask which side it belongs on. If an agent could get it
wrong and nobody would notice, it belongs in the CLI.

## Module map

```
bin/migrate            bash wrapper, resolves symlinks, execs bun
bin/migrate.ts         subcommand table, flag parsing, exit codes, central error guard

scripts/
  types.ts             every row and record type; discriminated unions
  ids.ts               element id derivation and slug validation
  paths.ts             store paths, store-root lookup, containment guard
  config.ts            config.toml load and write, TOML escaping
  store.ts             JSONL read, atomic write, id upsert, file readers
  lock.ts              store lock: serialises the read-modify-write in import,
                       census and phase --status
  phases.ts            phases.json state and committed batches
  validate.ts          per-row shape validation shared by import and check
  census.ts            census kinds, balance and bounds invariants, subject identity
  citations.ts         resolves src refs against the source tree
  leaks.ts             scans artifacts and git history for env values
  queue.ts             queue item parsing and grammar
  check.ts             composes the ten gates into a violation list
  report.ts            markdown rendering
  *-cmd.ts             one per subcommand; argument handling and orchestration
```

The `-cmd.ts` split exists so the logic is testable without spawning a process.
`check.ts` returns a violation list; `check-cmd.ts` decides how to print it and
what to exit with. Tests exercise both, and the end-to-end test drives the real
binary so argument parsing and exit codes are covered too.

## Why the store is split

Tabular artifacts are JSONL rows the CLI owns. Prose artifacts stay markdown.

Rows, because counts should be derived rather than authored. The moment an
element ledger is a hand-maintained markdown table, its totals are a claim
rather than a fact, and pipe characters in free text start breaking the table.

Markdown, because queue items, seam evidence and parity-basis notes are prose an
owner reads and reviews in a diff. A queue item is written to be adjudicated by
a human in about a minute; a JSON blob is worse at that job.

`migrate report` renders the rows into markdown views on demand, so humans get a
readable artifact without anyone hand-maintaining one.

## Invariants worth knowing before you change anything

**Nothing writes into the source tree.** `assertNotUnderSource` in `paths.ts`
guards every writer. It resolves real paths, so a symlinked `.migrate` cannot
sneak a write in, and it handles case-insensitive volumes. `citations.ts` shares
the same `isContained` predicate for the read side. If you add a writer, route
it through `writeRows` or `writeAtomically` rather than calling `writeFile`.

**Writes are atomic.** `writeAtomically` writes to a randomly-named sibling then
renames, and cleans up the temp file on failure without masking the original
error. A fixed temp name was tried first and lost data under concurrent writes.

**The read-modify-write around a store file is lock-serialised.** `import` and
`census` each read a whole store file, upsert or replace rows, and rewrite the
whole file (`census` also commits a batch into `phases.json`); `phase
--status` does its own read-modify-write on `phases.json` alone. Atomic writes
alone do not make any of that safe under a concurrent caller: two callers can
still read the same base and one rename can still discard the other's rows.
`lock.ts`'s `withStoreLock` wraps each of these three write paths in one lock
file for the whole store (`.migrate/.lock`, `O_EXCL` create, bounded retry with
backoff). It distinguishes a lock file that is merely absent or momentarily
empty (never counted against a corruption budget) from one that is genuinely
corrupt (five consecutive unreadable reads), re-reads before declaring a
holder's pid stale (the holder may have released between reads), and checks
its deadline unconditionally rather than only while a live holder is in view.
A lock failure raises `LockError`, which every caller maps to exit 3, not the
generic exit-2 path in `bin/migrate.ts`'s guard; `--force-unlock` removes a
lock believed stale before retrying.

**No timestamps in the store.** Git supplies chronology. An injected clock makes
tests flake, and there is no field a resume path needs it for.

**Rows upsert by id, preserving position.** `upsertRows` counts net changes
against a snapshot, so an intra-batch duplicate cannot inflate the count.
Comparison uses a key-order-insensitive serialization, since two equivalent rows
should not read as a change.

**Every command exits deliberately.** `bin/migrate.ts` wraps handler invocation
in a guard that turns any thrown `Error` into a clean one-line diagnostic at
exit 2. Do not add a local `try/catch` that duplicates it, and do not let a
handler print a stack trace. This guard was added late, after three separate
tasks each shipped the same crash class, and it covers every future command.

## How to extend

### Add a subcommand

Add an entry to `HANDLERS` in `bin/migrate.ts` using the existing lazy
`await import('../scripts/<name>-cmd.ts')` style, which keeps startup cheap. Use
the shared `readFlag` helper so a missing flag value is a usage error at 2 like
everywhere else. Add the verb to the `USAGE` string; `cli.test.ts` asserts the
help text lists every subcommand.

Most commands resolve their root with `findStoreRoot(process.cwd())` and exit 2
when there is none. `init` is the deliberate exception, because it creates the
store.

### Add a gate

Gates live in `check.ts` and push `{ gate, message }` onto one list.

1. Add the gate name to `GATE_ORDER`, which fixes its position in the report.
2. Push violations that name the specific offending row, path or id. An
   aggregate "check failed" is never acceptable; the message is what an agent
   acts on without a human.
3. If the gate is expensive, make it opt-in behind a flag like `--leaks`, and
   have `check-cmd.ts` pass it through. If it is cheap enough to want on by
   default instead, follow citations: on unless the caller passes
   `--no-citations`, so an orchestrator does not have to remember to ask for
   it.
4. Add tests for both directions. A gate that produces false failures is worse
   than no gate, because it makes `check` ignorable.

### Add a census kind

1. Add the variant to the `Census` union in `types.ts`.
2. Add its balance rule to `balanceOf` in `census.ts`. The message must state the
   arithmetic so a reviewer can check it without re-deriving anything.
3. Add its subject identity to `censusKey`, so re-recording replaces rather than
   stacks.
4. Extend `validateCensus` for the new fields.

### Add a surface type

Surface types are configuration, not code. Declare them in `[surfaces].types`.
Element id prefixes derive from the surface name by stripping a trailing `s`, so
a surface that is already singular but ends in `s` needs a
`[surfaces.singular]` override.

This is the main source-genericity lever: a COBOL source declares `programs`,
`copybooks`, `jcl-jobs` and `bms-maps` and every downstream gate follows.

## Testing conventions

`bun test` from `skills/migrate`. Also `bun run lint` (biome) and
`bun run typecheck` (tsc). All three must be clean.

**A test that passes against a broken implementation is treated as a defect**,
not a minor style issue. Two shipped during this milestone and both were caught
only by mutation. When you add a regression test, verify it fails against the
unfixed code: revert the source file with
`git checkout <sha> -- <path>`, run the test, observe the failure, then restore
with `git checkout HEAD -- <path>`.

**Never use `git stash` for that.** The stash stack is shared with other
worktrees and other sessions, and popping it can destroy someone else's work.

**Attack the code, do not just read it.** Nearly every real defect found in this
milestone came from constructing hostile input and running it: padding a census
with cosmetic duplicates, defeating containment with a symlink, breaking a
markdown table with a pipe, injecting a TOML key through a scope string. None
was visible in a diff.

Fixtures live in `fixtures/`. `tiny-express` is deliberately small, two routes
and one table, with its ground truth committed beside it in `GROUND-TRUTH.md`.
`e2e.test.ts` copies it to a temp directory and drives the real CLI through
`init`, `import`, `census` and `check`, showing the gate failing on unaccounted
elements before it passes. That arc is the point: a test that only demonstrates
the passing state would be worth much less.

## Known limits

**Free-text uniqueness.** Census `skipped` element names are compared after
trimming and case folding, and no further. Element names name real things in a
legacy source, so `orders.` and `orders` can legitimately differ, and nothing
can distinguish `orders` from `order`. This is documented in `census.ts` beside
the check. The padding route that mattered more, an inflated `in_ledger`, is
closed by reconciliation against the real element count.

**Concurrency is closed, not open.** This used to say `recordBatch`'s
read-modify-write on `phases.json` could lose committed-batch history under
concurrent importers, and that the preferred fix was an append-only batch log
matching how `elements.jsonl` already worked. Both halves of that were wrong
by the time a concurrent caller actually existed: `elements.jsonl` was never
append-only (`import` reads, upserts, and rewrites the whole file, the same
shape as `phases.json`), so an append-only log would have been the odd
mechanism out rather than a pattern already proven in the store. Milestone 2
closed this with a store lock instead; see the invariant above.

**`capabilities.jsonl` has no import path.** It is hand-written, which is why the
`refs` gate checks for duplicate slugs explicitly.

**Bun 1.3.14 TOML quirk.** `Bun.TOML.parse` swaps the named `\t` and `\f`
escapes: parsing `a = "x\ty"` yields codepoint 12. `config.ts` works around it
with explicit unicode escapes and a comment; re-verify on a Bun upgrade.
