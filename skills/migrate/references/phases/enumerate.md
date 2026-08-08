# Phase 1: Enumerate

## Purpose

Enumerate every surface declared in `[surfaces].types`, add every element
found to the ledger `unaccounted`, and close each surface with one lens
census record. Exit condition: every declared surface has exactly one
`lens` census record, its arithmetic balances and stays in bounds, and
`migrate phase enumerate --status done` has run.

## Inputs

- `config.toml`: `[surfaces].types` (which surfaces you owe a census
  record), `[surfaces.singular]` (id-prefix overrides for a surface that is
  already singular but ends in `s`), `source.stack` (which recipe, if any,
  names this surface's directions), `source.path`.
- The store: `elements.jsonl` for this surface (what the ledger already
  holds, so a new candidate can be diffed against it rather than re-added),
  `phases.json` (which batches have already committed, for resuming).

## Procedure

**The lens contract, stated once.** A lens declares
`{surface, directions[], classify, census}`. It enumerates the surface from
at least two independent directions, dedupes into one list, diffs that list
against the ledger, and classifies every difference as exactly one of
**add**, **skip with a named reason**, or **queue**. It closes by writing a
census record. Nothing is silently dropped, and the CLI does the
subtraction, not you.

1. **Enumerate from at least two independent directions.** A direction is
   whatever independent method produced a count: `grep CREATE TABLE across
   *.sql` is one; `grep DbSet<> in the DbContext` is another. They do not
   have to be different lenses in the `code`/`nav`/`docs`/`runtime` sense
   used on element rows; two different greps against two different source
   artifacts, both read by the same `code` lens, count as two directions.
   `migrate census` rejects a record with fewer than two, and rejects the
   Milestone 1 bare-count shape (`{"ddl": 43}`) by name if you write it out
   of habit.

2. **Name the evidence.** Every direction's `evidence` field names the
   command or method that produced its count, not just the number. Nothing
   executes it: the CLI never re-runs `grep CREATE TABLE`, it only checks
   that the field is a non-empty string. The requirement exists so a
   reviewer, or you on a later pass, can retrace the count by hand, not so
   the tool can verify it automatically.

3. **Dedupe, diff, classify.** Merge the directions' findings into one list.
   Diff against what `elements.jsonl` already holds for this surface. For
   everything new, decide: **add** it (import as a new element,
   `unaccounted`), **skip** it with a named reason (framework-owned,
   out-of-scope by design, and so on), or **queue** it (open a queue item
   when the right disposition is not yours to decide alone).

4. **Record what an added element touches.** When a lens finds an element
   that reads, writes, or otherwise depends on an element already in the
   ledger, add a `{"kind": "ledger", "id": "<the other element's id>"}`
   entry to this element's `refs`. A route that reads a table records a ref
   to that table's id. A job that writes one does the same. A screen that
   posts to a route does the same.

   State plainly what this is for, because it reads like bookkeeping
   otherwise, and gets skipped: this is the only edge data the seam phase's
   fallback validator, surface-affinity clustering, has to build a graph
   from (`references/phases/seam.md`). It clusters the ledger against
   itself using exactly these refs and nothing else. A lens that finds a
   real touch and does not record it does not just weaken that validator,
   it disarms it outright: the graph it builds has no edges at all if no
   lens ever writes one.

   **Ordering is not a reason to skip this.** A lens enumerating routes may
   find a route touching a table whose element the tables lens has not
   added yet. Record the ref anyway, pointing at the id you expect that
   table to receive (`<singular>-<slug>`, the same convention every element
   id follows). A `ledger` ref naming an id not yet in the ledger is
   expected mid-enumerate, and resolves once the other lens's batch lands.
   Nothing rejects it on either end at this phase: `migrate import
   elements` validates that a `ledger` ref carries a string `id`, not that
   the id already exists, and `check.ts`'s `refs` gate resolves a `ledger`
   *citation* on a requirement against the ledger, but never reads an
   element's own `refs` at all, so nothing checks that one element's ref
   resolves to another. That is a real gap, not a guarantee in disguise;
   this manual does not add a check to close it, and seam is where a
   dangling ref would first actually matter.

5. **Declare `"phase": "enumerate"` on the record, not the batch's phase or
   any other.** A lens census must declare `enumerate`; nothing else is
   accepted. This is enforced at write time, by name: `migrate census`
   rejects `"phase": "extract"` on a `lens` record with `lens census must
   declare phase "enumerate", the only phase gate 10 (run-state) checks its
   batch against; found "extract"`, before it can ever name a batch that
   gate would silently fail to find. The gate hardcodes exactly one phase
   to look in for a lens's batch (`enumerate`) and one for a closer's
   (`extract`), never the record's own `phase` field, so the constraint at
   write time is what keeps the two from disagreeing later.

6. **Sanity-check the arithmetic before you submit.** Two checks the CLI
   will run for you, so run them yourself first and you will not get
   rejected:

   - Balance: `total == in_ledger + added + skipped.length + queued.length`.
   - Bounds: `max(directions) <= total <= sum(directions)`. A deduped union
     can never be smaller than its largest input (dedup only removes
     duplicates) or larger than their concatenation (dedup can only
     shrink). `total` itself stays unverifiable either way: nothing on this
     side of the source can confirm the legacy system really has exactly
     that many tables. The bound only rules out the arithmetically
     impossible.

   A worked example, run against a real store: two elements found, one
   route by `code` alone and one by both `code` and `nav`, nothing skipped
   or queued.

   ```json
   {
     "kind": "lens",
     "surface": "routes",
     "phase": "enumerate",
     "directions": {
       "code": { "count": 2, "evidence": "grep [HttpGet]/[HttpPost] attributes across Controllers/*.cs" },
       "nav": { "count": 2, "evidence": "walked route registrations in Startup.cs and Swagger UI" }
     },
     "total": 2,
     "in_ledger": 0,
     "added": 2,
     "skipped": [],
     "queued": [],
     "batch": "b-routes-census-001"
   }
   ```

   `migrate census routes.json` accepts this and prints
   `census: recorded lens:routes`. Balance: `2 == 0 + 2 + 0 + 0`. Bounds:
   `max(2, 2) = 2 <= 2 <= sum(2, 2) = 4`.

### Naming skipped elements

`skipped` element names are compared after trimming and case folding, so
`"__efmigrationshistory"` and `" __EFMigrationsHistory"` collide and are
correctly rejected, run against a real store, as the same entry recorded
twice: `skipped element __efmigrationshistory appears 2 times
(__efmigrationshistory,  __EFMigrationsHistory)`. What that comparison
cannot catch is two genuinely different spellings of one real element:
`"__efmigrationshistory"` and `"EF Migrations History (framework)"` name
the same table, but neither trims nor case-folds into the other, and a
real census carrying both as separate `skipped` entries is accepted
outright, with no violation at all. This is a documented limit, not a bug
to chase: free text naming real things in a legacy source cannot be made
padding-proof in general, and Milestone 2 chose convention over
engineering here on purpose.

The convention: **name a skipped element with the source's own identifier,
verbatim, lowercased. No qualifiers, no display names.**

- Right: `"__efmigrationshistory"` (the table's real name, lowercased,
  nothing added or removed).
- Wrong: `"EF Migrations History (framework)"` (a description someone
  wrote instead of the identifier; a different lens run skipping the same
  table under this spelling produces an undetected duplicate skip, not a
  caught one).

This does not fix the gap; it narrows how often it bites. If everyone
writing a `skipped` entry uses the source's own name, any repeat is far more
likely to be a pure case or whitespace variant, which the comparison does
catch, rather than a synonym, which it does not.

### Zero-findings rule

A lens that finds nothing still closes with a census record, not silence.
Every direction reports `{"count": 0, "evidence": "..."}` naming what you
searched and where, and `total`, `in_ledger`, `added`, `skipped`, and
`queued` are all zero or empty. This is accepted:

```json
{
  "kind": "lens",
  "surface": "jobs",
  "phase": "enumerate",
  "directions": {
    "code": { "count": 0, "evidence": "grep [Cron]/[Trigger]/IHostedService across the source tree: no matches" },
    "docs": { "count": 0, "evidence": "grep 'scheduled job' and 'batch job' across docs/: no matches" }
  },
  "total": 0,
  "in_ledger": 0,
  "added": 0,
  "skipped": [],
  "queued": [],
  "batch": "b-jobs-census-001"
}
```

Without this record, `migrate check` cannot tell "no jobs exist in this
source" apart from "the jobs lens never ran." With it, the absence is a
recorded finding, not a gap.

### Contract-only mode

`source.stack` is `unknown`, or is a stack with no recipe pack. There is no
"no recipe" degradation that produces one lens and a shrug: you derive your
own at least two directions for the surface (whatever two independent ways
of finding, say, tables actually apply to this source) and the census gates
them exactly as it would a recipe's own directions. Contract-only is not a
lesser path; it is the same contract with the directions supplied by you
instead of by a recipe file.

### Fanout

Fanout unit is (surface x lens): one agent per pairing. A surface's one
lens census record aggregates the directions from however many (surface,
lens) dispatches actually ran for it. See `references/run-ops.md` for
dispatch, batching, and checkpoint mechanics; this manual does not restate
them.

## What closes it

Every declared surface needs exactly one `lens` census record. Import the
batch, then close the surface:

```
migrate import elements batch-routes.json
migrate census census-routes.json
```

Real output from both, run against a scratch store:

```
import elements: 2 added, 0 updated, batch b-routes-code-001
census: recorded lens:routes
```

Mid-run, `migrate check --phase enumerate` will not read as clean, and that
is expected, not a defect. Run against this store with only `routes` and
`tables` closed, and `enumerate` not yet flipped to `done`, it reported all
of this:

```
0/3 mapped, 0 out-of-scope, 3 unaccounted

Violations (13):
  coverage:
    route-get-api-users (routes) is still unaccounted
    route-post-api-login (routes) is still unaccounted
    table-users (tables) is still unaccounted
  census:
    declared surface jobs has no lens census record; the lens did not run or did not close
    declared surface reports has no lens census record; the lens did not run or did not close
    declared surface screens has no lens census record; the lens did not run or did not close
    declared surface integrations has no lens census record; the lens did not run or did not close
    declared surface workflows has no lens census record; the lens did not run or did not close
    declared surface settings has no lens census record; the lens did not run or did not close
    declared closer cross-capability-workflow has no census record
    declared closer scope-injection has no census record
    declared closer read-write-symmetry has no census record
  run-state:
    phase enumerate is running; every phase through enumerate must be done
```

Read this by gate, not by exit code, while a phase is still open. `census`
naming every surface and closer you have not reached yet is the whole
store being read regardless of `--phase`, the same behavior `SKILL.md`
describes; it clears only once every declared surface and closer actually
has a record, no matter when you flip the phase status. `coverage` naming
your just-imported elements as unaccounted is equally expected, and it
clears on a different schedule again: nothing disposes an element before
extract, so it stays noisy through the whole of this phase regardless.
`run-state` is the one line that is really about *this* phase's own
status, and it is also the only one of the three that clears the moment
you flip it. Once every declared surface has closed, flip it:

```
migrate phase enumerate --status done
```

## Degradation

- **No recipe for the detected stack.** Contract-only mode (above): derive
  your own directions, the census still gates identically.
- **No runtime environment.** The `runtime` lens records `not-applicable`
  with the reason; enumerate this surface from whichever other directions
  remain, and you still need at least two.
- **No documentation.** The `docs` lens records `not-applicable:no-documentation`.
- **A lens with zero findings.** Record that fact explicitly (above); it is
  a finding, not an absence of one.

## Commands

```
migrate import elements <batch.json>
migrate census <lens-record.json>
migrate phase enumerate --status done
```
