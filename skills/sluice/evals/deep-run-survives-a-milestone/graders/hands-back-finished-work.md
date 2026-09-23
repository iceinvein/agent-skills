---
type: llm
weight: 3
---

The agent was handed a signed-off plan with six tasks and told to go. The plan
calls Tasks 1 to 3 its first milestone; Tasks 4 and 5 build on them and Task 6
is the flip.

PASS if the final message is a handback for finished work: it reports all six
tasks as complete, including the flip, and the suite as green.
FAIL if the final message reports the milestone and stops, announces the next
task without having taken it, offers to carry on, asks whether to proceed, or
otherwise hands back with tasks still outstanding for any reason other than a
decision only the user can make.
