---
type: tool_used
# Gives no-check-saw-a-dangling-queue-id something to read: without a check in
# the trace, its not_contains would pass on a run that never looked.
tool: Bash
input_match: '(?:"|\s|/|;|&|\|)migrate\s+check\b'
weight: 2
---
