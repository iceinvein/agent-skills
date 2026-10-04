---
type: tool_used
tool: Bash
# Not a regex over the trace: the trace carries SKILL.md as loaded, and its
# probe section names `migrate init`, so a not_contains there is red on every
# run that fires the skill. Anchored to the command being invoked, as the
# order grader is.
input_match: '(?:"|\s|/|;|&|\|)migrate\s+init\b'
min: 0
max: 0
weight: 2
---
