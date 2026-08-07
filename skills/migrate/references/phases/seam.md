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
- The store: `elements.jsonl`, specifically the `refs` and citations already
  recorded on every element from enumerate. Surface-affinity clustering
  builds its graph from exactly this, and nothing else.

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
4. **Surface-affinity clustering.** Build a bipartite graph of surfaces
   against the tables (or equivalent) they touch, read straight off the
   `refs` and citations already sitting in `elements.jsonl`, and run
   community detection over that graph. It needs no parseable code, no
   relational schema, and no VCS history: only the ledger, which by
   construction always exists once enumerate has run. That makes it the
   fallback validator when the other three cannot run at all, and a fourth
   opinion checking the other three when they can.

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
hand-written, the same way `parity-basis.md` is in phase 0.

```json
{"slug": "user-management", "title": "User Management", "ns": "UM", "elements": ["route-get-api-users", "route-post-api-login", "table-users"]}
```

That line, appended to `.migrate/capabilities.jsonl`, is accepted as-is: the
gate checks it for duplicate slugs (the only structural check it gets,
since there is no importer to validate it at write time) and later, in
extract, for every requirement's `cap` resolving to one of these slugs.

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
| Surface-affinity clustering | Only the ledger's `refs` and citations | No degradation case: it needs nothing that is ever absent once enumerate has produced a ledger, so it is always available. |

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
