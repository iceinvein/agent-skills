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
   when they can. The concrete method, and a worked example run against a
   real store, are below.

### Surface-affinity clustering, worked

**Build the graph.** One node per element id. One edge for every
`{"kind": "ledger", "id": "..."}` entry in any element's `refs`, connecting
that element to the id it names. This is not a bipartite graph of "surface
types" against "table types" specifically: it is one graph over every
element id that carries a `ledger` ref, whatever surface each end happens
to be, since a job or a screen can touch a table exactly the same way a
route does. No library is required to build it; it is a plain adjacency
map from parsing `elements.jsonl`.

**Cluster it.** Connected components: two elements with no path of `refs`
between them cannot possibly share a capability, so start by splitting the
graph into its connected pieces. This needs nothing beyond a breadth-first
search, no installed graph library, which matters most here because this
is the validator you reach for when nothing else about the source can be
assumed either. Confirm the split with modularity, using the textbook
formula directly rather than a library call:

```
Q = sum over communities c of [ (edges_within_c / m) - (degree_sum_c / 2m)^2 ]
```

where `m` is the total edge count and `degree_sum_c` is the sum of every
node's degree inside community `c`. `edges_within_c` is just every edge
whose both ends fall inside `c`; when the communities are exactly the
connected components, that is every edge each node has, since a connected
component has no edge leaving it by definition. If one connected component
is still large and its
internal structure is not obviously one capability, the same formula
supports going further with a standard greedy modularity merge (repeatedly
join whichever two sub-groups raise Q the most, stop when no join helps);
that refinement was not needed for the worked example below because
connected components alone already cleared the 0.3 floor.

**Project onto capabilities.** Every node in one community, regardless of
which surface it came from, becomes that capability's `elements` array,
verbatim. No separate step drops the table nodes: a capability's element
list mixing a route id and a table id (as in the `capabilities.jsonl`
example already shown) is exactly what a community looks like once you
stop distinguishing surfaces.

A worked example, run against a real store. Six elements, imported as one
batch: two routes and a table that only they touch, and a route and a job
that only a different table touches.

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

`0.5 >= 0.3`: accept the split. Each community becomes one capability, its
node set copied straight into `elements`:

```json
{"slug": "user-management", "title": "User Management", "ns": "UM", "elements": ["route-get-api-users", "route-post-api-login", "table-users"]}
{"slug": "invoicing", "title": "Invoicing", "ns": "INV", "elements": ["job-nightly-invoice-export", "route-get-api-invoices", "table-invoices"]}
```

Both lines, appended to `.migrate/capabilities.jsonl`, are accepted as-is.

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
it, and Q below 0.3 escalates the same as any other low-Q result.

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
modularity Q = 0.21 against its own partition, below the 0.3 floor. There
is no second opinion available to triangulate against.

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
