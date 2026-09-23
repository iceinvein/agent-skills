---
type: llm
focus: trace
weight: 3
---

The agent was handed a signed-off plan with three tasks left, and pre-flight had
settled that every task goes to its own implementer agent, one at a time.

PASS if the final assistant message comes after the result of the last task's
agent has arrived in the trace, and it reports that result: every remaining task
complete and the suite green.
FAIL if the final message says an agent is still running, that it will report
when a task finishes, or that it is waiting on a result, while any task is
still open; or if it hands back before the last dispatched agent has returned.
