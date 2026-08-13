# Phase 6: Adjudicate

## Purpose

Get an owner's decision on every open queue item, in one pass, and record
each ruling where the gate reads it. Exit condition: every item in
`.migrate/queue/` has `status: adjudicated` with a non-empty `ruling`, every
downstream consequence of those rulings has been imported into the store,
and `migrate phase adjudicate --status done` has run.

This is the phase where the run stops being a mapping exercise. Nothing
before it needed a human to decide anything; nothing after it can proceed
until they have.

## Inputs

- `.migrate/queue/*.md`, everything filed by any earlier phase. Phase 5
  made sure they are well-formed; this phase gets them decided.
- The store, because most rulings have a consequence in it: an element's
  `disposition`, a requirement's `confidence`, a requirement's `parity`.
- The owner. This is the one phase whose input is not in the repository.

## Procedure

**Read the whole list before ruling on anything.** `migrate adjudicate` with
no arguments prints the review sheet: every item, severity first, with the
first line of its recommendation alongside. That last part is what makes one
sitting possible, and it is the reason to start here rather than opening
files:

```
migrate adjudicate

q-mailer-unobservable [moderate] open - Recommend (b): nothing in the checkout shows this ever delivered mail.

1 open
```

Items are ordered `critical`, `moderate`, `minor`, then by id, the same
order `queue list` uses. Work down it.

**Draft a ruling for each, then present them together.** The agent's job is
to draft, not to decide. A drafted ruling that the owner accepts unchanged
is a good outcome; a drafted ruling nobody read is the failure this phase
exists to prevent. Present the whole set at once so the owner sees the
shape of what they are agreeing to, rather than being walked through four
separate decisions with no view of how they interact.

**Record each approved ruling.** One command per item:

```
migrate adjudicate q-mailer-unobservable \
  --ruling "out of scope until an operator confirms delivery ever worked"

adjudicate: q-mailer-unobservable
  status  open -> adjudicated
  ruling  recorded
next: apply the consequence with `migrate import`
```

The file's frontmatter afterwards, with the body untouched:

```
---
id: q-mailer-unobservable
severity: moderate
status: adjudicated
ruling: out of scope until an operator confirms delivery ever worked
adjudicated: 2026-08-13
---
```

Three things about that write are worth knowing before you rely on them.
Keys the command does not own keep their position, so an item carrying its
own extra frontmatter is not reordered. The body round-trips byte for byte,
because it is the audit record of *why* the ruling was made and a rewrite
that reflows it destroys the thing being audited. And the ruling is a
single frontmatter line, so a ruling containing a newline is refused at
exit 2 rather than written into a block it would corrupt. Keep rulings to
one sentence; the reasoning belongs in the body, which already has it.

**The verb does not touch the row files.** This is the part most likely to
catch you out. `adjudicate` writes queue frontmatter and nothing else. A
ruling that puts an element out of scope, or settles a requirement's
confidence, or fixes a parity plan, is applied by `migrate import`, exactly
as in phases 3 and 4. That is why the command prints `next: apply the
consequence with 'migrate import'` on every success, and why this phase is
not finished when the last item flips to `adjudicated`.

Worked through: the ruling above says the mailer requirement is out of
scope until someone confirms delivery. `UD-003` currently carries
`confidence: {"kind": "queued", "queue": "q-mailer-unobservable"}`. The
ruling does not change that by itself. If the decision is to leave the
requirement recorded but unconfirmed, nothing further is needed and it
simply stays outside the confirmed denominator that `migrate coverage`
divides by. If the decision is that it is now settled, re-import the row
with the confidence the ruling gives it.

**Re-ruling refuses.** An item that already carries a ruling is not
silently overwritten:

```
migrate adjudicate q-mailer-unobservable --ruling "changed my mind"

adjudicate: q-mailer-unobservable is already adjudicated: out of scope until an operator confirms delivery ever worked
adjudicate: pass --force to replace it
```

Exit 1, and the existing ruling is printed so you can see what `--force`
would have replaced. An owner's recorded decision is not something a re-run
that meant no harm should be able to discard.

## The gate

Gate 11, `adjudication`, checks exactly one thing: every queue item is
`adjudicated` and carries a non-empty ruling. It names each item that is
not, with its severity.

The gate is phase-scoped: it does not fire when the checked terminus is
below `adjudicate`, so `migrate check --phase queue` stays clean for a run
that has not reached this phase yet. From `migrate check --phase adjudicate`
onward it applies.

An open item on a store that is otherwise complete reads:

```
  adjudication:
    q-mailer-unobservable [moderate] is still open; every queue item needs a ruling before handoff
```

## Degradation

- **The owner is unavailable.** Do not rule on their behalf and do not mark
  the phase done. There is no partial-credit state here: an unruled item
  blocks handoff, which is the correct outcome, because handing a build team
  work whose open questions nobody answered is what this gate exists to
  stop. Leave the phase `running` and say so in the handoff notes.
- **An item turns out to need no decision.** It still needs a ruling. Record
  the reason it needed nothing (`no action: the endpoint was removed before
  this run started`); the gate wants a decision recorded, not a change made.
- **A ruling that changes an earlier phase's output.** Apply it with the
  same `migrate import` that phase used, then re-run `migrate check --phase
  adjudicate`. Re-importing is an upsert by id, so it updates rather than
  duplicating.
- **A queue file that will not parse.** `adjudicate <id>` on it exits 1 and
  names the grammar failure; fix the file with phase 5's grammar and try
  again. An id with no file at all is exit 2, a different class: the request
  never resolved to an item.

## Commands

```
migrate adjudicate
migrate adjudicate <id> --ruling "<text>"
migrate adjudicate <id> --ruling "<text>" --force
migrate import <elements|reqs|deltas> <batch.json>
migrate check --phase adjudicate
migrate phase adjudicate --status done
```
