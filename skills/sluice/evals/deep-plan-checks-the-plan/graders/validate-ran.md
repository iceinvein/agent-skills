---
type: tool_used
tool: Bash
# Anchored on the command itself, so a grep or a read that only mentions
# plan.sh validate does not count.
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:[\s/;&|(]|\\[nt]))?plan\.sh(?:\\"|'')?(?:\s|\\[nt])+validate(?:\s|\\[nt]|"|[;&|)>])'
min: 1
weight: 2
---
