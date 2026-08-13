# Phase 5: Queue

## Purpose

Carry forward, for an owner to adjudicate, everything any phase could not
resolve on its own: evidence, the real options, and a recommendation.
Exit condition: every item filed anywhere in the run so far is
grammatically valid, every id the referential-integrity gate actually
checks resolves to a real queue file, and `migrate phase queue --status
done` has run. It is not "the queue is empty": nothing in *this* phase
adjudicates an item, so a healthy run through phase 5 still ends with open
items, deliberately. Phase 6 is where they get decided.

## Inputs

- The store: `.migrate/queue/`, already holding whatever `migrate queue
  add` has filed from any earlier phase. This phase reads what already
  exists; it does not start a new file of its own the way `elements.jsonl`
  or `requirements.jsonl` does.
- `templates/queue-item.md`: the skeleton every filed item should start
  from. It carries the same three fields and three headings this manual's
  grammar section states below, no more and no fewer.

## Procedure

**The queue is cross-cutting, populated from any phase, not a phase that
runs once.** Every earlier manual in this set files items directly:
enumerate.md's zero-modularity escalation, extract.md's attribute and
rule-sweep and closer findings, parity.md's sub-high rubrics. This phase's
job is not to invent new items; it is to make sure everything already filed
is well-formed and everything the gate can check actually resolves, and
then to close.

**The grammar, stated once, before any example.** A queue item is a
markdown file whose stem matches its own `id`. Frontmatter carries `id`
(`q-` plus a lowercase kebab-case slug), `severity` (`critical`,
`moderate`, or `minor`), and `status` (`open`, or `adjudicated` with a
`ruling`). The body carries exactly three level-two headings, in any
order, case-sensitive and line-anchored (`## Evidence`, `## Options`,
`## Recommendation`), and **all three sections must be non-empty**. Missing
and empty are reported as distinguishable errors, not folded into one
generic complaint, so the fix is obvious from the message alone.

A worked example, the same file extract.md filed (built, in turn, on
`templates/queue-item.md`), run against a real store:

```markdown
---
id: q-reset-token-verify-missing
severity: critical
status: open
---

## Evidence

`read-write-symmetry` checked every write path against a matching read
path. `ResetPassword` writes a reset token via `GenerateResetToken` and
emails it, but no controller in the source reads or verifies a submitted
token: there is no `POST /api/password-reset/confirm` or equivalent. Either
the verification endpoint exists somewhere this pass did not look, or reset
tokens are issued and never checked.

## Options

(a) Widen the search (other controllers, an area folder, a separate
service) before concluding it is missing. (b) Treat it as a real gap and
flag it for the target to fix, not replicate. (c) Ask the operator directly
whether reset ever worked end-to-end in production.

## Recommendation

Recommend (c); a write with no matching read is exactly what this closer
exists to catch, and only the operator can say whether it is a real defect
or evidence this pass has not looked far enough yet.
```

`migrate queue add q-reset-token-verify-missing.md` accepts this and prints
`queue add: q-reset-token-verify-missing [critical]`.

### What the grammar rejects

Each of these, run against a real store, is refused before the file is ever
copied into `.migrate/queue/`; a rejected `queue add` never leaves a
half-written file behind.

- **Filename does not match `id`.** A file named `q-bad-mismatch.md` whose
  frontmatter says `id: q-something-else`:
  `filename q-bad-mismatch does not match id q-something-else`, exit 1.
- **A section is missing entirely.** No `## Options` heading anywhere in
  the body: `missing ## Options section (a line reading exactly "##
  Options", case-sensitive)`, exit 1.
- **A section is present but empty.** A `## Options` heading with nothing
  before the next heading: `## Options section is empty`, exit 1.
- **No frontmatter block at all.** A file that never opens with `---\n`:
  `missing --- frontmatter block`, exit **2**, not 1. This is the one
  grammar failure that is a usage error rather than a content failure: the
  file never resolved to a queue item in the first place, the same class as
  a missing file or an unreadable one.
- **An invalid severity.** `severity: urgent`: `severity must be one of
  critical, moderate, minor, got urgent`, exit 1.

Two more exist that are just as real but need a longer setup to trigger
faithfully rather than trust secondhand: an `id` that is not `q-` plus a
lowercase kebab-case slug, and a duplicate `## Evidence` heading (reported
as a duplicate, never silently taking the first and dropping the rest).
Both are enforced the same way, by name, before the file is copied.

### Severity, and why the list is ordered

**`queue list` sorts by severity first (`critical`, `moderate`, `minor`, in
that order), then by id.** This is not cosmetic: the queue is meant to be
adjudicated top to bottom in one sitting, and an owner working that way
should see the item that most needs a decision first, every time, not
whatever happened to be filed most recently. Write each item short enough
that one pass through the whole list is actually plausible; a queue item
that takes a page to explain a one-line decision has failed its own point
just as much as one with no evidence at all.

A worked example: `migrate queue list`, run against a real store with five
items filed across extract.md and parity.md's examples, prints:

```
q-reset-token-verify-missing	critical	open
q-account-lockout-scope	moderate	open
q-parity-um-003-reset-flow	moderate	open
q-users-islocked-semantics	moderate	open
q-legacy-admin-tool	minor	open
5 item(s)
```

