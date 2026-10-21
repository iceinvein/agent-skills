---
type: regex
# The trace carries SKILL.md's own routing table, which names every channel, so
# `contains` passes whenever the skill loads. Anchor on the two ways the agent
# routes instead, the same ones run-stats.sh meters: a Bash call that invokes
# `status.sh route deep` (a quoted mention, as in a grep, does not count), or the
# words opening an assistant message or following a label such as "Sluice:".
pattern: '"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+route(?:\s|\\[nt])+deep(?:\s|\\[nt]|[;&|]|")|"text":"(?:[^.!?\n"]{0,100}[:=]\s*)?[\s*_#>\\]*deep channel'
flags: i
target: trace
weight: 2
---
