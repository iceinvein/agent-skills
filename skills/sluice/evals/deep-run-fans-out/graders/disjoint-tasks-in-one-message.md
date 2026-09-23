---
type: llm
focus: trace
weight: 3
---

The agent was handed a signed-off plan with four tasks. Tasks 1 to 3 have
disjoint Touches and no Needs between them; Task 4 is the flip and needs all
three. Pre-flight had settled on one worktree per concurrent implementer.

PASS if Tasks 1, 2 and 3 were each dispatched to their own agent and all three
dispatches went out in the same assistant message, so they ran at once, with
Task 4 dispatched only after they had landed.
FAIL if the three were dispatched one message at a time, if the controller
implemented any of them itself, or if Task 4 went out alongside them.
