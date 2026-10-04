---
type: tool_used
tool: Bash
# Either form counts: --dry-run runs every refusal check, and a plain handoff
# against this store refuses (handoff-json-not-written holds that).
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:[\s/;&|(]|\\[nt]))?migrate(?:\s|\\[nt])+handoff(?:\s|\\[nt]|"|[;&|)>])'
weight: 2
---
