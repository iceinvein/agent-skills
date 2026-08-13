# Phase 7: Handoff

## Purpose

Emit the mapped requirements into whatever a delivery team actually works
from, in dependency order, and record what was emitted so progress can be
read back. Exit condition: `.migrate/handoff.json` exists and accounts for
every requirement, the adapter's artifacts are in the target, and `migrate
phase handoff --status done` has run. After that, plain `migrate check`,
with no `--phase`, exits 0, and that is what "the migration is mapped"
means.

This phase does not deliver anything. It hands over.

## Inputs

- `.migrate/requirements.jsonl` and `capabilities.jsonl`: what to emit and
  how to group it.
- `.migrate/config.toml`, `[handoff] adapter`: which medium. Overridable
  per run with `--adapter`.
- Whatever the chosen adapter reaches: the target repo for `markdown`,
  `gh` for `github`, a flow target's own tree for `flow`.

## Procedure

**Choose the adapter once, in config, not per invocation.** `--adapter`
exists for trying one out and for reading coverage back through a different
medium than the one that emitted. Switching the configured adapter mid-run
does not migrate anything that was already emitted; it emits again,
somewhere else.

| Adapter | Emits | Reads progress from |
|---|---|---|
| `markdown` | `docs/migrate/roadmap.md` plus one file per capability | ticked checkboxes in the roadmap, dated in the file |
| `github` | a milestone per capability, an issue per requirement | closed issues, dated from `closedAt` |
| `flow` | `docs/modernisation/capability-map/<slug>.md`, and a fenced block under `## Proposed` in `docs/WORK.md` when the target has one | `flow parity --json` in the target, undated |

**Dry-run first.** `--dry-run` runs every refusal check and prints the plan
without writing anything at all, `handoff.json` included:

```
migrate handoff --dry-run

plan:
  user-directory (3 requirement(s))
handoff: dry run, 1 work item(s), nothing written
```

A capability appears after every capability it cites, which is what
"dependency order" means here: capability A depends on B when a requirement
in A carries a ledger citation to an element the seam assigned to B. If the
graph has a cycle, its members are emitted in slug order and anything merely
blocked by that cycle still sorts normally behind it. The cycle is broken rather
than reported: `dependencyOrder` returns which capabilities were in one, but no
caller prints it today, so a cyclic seam is resolved silently.

**The refusals, and what each means.** Handoff will not emit while anything
is unresolved, and it names every blocker at once rather than one per run:

```
migrate handoff

handoff: [run-state] phase adjudicate is pending; every phase through adjudicate must be done
handoff: [adjudication] q-mailer-unobservable [moderate] is still open; every queue item needs a ruling before handoff
handoff: UD-003 blocked by q-mailer-unobservable
handoff: refusing to emit with 3 blocker(s)
```

The gate run behind this has citations and leaks both switched on, because
both are mandatory before handoff, and is bounded at `adjudicate` so that
gate 12 (which wants the `handoff.json` this command has not written yet)
cannot refuse the very run that would satisfy it.

**"Blocked" is measured against open items, not against the confidence
field.** A requirement blocks handoff when its `confidence` is `queued`, or
its `parity` is a `rubric` below `high`, **and** the queue item it points at
is still open. Once that item is adjudicated the decision is settled and the
requirement stops blocking, even though its confidence still reads `queued`.
This matters in practice: it means a ruling of "leave this one unconfirmed"
does not oblige you to re-import the row before you can hand over.

**Emit.**

```
migrate handoff

handoff: adapter markdown, 1 work item(s), 3 requirement(s)
  created   1
  updated   0
  unchanged 0
next: mark the phase done with `migrate phase handoff --status done`, then read progress back with `migrate coverage`
```

Running it again over an unchanged store reports everything `unchanged` and
writes nothing new. Every adapter is idempotent, and each achieves it
differently: `markdown` compares rendered content, `github` finds its own
issues by a `<!-- migrate:fr=... -->` marker at the start of the body, `flow`
compares rendered content and then validates the result with the target's own
`flow map --check`. A run that rewrote a shared file (the roadmap, `WORK.md`)
reports its items `updated` rather than `unchanged`, so the status always
reflects whether anything in the target moved.

Each adapter owns only what it wrote. `github` regenerates the block above a
closing fence in an issue body and leaves anything you add beneath it alone;
`flow` rewrites only its own fenced block under `## Proposed` and never touches
the rest of `WORK.md`. Editing a file somebody else writes in is the reason
both boundaries are explicit rather than inferred from shape.

