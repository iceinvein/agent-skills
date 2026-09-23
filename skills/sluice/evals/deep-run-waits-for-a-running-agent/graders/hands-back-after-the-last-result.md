---
type: llm
# A final message alone cannot show that it came after the last agent returned;
# the case's every-task-done file grader carries that order instead.
focus: last_message
weight: 3
---

The agent was handed a signed-off plan with three tasks left, and pre-flight had
settled that every task goes to its own implementer agent, one at a time.

PASS if the final message reports every remaining task complete and the suite
green.
FAIL if the final message says an agent is still running, that it will report
when a task finishes, or that it is waiting on a result, while any task is
still open.

Ending the final message on the user's finish choice (merge, open a PR, or
leave the branch as it stands) is part of a handback, not a check-in, and does
not by itself make it a FAIL.
