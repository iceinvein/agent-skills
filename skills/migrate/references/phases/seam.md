# Phase 2: Seam

## Purpose

Partition the ledger into capabilities: the seam the target will be built
along. Two-of-three triangulation across up to four validators, escalating
to the queue on disagreement or low modularity rather than choosing
silently. Exit condition: `capabilities.jsonl`, `seam.json`, and `seam.md`
exist and agree with each other, and `migrate phase seam --status done`
has run.

## Inputs

- `config.toml`: `source.vcs` (whether change-coupling analysis can run at
  all), `source.path` (where the schema and code live for the other two
  validators).
- The store: `elements.jsonl`, specifically the `refs` already recorded on
  every element from enumerate. `requirements.jsonl` does not exist yet at
  this point in the run (extract is the next phase, not this one), so
  `refs` is the only Ref-shaped field seam can read; surface-affinity
  clustering builds its graph from exactly this, and nothing else.

## Procedure

Run whichever of these are available. None of the four is mandatory on its
own; two of whichever ran must agree, at modularity Q >= 0.3, before you
accept a partition (the one-validator exception is below).

1. **Schema clustering.** Cluster tables by foreign-key connectivity, where
   a relational schema exists to read.
2. **Call-graph community detection.** Cluster by static call structure,
   where the code is statically parseable.
3. **Change-coupling analysis.** Cluster by co-change frequency in VCS
   history, where VCS history exists.
4. **Surface-affinity clustering.** Build a graph straight off the `refs`
   already sitting in `elements.jsonl`, and run community detection over
   it. It needs no parseable code, no relational schema, and no VCS
   history: only the ledger, which by construction always exists once
   enumerate has run. That makes it the fallback validator when the other
   three cannot run at all, and a fourth opinion checking the other three
   when they can. The acceptance rule follows immediately below; the
   concrete method and a worked example come after it.

**Triangulate.** Accept a partition when two of the validators that ran
agree with each other, at modularity Q >= 0.3 on the agreed partition.
Disagreement (no two agree) or low Q on the best candidate both escalate to
the queue: name the evidence, the disagreeing outputs or the Q figure, list
the real options, and recommend one. **Vertical-slice-only** (one
capability per user journey, no cross-cutting split) is the ratified
fallback option in that queue item. It is offered for an owner to choose,
never picked silently in its place.

When fewer than two validators can run at all (the fully degraded case:
no schema, no parseable call graph, and no VCS, so only surface-affinity
is left), there is no pair to agree with. That lone validator's own Q
against the 0.3 floor is what "validator of last resort" means in
practice: Q >= 0.3 on its own is accepted with no second opinion behind
it, and Q below 0.3 escalates the same as any other low-Q result. Q here
means whatever the clustering step actually produced, the refinement below
included when a component needed it, never the components-only figure by
default; a lone validator's number that skipped a refinement it needed is
not this case, it is just an unfinished run. This is the only path that
lets one validator's own number close the phase by itself; every other
case still needs the two-agree rule above, including every case where
surface-affinity is merely one of several validators that ran rather than
the only one.

### Surface-affinity clustering, worked

**Build the graph.** One node per element id. One edge for every
`{"kind": "ledger", "id": "..."}` entry in any element's `refs`, connecting
that element to the id it names. This is not a bipartite graph of "surface
types" against "table types" specifically: it is one graph over every
element id that carries a `ledger` ref, whatever surface each end happens
to be, since a job or a screen can touch a table exactly the same way a
route does. No library is required to build it; it is a plain adjacency
map from parsing `elements.jsonl`.

These refs are not something this phase produces itself: they come from
`references/phases/enumerate.md`'s Procedure, step 4, which is where a
lens records that an element it just found touches one already in the
ledger. If that step was skipped for real touches that exist in the
source, this graph has no edge for them, silently; there is no check here
or anywhere else that notices a missing ref, only one (in `enumerate.md`'s
own step 4) that notices a `ledger` ref pointing at an id the ledger does
not yet have.

**Cluster it.** Connected components: two elements with no path of `refs`
between them cannot possibly share a capability, so start by splitting the
graph into its connected pieces. This needs nothing beyond a breadth-first
search, no installed graph library, which matters most here because this
is the validator you reach for when nothing else about the source can be
assumed either. Confirm the split with modularity, using the textbook
formula directly rather than a library call:

```
Q = sum over communities c of [ (edges_within_c / m) - (degree_sum_c / (2m))^2 ]
```

where `m` is the total edge count and `degree_sum_c` is the sum of every
node's degree inside community `c`. `edges_within_c` is just every edge
whose both ends fall inside `c`; when the communities are exactly the
connected components, that is every edge each node has, since a connected
component has no edge leaving it by definition. If one connected component
is still large and its internal structure is not obviously one capability,
the same formula supports going further with a standard greedy modularity
merge (repeatedly join whichever two sub-groups raise Q the most, stop when
no join helps). A sub-group here is a single node inside the component
being refined, not a whole component: every node in that component starts
as its own group, and the merges run only among those. Merging whole
components together, by contrast, can never raise Q, since components
share no edges: the within-community edge count stays exactly what it
was while the squared-degree term only grows. A reader who tries that and
watches Q fall on the first join has learned only that components were the
wrong thing to merge, not that the partition is already the best
available. The first worked example below clears the 0.3 floor on
connected components alone and does not need this refinement; the second,
right after it, does, and runs it to completion.

