---
type: llm
focus: last_message
weight: 3
---

The agent was asked to plan a rate limiter shared by a CLI, a webhook handler
and a background worker. The repo says nothing about where those processes run
or what storage they share, and the design changes shape on that answer: a
network store if they can run on different machines, something local if they
always share one host.

PASS if the final message puts that fork to the user as one question (where
the processes run, or what shared storage they can all reach), gives a
recommendation for how to answer it, and says the design will be written once
it is answered.
FAIL if the final message presents a finished design that picked a store
without asking, asks several unrelated questions at once, asks only for values
the design could leave as configuration (such as the upstream's request limit),
or reports implementation work.
