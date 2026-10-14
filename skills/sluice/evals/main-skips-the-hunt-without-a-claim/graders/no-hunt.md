---
type: tool_used
tool: Skill
# Not a not_contains regex over the trace: the trace carries SKILL.md as
# loaded, and once the hunt rule lands it names bug-hunter, so a text match
# would be red on every run that fires sluice. Counting Skill calls whose
# input names it sees only an invocation.
input_match: '"skill"\s*:\s*"(?:[\w-]+:)?bug-hunter"'
min: 0
max: 0
weight: 2
---
