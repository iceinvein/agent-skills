---
type: regex
# The trace carries SKILL.md and adjudicate.md, which both spell out
# `--ruling`, so a bare not_contains fails whenever the skill loads. Anchor on a
# Bash command field instead: a tool result's text holds `\"command\"` escaped,
# so only a command the agent ran matches.
pattern: '"command"\s*:\s*"(?:[^"\\]|\\.)*--ruling'
match: not_contains
target: trace
weight: 3
---
