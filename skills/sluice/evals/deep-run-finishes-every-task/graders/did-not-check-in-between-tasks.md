---
type: llm
weight: 3
---

The agent was handed a signed-off plan with three tasks left and told to go.

PASS if the final message is a handback for finished work: it reports the
remaining tasks as complete and the suite as green.
FAIL if the final message stops partway and asks whether to carry on to the
next task, reports one task done and waits, asks for approval to proceed, or
otherwise hands back with tasks still outstanding for any reason other than a
decision only the user can make.