**Project onto capabilities.** Every node in one community, regardless of
which surface it came from, becomes that capability's `elements` array,
verbatim. No separate step drops the table nodes: a capability's element
list mixing a route id and a table id (as in the `capabilities.jsonl`
example already shown) is exactly what a community looks like once you
stop distinguishing surfaces.

A worked example, run against a real store, of the fully degraded case
above: assume this source has no relational schema, no statically
parseable code, and no VCS history at all, so surface-affinity is the
only validator that can run, and the one-validator exception is what will
license accepting its result. Six elements, imported as one batch: two
routes and a table that only they touch, and a route and a job that only a
different table touches.

```json
{"id": "route-get-api-users", "surface": "routes", "refs": [{"kind": "ledger", "id": "table-users"}], "...": "..."}
{"id": "route-post-api-login", "surface": "routes", "refs": [{"kind": "ledger", "id": "table-users"}], "...": "..."}
{"id": "table-users", "surface": "tables", "refs": [], "...": "..."}
{"id": "route-get-api-invoices", "surface": "routes", "refs": [{"kind": "ledger", "id": "table-invoices"}], "...": "..."}
{"id": "job-nightly-invoice-export", "surface": "jobs", "refs": [{"kind": "ledger", "id": "table-invoices"}], "...": "..."}
{"id": "table-invoices", "surface": "tables", "refs": [], "...": "..."}
```

`migrate import elements` accepts all six (`import elements: 6 added, 0
updated`). A short standard-library script (no `pip install`, no graph
package) reads the four `ledger` refs as edges, finds connected
components by breadth-first search, and computes Q with the formula
above. Its real output, unedited:

```
community 1: ['route-get-api-users', 'route-post-api-login', 'table-users']
community 2: ['job-nightly-invoice-export', 'route-get-api-invoices', 'table-invoices']
m (total edges) = 4
modularity Q = 0.5
```

`0.5 >= 0.3`, and since no schema, call graph, or VCS history exists for
this source, surface-affinity is the only validator that ran: the
one-validator exception above, not the ordinary two-agree rule, is what
licenses accepting this split on that number alone. Each community becomes
one capability, its node set copied straight into `elements`:

```json
{"slug": "user-management", "title": "User Management", "ns": "UM", "elements": ["route-get-api-users", "route-post-api-login", "table-users"]}
{"slug": "invoicing", "title": "Invoicing", "ns": "INV", "elements": ["job-nightly-invoice-export", "route-get-api-invoices", "table-invoices"]}
```

Both lines, appended to `.migrate/capabilities.jsonl`, are accepted as-is.
Had this source had a schema or a parseable call graph to try as well, or
had any second validator disagreed with this one, the ordinary two-agree
rule above would govern instead, and this Q alone would not have been
enough.

A second worked example, where connected components alone do not clear the
floor and the refinement above does: `fixtures/tiny-webforms`, built from
the refs `GROUND-TRUTH.md`'s "Element-to-element touches" section documents
and `scripts/__tests__/e2e-webforms.test.ts` records by hand, the same way a
lens would. Twelve of this fixture's sixteen elements carry or receive a
ref; the other four have none and drop out as edgeless singleton
components, which contribute nothing to Q, so they are left out of the
listing below. `m = 10` edges. A standard-library script builds the graph
from those refs, finds components by breadth-first search, and computes Q
with the formula above. Its real output, unedited:

```
component 1 (n=10): integration-billing-sync, report-daily-users,
  route-get-api-users, route-get-api-users-id-welcome, route-post-api-users,
  screen-default, screen-users, setting-welcome-email-enabled, table-users,
  workflow-signup-welcome
component 2 (n=2): job-nightly-digest, table-audit-log
m (total edges) = 10
components-only Q = 0.180
```

`0.18 < 0.3`: on connected components alone, this seam would escalate. The
ten-node component is the one that is "still large and its internal
structure is not obviously one capability" (five different surfaces mixed
with no visible split); the two-node component is left alone, since a job
and the one table it purges is already obviously one capability. Every node
in the ten-node component starts as its own group, per the clause above,
and the standard greedy merge runs from there. Its real output, unedited:

```
merge 1: {report-daily-users} + {table-users} -> Q = 0.070
merge 2: {route-post-api-users} + {screen-default} -> Q = 0.155
merge 3: {setting-welcome-email-enabled} + {workflow-signup-welcome} -> Q = 0.240
merge 4: {integration-billing-sync} + {route-get-api-users-id-welcome} -> Q = 0.325
merge 5: {route-get-api-users} + {report-daily-users, table-users} -> Q = 0.405
merge 6: {screen-users} + {integration-billing-sync, route-get-api-users-id-welcome} -> Q = 0.485
merge 7: {route-post-api-users, screen-default} + {setting-welcome-email-enabled, workflow-signup-welcome} -> Q = 0.505
no further join raises Q; stopping
```

