---
type: tool_used
tool: Bash
# migrate check invoked (start of the command, or after whitespace, a slash or
# a shell separator) with no --phase before the next separator or the end of
# the command. Other flags (--leaks, --citations) are allowed. A run that only
# reads migrate status or migrate phase, or only runs check --phase <p>, fails.
input_match: '(?:"|\s|/|;|&|\|)migrate\s+check(?!(?:[^"\\;&|]|\\[^n])*--phase)(?:\s|"|;|&|\||\\n)'
weight: 3
---
