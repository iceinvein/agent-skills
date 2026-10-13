# Architecture and proposal checks

## Architecture pages

Each page is Markdown first, HTML generated from it.

- **`architecture/current-architecture.md`:** runtime, background processing,
  delivery and reference data, each its own Mermaid diagram, plus a numbered
  table of the problems the architecture causes: hosting, data storage,
  processing harness, delivery, reference data and edge security. Application
  defects belong in the capability map, not here.
- **`architecture/target-architecture.md`:** the same views for the new
  platform, a sequence diagram for the main flow with numbered steps, and a
  "what changes from today" table keyed to the problems.
- **`architecture/<name>-architecture-comparison.md`:** side by side pairs of
  the same view, glance cards for the headline differences, and the problems
  table. Its job is to show the target is stronger and simpler. Say under the
  table that these are the architecture problems only, with the count of
  capability changes and risk findings and links to them, so the page never
  reads as the whole job.
- **`architecture/design-<topic>.md`** for each fork with the most
  requirements behind it (typically identity, audit, machine identity): the
  options, the decision or the Pending recommendation, the gaps still open.

Mermaid in local HTML: load it from a pinned CDN version, use the base theme
with colours from CSS variables, and show the diagram source when offline.
Wide diagrams become unreadable, and in a side by side pair every diagram is
half width: keep to about three nodes per rank, shorten edge labels, move
detail into bullets, or split one diagram into two. `direction` inside a
subgraph is ignored once edges link to nodes inside it, so link subgraphs to
each other instead.

## Reviewing a proposal

Write `build-plan/<vendor>-proposal-review.md`. Judge the proposal against how
the team builds (platform, tooling, delivery, identity, security services,
compliance claims, cost gaps), as numbered judgements: replace, change, drop,
correct, missing. List what to keep and the questions it raises for the
client. The proposal's own figures may be quoted with a page reference; our
figures come from `schedule.json` and the capability map.

Always check the framing: count the scheduled requirements in areas the
proposal never mentions. A list of hosting or architecture problems presented
as the scope undersells an application rebuild. When the proposal quotes our
estimate, also check every figure against the latest schedule output and the
team shape it assumes.

An editable document (Word, Google Docs) is changed only in a copy, with
tracked changes under the user's name; commercial calls (fees, role titles,
rates) get comments, not edits. A PDF or other fixed document gets the review
file only.

## Keeping it in sync

A decision changes requirements, which changes packages, which changes the
schedule, which changes every page quoting a number. After each decision:
mark it Decided in `decisions.md`, update the requirement files, re-run the
scheduler, then update the slices page, the capability map's open questions
and risks, the architecture pages and any proposal review. Search the
engagement folder for the old figures before saying it is done.
