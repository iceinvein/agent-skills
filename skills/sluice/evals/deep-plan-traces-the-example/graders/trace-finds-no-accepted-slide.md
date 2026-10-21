---
type: llm
focus: { source: file, path: docs/specs/DEK-41.md }
weight: 3
---

This is the design for a ticket whose example is "Redraft the Pilot Stages
slide to lead with the pilot outcome" on the smoke deck. In the repo,
`findSlideByTitle` matches only on the title of a slide's accepted version,
only the canvas ever sets `accepted`, and every slide in
`data/decks/smoke.json` has `"accepted": null`. So the lookup the ticket says
to reuse finds no slide for the ticket's own example.

Judge the section under the design's Trace heading for the walk, and the rest
of the design only for the lookup it settles on.

PASS if the Trace section quotes the ticket's example, walks it through the
smoke deck's actual data, and records there that its slides have no accepted
version (so the existing lookup returns nothing), and the design builds the
slide lookup around that, consistent with the
README (an unaccepted slide is called by its latest version): for example,
matching the accepted version's title when there is one and the latest
version's otherwise.
FAIL if there is no Trace section, if the accepted-slide finding appears only
outside it, if the design reuses `findSlideByTitle` or the accepted version as
it stands, or if the accepted state is mentioned only as a general risk
without saying what the smoke deck holds.