The three `moderate` items sort by id alone (`account-lockout-scope` before
`parity-um-003-reset-flow` before `users-islocked-semantics`), since
severity does not separate them. When genuinely unsure which severity
fits, lean toward the one that puts the item in front of the owner sooner:
a real ambiguity mislabeled `minor` can sit unread far longer than the same
ambiguity mislabeled one tier too high ever costs.

### Referential integrity

**The gate checks exactly three fields against real queue files, by name,
and no others: `confidence.queue` on a requirement whose `confidence.kind`
is `queued`; `disposition.queue` on an element whose `disposition.kind` is
`out-of-scope`; and `parity.queue` on a requirement whose `parity.kind` is
`rubric` at any level below `high`.** State this before relying on it for
anything else, because the obvious-sounding generalization is wrong: a
census record's own `queued` array (on a `lens`, `attribute`, `rule-sweep`,
or `closer` record) is never cross-checked against a real queue file by any
gate. Verified on a disposable copy of the store, taken before extract.md's
own queue items were filed: a census record whose `queued` array names an
id with no file behind it still passes `migrate check` with zero `refs`
violations for that id, on that copy. Filing the file anyway is still this
manual's discipline, exactly as extract.md says, even though nothing
downstream will ever catch you if you skip it there.

A worked example of what the gate does check, run on a disposable copy so
the extra requirement and queue item below never enter the running example
(which by this point already has all five of its own items filed and would
otherwise read as six): a requirement with `confidence: {"kind": "queued",
"queue": "q-bulk-import-scope"}` and no such file on disk yet.

```
  refs:
    UM-005 references queue item q-bulk-import-scope via confidence.queue, which does not exist
```

`migrate queue add q-bulk-import-scope.md`, on that same disposable copy,
files the missing item; the very next `migrate check` no longer names it,
with no other change to that copy. The message names which field the
reference came from (`disposition.queue`, `confidence.queue`, or
`parity.queue`) precisely so that one requirement dangling from two
different fields at once reads as two separate things to fix, not one
ambiguous-looking duplicate.

## What closes it

No verb empties the queue here; closing this phase means every item filed so
far is well-formed and every reference the gate checks resolves, not that
adjudication has happened. `migrate adjudicate` is phase 6's verb, and the
`adjudication` gate that requires a ruling on every item is phase-scoped, so
it stays silent until the checked terminus reaches `adjudicate`. Run for
real:

```
migrate phase queue --status done
phase: queue is now done

migrate check --phase queue
4/5 mapped, 1 out-of-scope, 0 unaccounted

Violations (6):
  census:
    declared surface jobs has no lens census record; the lens did not run or did not close
    declared surface reports has no lens census record; the lens did not run or did not close
    declared surface screens has no lens census record; the lens did not run or did not close
    declared surface integrations has no lens census record; the lens did not run or did not close
    declared surface workflows has no lens census record; the lens did not run or did not close
    declared surface settings has no lens census record; the lens did not run or did not close
```

The six remaining lines are the same census noise every earlier manual in
this set already explains, not a queue defect: those six surfaces were
never enumerated in this scratch run. Closed for real, on the same store
with a zero-finding lens record recorded for each: `migrate check --phase
queue` exits 0 with no violations at all, confirming this phase's own
gates (`queue`, and the three `refs` fields above) were clean the whole
time and only the unrelated census gap was ever holding exit 0 back.

Plain `migrate check`, with no `--phase`, still fails here, and should:
phases 6 and 7 have not run, so `run-state` names both, the `adjudication`
gate names every item nobody has ruled on, and the `handoff` gate reports
that nothing has been emitted.

```
  run-state:
    phase adjudicate is pending; every phase through handoff must be done
    phase handoff is pending; every phase through handoff must be done
  adjudication:
    q-reset-token-verify-missing [critical] is still open; every queue item needs a ruling before handoff
  handoff:
    no handoff.json in the store; handoff has not run, so nothing has reached a delivery medium
```

`migrate check --phase queue` is this phase's terminus; plain `migrate
check` becomes reachable once phase 7 closes. `migrate status` afterward is
the plainer read, and it is what actually hands off to phase 6: `5 open
queue item(s) of 5`, `resume: adjudicate, no batches yet`.

## Degradation

- **One malformed item among many well-formed ones.** `queue list`,
  `queue show`, `check`, and `status` all keep going past it and report the
  rest; one bad file never hides an entire directory's worth of good ones.
- **Genuinely unsure which severity to file under.** Covered above: lean
  toward escalating rather than downgrading when truly unsure, since the
  cost of a false escalation (an owner glances at it sooner than strictly
  needed) is smaller than the cost of a false de-escalation (a real problem
  waits at the bottom of the list).
- **A census record's own `queued` ids with no queue file behind them.**
  Not caught by any gate, covered above; file them anyway, since a reviewer
  reading this run against this manual will expect to find one.

## Commands

```
migrate queue add <item.md>
migrate queue list [--open]
migrate queue show <id>
migrate phase queue --status done
```
