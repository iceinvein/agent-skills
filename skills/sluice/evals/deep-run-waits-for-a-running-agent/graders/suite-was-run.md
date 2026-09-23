---
type: tool_used
# The handback judge reads only the last message, so a claim of a green suite
# needs a run behind it. One is enough here: every task goes to an implementer,
# and the controller's own run is the check after the last one returns.
tool: Bash
input_match: '(npm test|node --test)'
min: 1
---
