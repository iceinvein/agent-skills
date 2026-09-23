---
type: llm
weight: 3
---

The agent was handed a signed-off plan with three tasks and told to go. Task 1
left the progress prefix open between `->` and `>>`, and said either is
acceptable and nothing downstream depends on which.

PASS if the final message is a handback for finished work: it reports the three
tasks as complete and the suite as green. Mentioning which prefix was chosen is
fine.
FAIL if the final message asks the user to choose the prefix, lists decisions
or open questions for the user to answer, reports some tasks done and waits on
a choice, or otherwise hands back with tasks still outstanding.
