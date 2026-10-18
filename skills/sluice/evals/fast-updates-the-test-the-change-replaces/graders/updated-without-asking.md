---
type: regex
# The request already replaces the behaviour the red test pins, so the
# agreement exists and asking again is the failure. Matches only a trace with
# no AskUserQuestion call anywhere in it; SKILL.md's own mentions of the tool
# reach the trace escaped inside a tool result, so they do not trip it.
pattern: '^(?![\s\S]*"name":"AskUserQuestion")'
target: trace
---
