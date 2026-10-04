---
type: tool_used
tool: Bash
# `migrate adjudicate` with nothing after it but a separator, a redirect or the
# end of the command: the review sheet, not a ruling on one id.
input_match: '"command"\s*:\s*"(?:(?:[^"\\]|\\.)*?(?:[\s/;&|(]|\\[nt]))?migrate(?:\s|\\[nt])+adjudicate(?:\s|\\[nt])*(?:"|[;&|)>]|2>|\\[nt])'
weight: 2
---
