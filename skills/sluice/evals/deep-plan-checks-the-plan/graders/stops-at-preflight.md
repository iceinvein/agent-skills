---
type: llm
---

The agent was handed a signed-off design and asked to write the plan for it.
The next stop after the plan is the pre-flight questions, asked before any
task starts.

PASS if the final message asks the pre-flight questions (how the run should
proceed, for example how tasks are dispatched or reviewed) and no task has
been started: no source or test file changed, no task reported in progress or
done.
FAIL if the final message reports any task as started or done, moves into
building, or ends without asking the pre-flight questions.
