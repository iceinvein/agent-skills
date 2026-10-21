---
type: tool_used
# The check runs in a fresh context, so it is an Agent dispatch whose brief
# names the spec it reads. The ground read before the design may also name the
# spec's path, so the brief must name the Intent it checks against as well.
tool: Agent
input_match: '^(?=[\s\S]*OPS-12\.md)(?=[\s\S]*Intent)'
min: 1
weight: 2
---
