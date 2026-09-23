---
type: llm
focus: last_message
weight: 2
---

The run has just rendered the findings report and is handing control back. The report server cannot hold a port open in this sandbox, so the agent may well report the URL as unreachable and point at the rendered file instead; that is not a failure.

PASS if the reply presents the final findings, points the user at the rendered report (its URL or its path on disk), and tells them how to choose what gets posted: ticking findings in the page, or replying `post` in the terminal (naming indices is fine). The turn must end there with nothing posted.
FAIL if the reply posts anything, picks the findings to post itself, runs cleanup, carries on to another stage, or hands back without saying how the user selects findings.
