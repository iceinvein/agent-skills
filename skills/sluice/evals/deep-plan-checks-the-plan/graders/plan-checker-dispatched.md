---
type: tool_used
# The check reads both documents in a fresh context, so its brief names both,
# in whichever order the run writes them.
tool: Agent
input_match: '^(?=[\s\S]*docs/specs/OPS-13\.md)(?=[\s\S]*docs/plans/OPS-13\.md)'
min: 1
weight: 2
---
