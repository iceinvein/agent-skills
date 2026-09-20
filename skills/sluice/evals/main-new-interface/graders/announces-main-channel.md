---
type: regex
# The trace carries SKILL.md's own routing table, which names every channel, so
# `contains` passes whenever the skill loads. Anchor on how the agent says it
# instead, the same anchor run-stats.sh meters: the words open an assistant
# message, or follow a label such as "Sluice:" on the same line.
pattern: '"text":"(?:[^.!?\n"]{0,100}[:=]\s*)?[\s*_#>\\]*main channel'
flags: i
target: trace
weight: 2
---