Final partition: `{job-nightly-digest, table-audit-log}`,
`{report-daily-users, route-get-api-users, table-users}`,
`{integration-billing-sync, route-get-api-users-id-welcome,
screen-users}`, `{route-post-api-users, screen-default,
setting-welcome-email-enabled, workflow-signup-welcome}`, at `Q = 0.505`.
`0.505 >= 0.3`: the refinement is what clears the floor here, not the
components-only figure, and merging whole components (the no-op the clause
above warns against) would only have found the wrong answer, not a
conservative one.

**Evidence.** Every validator's script (the actual command or program run,
not a description of it) and its raw output goes into `.migrate/seam.md`,
verbatim, so a reviewer can retrace exactly what ran and what it found.
This is prose because it is an audit trail, not a count anything balances.

**Write the partition by hand.** There is no `seam` verb: nothing in the
CLI writes `capabilities.jsonl`, `seam.json`, or `seam.md`. All three are
hand-written, the same way `parity-basis.md` is in phase 0. Whichever
validator produced the accepted partition (the worked example above shows
surface-affinity; a schema-clustering or call-graph result is written the
same way), each community becomes one line. The gate checks the file for
duplicate slugs (the only structural check it gets, since there is no
importer to validate it at write time) and later, in extract, for every
requirement's `cap` resolving to one of these slugs.

`seam.json`'s shape is in `docs/reference.md`'s store artifacts section.
Unlike `capabilities.jsonl`, no gate reads `seam.json` or `seam.md` at
all, not for duplicate slugs, not for anything: `check.ts` contains no
mention of either file. Both are trusted entirely on the strength of
whoever wrote them, the same as `parity-basis.md`.

## What closes it

There is no census kind for seam either: not a lens, an attribute, a
rule-sweep, or a closer. The phase closes on the three artifacts existing
and the status flip, the same shape as probe:

```
migrate phase seam --status done
```

`migrate phase seam --status done` succeeds even if `enumerate` is not
`done` yet: the status setter does not check its predecessor. `migrate
check` does. A real run against a store where `enumerate` was still
`running` when `seam` was flipped to `done` reported:

```
run-state:
  phase enumerate is running; every phase through seam must be done
```

That is the mechanism behind `SKILL.md`'s "do not skip ahead": nothing
stops you from flipping phases out of order, but `check --phase seam` (or
later, plain `check`) names exactly which predecessor is not finished.

## Degradation

| Validator | Needs | If unavailable |
|---|---|---|
| Schema clustering | A parseable relational schema | Folds into the combined case below; the spec does not give schema clustering its own degradation separate from call-graph detection. |
| Call-graph community detection | Statically parseable code | Same combined case. |
| Change-coupling analysis | VCS history | Records `not-applicable` in `seam.md`, with the reason. The remaining validators must still reach two in agreement; change-coupling cannot be counted toward that two. |
| Surface-affinity clustering | Only the ledger's `refs` | No degradation case: it needs nothing that is ever absent once enumerate has produced a ledger, so it is always available. |

**Combined case: no parseable call graph and no relational schema.** If
VCS history still exists, change-coupling and surface-affinity are the two
left, and both must agree at Q >= 0.3. If VCS is also absent,
surface-affinity is the only validator that can run at all, and its own Q
against the 0.3 floor is the whole test (above). A real source with none
of the three (a COBOL system delivered as a flat-file export, no VCS)
escalates like this when that lone Q comes in low:

```markdown
---
id: q-seam-low-modularity
severity: critical
status: open
---

## Evidence

Neither a relational schema nor statically parseable code exists in this
source (COBOL delivered as a flat-file export, no VCS history). Surface
affinity clustering, the only validator that could run at all, produced
modularity Q = 0.21 on connected components; the largest component was
still large and not obviously one capability, so the greedy refinement
above was run against it too, and stopped at the same Q = 0.21, no join
raising it. That figure, not a components-only one, is below the 0.3
floor, and there is no second opinion available to triangulate against.

## Options

(a) Accept the low-Q surface-affinity partition anyway. (b) Re-run
surface-affinity clustering with a coarser resolution parameter and see if
Q improves. (c) Fall back to vertical-slice-only: one capability per user
journey, no cross-cutting split.

## Recommendation

Recommend (c), vertical-slice-only, since no validator reached the 0.3
floor and there is nothing else here to triangulate against.
```

`migrate queue add q-seam-low-modularity.md` accepts this file and prints
`queue add: q-seam-low-modularity [critical]`.

## Commands

```
migrate queue add <item.md>
migrate phase seam --status done
```

`queue add` runs only when triangulation disagrees or Q stays below 0.3;
`capabilities.jsonl`, `seam.json`, and `seam.md` are written by hand
regardless, with no command for either.
