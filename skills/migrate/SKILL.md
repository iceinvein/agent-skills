---
name: migrate
description: Source-agnostic legacy migration mapping. Walks a legacy codebase through probe, enumerate, seam, extract, parity, queue, adjudicate and handoff, building an auditable requirements ledger with mandatory citations and a `migrate check` gate in place of self-reported completeness. Use when the user asks to migrate, re-specify, replatform, or map a legacy system onto a new stack, to hand mapped requirements to a delivery team, or to resume, check, report, or forecast a mapping run already under way.
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
hand-written: there is no `seam` verb, so nothing in the CLI authors their
content. (`migrate reset --phase seam` does write to these paths, clearing
`capabilities.jsonl` and deleting the other two, but that undoes the phase
rather than authoring it.)

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
migrate queue add <item.md>
migrate phase extract --status done
```

`queue add` is not optional here. An `out-of-scope` disposition's queue id
and a `queued` confidence's queue id are both checked by the `refs` gate, and
a queue id with no file behind it is a violation the moment anything checks,
not a future one. File each item in the same pass that names it.

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
migrate queue add <item.md>
migrate phase parity --status done
```

Same rule as phase 3: a `rubric` plan below `high` must carry a queue id, and
the `refs` gate checks it resolves, so file the item in this pass.

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

Produces a ruling on every queue item: `status: adjudicated` plus a `ruling`
line, written into the item's own frontmatter.

Read `references/phases/adjudicate.md` before dispatching anything.

```
migrate adjudicate
migrate adjudicate <id> --ruling "<text>"
migrate import <elements|reqs|deltas> <batch.json>
migrate phase adjudicate --status done
```

Run `migrate adjudicate` with no arguments first: it prints the review sheet,
severity first, each item carrying the first line of its recommendation, which
is what makes one pass over the whole queue possible.

The verb writes queue frontmatter and nothing else. A ruling's consequence in
the store (an element's disposition, a requirement's confidence or parity) goes
through `migrate import`, exactly as in phases 3 and 4, so the row files keep
one writer and one validation path. The command prints that next step on every
success because it is easy to believe the ruling did it for you.

### 7. Handoff

Produces the requirements as work items in whatever the delivery team uses,
one work item per capability in dependency order, plus `.migrate/handoff.json`
recording what was emitted and the forecast basis.

Read `references/phases/handoff.md` before dispatching anything.

```
migrate handoff --dry-run
migrate handoff [--adapter <markdown|github|flow>]
migrate phase handoff --status done
```

Three adapters: `markdown` (the default, a roadmap plus a file per capability),
`github` (a milestone per capability, an issue per requirement), and `flow`
(a Nexus `stack` target's capability map and `docs/WORK.md`).

Handoff refuses while anything is unresolved and names every blocker at once:
the gate with citations and leaks both on, any queue item still open, and any
requirement blocked by one. Blocked means a `queued` confidence or a sub-high
`rubric` parity whose queue item is **still open**; once that item is
adjudicated the requirement stops blocking, even though its confidence field
still reads `queued`.

`--dry-run` writes nothing at all, `handoff.json` included, so it is safe to
run against a store you are still working on.

## Reading progress back

Once handoff has run, these two re-read delivery through the same adapter that
emitted the work. They are the only part of this tool meant to be run
repeatedly after the mapping run ends.

```
migrate coverage
migrate forecast
```

`coverage` divides built by **confirmed** requirements, reports the
non-confirmed exclusions separately, and names the evidence it read. `forecast`
needs an owner-attested `.migrate/forecast-assumptions.md`, copied from
`templates/forecast-assumptions.md`, and refuses without one; it labels every
scenario as measured or as an owner target so an aspiration never reads as a
fact.

## Checking as you go

Run `migrate check --phase <current>` after every batch. It bounds the
run-state gate at that phase; the other nine gates always read the whole
store, so a coverage or census gap past your current phase still fails on its
own gate regardless of `--phase`.

Run plain `migrate check` only when claiming the whole migration is complete:
with no `--phase`, it gates every phase through `handoff`, and its exit 0 is
what "the migration is mapped" means.

Two of the twelve gates are phase-scoped. `adjudication` and `handoff` describe
phases 6 and 7, so they stay silent until the checked terminus reaches them;
that is what keeps `migrate check --phase queue` usable for a whole mid-run
campaign instead of red from the first batch.

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
created one, must never be committed regardless of how the run ends. `init`
takes care of the ignore entry in all three cases, and says on stdout when it
changed something: `init: created <path> with .migrate/.env` when the target
had no `.gitignore`, `init: appended .migrate/.env to <path>` when it had one
without the entry, and **nothing at all** when the entry was already there,
since there was nothing to change. Silence from `init` on this is the
already-correct case, not a skipped one. If you edited `.gitignore` after
`init` ran, check the entry is still there before committing anything, because
nothing re-checks it: the `leaks` gate that would catch a committed value is
opt-in (`migrate check --leaks`).
