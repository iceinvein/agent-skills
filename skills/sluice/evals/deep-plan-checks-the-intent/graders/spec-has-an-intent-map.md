---
type: llm
focus: { source: file, path: docs/specs/OPS-12.md }
weight: 3
---

This is the design for ticket OPS-12, which carries three numbered asks: (1)
every upstream call retries a 429, up to three attempts in all, waiting the
`Retry-After` seconds between them; (2) each retry is logged by the calling
subsystem with the path and the attempt number; (3) the CLI gets a
`--no-retry` flag.

PASS if the design has an Intent section that quotes the ticket's text and
maps each of the three asks, one by one, either to a numbered decision in the
design (headed like `D1.`) or to an Out of scope section with a reason for
leaving it out.
FAIL if there is no Intent section, if it paraphrases the ticket instead of
quoting it, or if any of the three asks is missing from the mapping or mapped
to nothing.
