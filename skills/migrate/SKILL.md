---
name: migrate
description: Source-agnostic legacy migration mapping. Walks a legacy codebase through probe, enumerate, seam, extract, parity, and queue, building an auditable requirements ledger with mandatory citations and a `migrate check` gate in place of self-reported completeness. Use when the user asks to migrate, re-specify, replatform, or map a legacy system onto a new stack, or to resume, check, or report on a mapping run already under way.
---

# migrate

## Prerequisites

- `migrate` on `PATH`, put there by this skill's `install.sh`.
- A read-only checkout of the legacy source. `migrate check`'s `citations` and
  `source` gates read it; nothing here writes to it, and every writer in the CLI
  refuses a path that resolves inside it.
- A target repo that is a git working copy. The store lives inside it and
  commits alongside your own work; there is no separate run directory.

## Phase walkthrough

Work phases 0 through 7 in order. Do not skip ahead: the run-state gate fails a
phase marked `done` while its predecessor is still `pending`, so working out of
order just produces a violation you undo later.

### 0. Probe

Produces `.migrate/config.toml` (detected source stack, `runnable` or
`source-only` basis, the target profile), written by `migrate init`, plus
`.migrate/parity-basis.md`: hand-written prose carrying the detection
evidence, since no command writes it either.

Read `references/phases/probe.md` before dispatching anything.

```
migrate init --source <path> --scope "<text>" --name <target> \
  [--source-stack <s>] [--target-stack <s>] [--basis <runnable|source-only>]
migrate phase probe --status done
```

### 1. Enumerate

Produces `elements.jsonl`, every row `unaccounted`, and one `lens` census
record per declared surface type.

Read `references/phases/enumerate.md` before dispatching anything.

Fanout unit: one agent per (surface, lens) pair.

```
migrate import elements <batch.json>
migrate census <lens-record.json>
migrate phase enumerate --status done
```

### 2. Seam

Produces `capabilities.jsonl` (the seam partition), `seam.json` (run-level
seam metadata), and `seam.md` (the validators' raw evidence). All three are
hand-written: there is no `seam` verb, so nothing in the CLI writes any of
them.

Read `references/phases/seam.md` before dispatching anything.

```
migrate phase seam --status done
```

### 3. Extract

Produces `requirements.jsonl`, the attribute/rule-sweep/closer census records,
and a terminal disposition on every element.

Read `references/phases/extract.md` before dispatching anything.

Fanout unit: one agent per capability.

```
migrate import reqs <batch.json>
migrate import elements <batch.json>
migrate census <record.json>
migrate phase extract --status done
```

The second import carries the resolved `disposition` (`mapped` or
`out-of-scope`); it is the only writer of a *resolved* value there, so this
line is the ledger write-back itself, not something the phase-status flip
does for you. `migrate reset --phase extract` also writes this field, but
only back to `unaccounted`; it clears, it does not resolve.

### 4. Parity

Produces `deltas.jsonl` and a parity plan on every requirement whose
confidence is not `queued`.

Read `references/phases/parity.md` before dispatching anything.

```
migrate import deltas <batch.json>
migrate import reqs <batch.json>
migrate phase parity --status done
```

The second import carries the resolved `parity` value; as in extract, it is
the only writer of a *resolved* value, and this line is the write-back
itself. `migrate reset --phase parity` also writes this field, but only
back to `null`; it clears, it does not resolve.

### 5. Queue

Produces the queue items carrying forward anything ambiguous: evidence,
options, and a recommendation, filed for an owner to adjudicate.

Read `references/phases/queue.md` before dispatching anything.

```
migrate queue add <item.md>
migrate phase queue --status done
```

### 6. Adjudicate

A run stops at the queue in this version of the tool: `adjudicate` has no verb
yet, so nothing here can move a queue item's status past `open`. `migrate
status` and `migrate queue list` are the terminus; adjudication arrives with
its verb in the next milestone.

### 7. Handoff

`handoff` has no verb yet either, for the same reason. `migrate status` and
`migrate queue list` remain the terminus; handoff arrives with its verb in the
next milestone.

## Checking as you go

Run `migrate check --phase <current>` after every batch. It bounds the
run-state gate at that phase; the other nine gates always read the whole
store, so a coverage or census gap past your current phase still fails on its
own gate regardless of `--phase`.

Run plain `migrate check` only when claiming the whole migration is complete:
with no `--phase`, it gates every phase through `handoff`. In this version
that cannot pass, because `adjudicate` and `handoff` have no verbs to complete
them. `migrate check --phase queue` is the practical terminus for this
milestone; its exit 0 is what "done, for now" means.

```
migrate check --phase queue
migrate check
```

## Resuming a crashed run

```
migrate status
migrate phase
```

`migrate status` prints the last committed batch and the outstanding work;
`migrate phase` (no name) prints every phase's status and batch count, one
line each, so you can see exactly where the run stopped. To re-enter one
phase, clear its derived rows and re-run it:

```
migrate reset --phase <phase>
```

Re-importing a batch upserts rows by id rather than duplicating them, so
progress from before the crash is not lost by retrying it.

## Aborting

There is no run directory to delete: the store lives at `.migrate/` inside the
target repo. `references/run-ops.md` holds the batch-checkpoint discipline (a
git commit after every `migrate import`); if it was followed, an aborted run
leaves behind exactly whatever the last commit captured. Leave `.migrate/` in
place either way. Discard only uncommitted scratch files, such as a
`batch.json` you built but never imported. `.migrate/.env`, if a runtime lens
created one, is already gitignored by `init` and must never be committed
regardless of how the run ends.
