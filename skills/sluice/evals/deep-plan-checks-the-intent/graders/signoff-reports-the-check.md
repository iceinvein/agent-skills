---
type: llm
weight: 2
---

The agent was asked to plan ticket OPS-12 and to write its design to
`docs/specs/OPS-12.md`. Before asking for sign-off, it is expected to have a
fresh-context agent check the spec against the ticket's asks.

PASS if the final message asks for sign-off on the design and says that an
alignment check of the spec against the ticket ran, and what it found (for
example that every ask is covered, or which gaps it raised and how they were
settled).
FAIL if the final message does not ask for sign-off, or asks for it without
mentioning that such a check ran, or mentions the check without saying what it
found.