**`handoff.json` is the record, and it carries no timestamps.**

```jsonc
{
  "version": 1,
  "adapter": "markdown",
  "items": [
    { "key": "user-directory", "title": "User Directory",
      "frs": ["UD-001", "UD-002", "UD-003"], "dependsOn": [], "weight": 3 }
  ],
  "refs": { "user-directory": "docs/migrate/capabilities/user-directory.md" },
  "basis": { "confirmed": 2, "emitted": 3, "order": ["user-directory"] }
}
```

`emitted` is every requirement that reached a work item; `confirmed` is the
denominator `migrate coverage` divides by, and the two differ by exactly the
requirements handoff emits but parity does not hold the build to. The
absence of dates is deliberate: every date this tool reports is read at read
time from the adapter's medium, which is what lets two runs over one store
produce identical bytes.

**Using the `flow` adapter.** One constraint will catch you before anything
else does. The flow target derives a requirement-id pattern from each
capability's declared `ns` and rejects anything that does not match, so
`plan()` refuses first, by name:

```
handoff: flow: 1 requirement id(s) do not match their capability's namespace pattern <ns>-NNN, which the flow target requires:
  login-001 (capability user-management, ns UM)
```

Nothing is written when that fires. Fix the ids in the store (re-import with
the corrected ids) rather than working around it: the alternative is a
capability file the target cannot parse, in a repo this tool does not own.
The adapter also translates on the way out, since the two vocabularies
differ: `accidental-candidate` becomes `poss-accidental`, and the three
confidence kinds become `Confirmed`, `Inferred` and `Speculative`.

## The gate

Gate 12, `handoff`, asks whether the requirements actually reached the
emitted work. It checks that `handoff.json` exists and is well formed, that
every requirement appears in exactly one work item, that every `frs` entry
resolves to a requirement, that every `dependsOn` resolves to another work item
and is not the item itself, that no work-item key repeats, that every item has
a `refs` entry recording where it went, that `basis.order` and the work items
name the same set, and that the basis counts match the store.

Every requirement, not only the confirmed ones: an inferred requirement is
something the build team must see and decide about, so handoff emits it.
Confidence starts mattering at the coverage denominator, not here.

Like gate 11 it is phase-scoped, so it does not fire below `--phase handoff`
**unless `phases.json` already claims the phase is done**. A store whose own
state file says it reached handoff cannot hide an unemitted handoff by being
checked at an earlier terminus. Its honest limit is the same in kind as the run-state gate's: it
proves the emitted work covers the store's requirements. It cannot prove the
issues were read or the roadmap was believed.

## Reading progress back

`migrate coverage` divides built by confirmed and names its evidence:

```
built 2/2 confirmed requirements (100%)
evidence: markdown roadmap checkboxes, dated in file
excluded: 1 non-confirmed (user-directory 1)

user-directory  2/2  done
```

`migrate forecast` needs an owner-attested `.migrate/forecast-assumptions.md`
(copy `templates/forecast-assumptions.md`) and refuses without one. It
projects from two measured velocities and labels every scenario as measured
or as an owner target, so an aspiration never reads as a fact. Both commands
are meant to be re-run as delivery proceeds; they are the only part of this
tool that keeps working after the mapping run ends.

## Degradation

- **The adapter partially applied.** Re-run it. Every adapter is
  idempotent, and finishing a partial apply by re-running is the designed
  path. For `markdown` specifically, re-running preserves every ticked box
  and its date, so picking up newly extracted requirements never costs the
  owner their record of what was delivered.
- **No flow CLI in the target.** The `flow` adapter still emits, and says on
  stderr that the capability files were not validated against the target's
  own parser. An unvalidated emission must not read as a checked one.
- **`flow` coverage has no dates.** Expected. The flow target computes
  covered from merged slices plus a baseline and keeps the dates in a slice
  ledger this tool does not own, so every completion comes back undated.
  Coverage still works; forecast's measured rows print `not projected` and
  its target rows still project. Use `flow forecast` in the target for the
  dated answer.
- **An adapter with no throughput at all.** `coverage` names it rather than
  reporting zero built. "This adapter cannot tell you" and "nothing has been
  delivered" are very different claims.
- **A completion naming a requirement the store does not have.** `coverage`
  exits 1: the emitted work and the store have diverged, which is a real
  problem rather than a degradation.

## Commands

```
migrate handoff --dry-run
migrate handoff [--adapter <markdown|github|flow>]
migrate phase handoff --status done
migrate check
migrate coverage
migrate forecast
```
