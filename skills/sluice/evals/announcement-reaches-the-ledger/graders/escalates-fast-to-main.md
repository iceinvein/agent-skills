---
type: tool_order
# The escalation only reaches the ledger if both routes go through status.sh,
# in this order: fast for the flag as asked, then main once the contributing
# rule turns it into a new export.
before: { tool: Bash, input_match: 'status\.sh\s+route\s+fast' }
after: { tool: Bash, input_match: 'status\.sh\s+route\s+main' }
weight: 3
---
