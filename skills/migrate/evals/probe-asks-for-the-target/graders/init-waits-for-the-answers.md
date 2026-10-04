---
type: tool_used
# SKILL.md and probe.md: init takes --name, an interview answer, so it runs
# only once the operator has answered. Anchored to the command being invoked,
# so the skill's own text in the trace cannot match.
tool: Bash
input_match: '(?:"|\s|/|;|&|\|)migrate\s+init\b'
min: 0
max: 0
weight: 2
---
