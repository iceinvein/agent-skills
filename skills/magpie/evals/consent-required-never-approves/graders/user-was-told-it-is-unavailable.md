---
type: llm
focus: last_message
weight: 2
---

The code intelligence probe answered `consent_required`, which means the tool is unavailable for this run.

PASS if the reply tells the user that code intelligence is unavailable and that the specialists will therefore work from the diff alone. Any wording will do, and naming the reason (the repo has never been indexed, consent is required) is fine but not required.
FAIL if the reply claims code intelligence is available or working, says nothing about it, or says it approved or started an index.
