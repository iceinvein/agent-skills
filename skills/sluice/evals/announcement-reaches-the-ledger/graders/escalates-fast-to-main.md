---
type: tool_order
# The escalation only reaches the ledger if both routes go through status.sh,
# in this order: fast for the flag as asked, then main once the contributing
# rule turns it into a new export. Anchored as the announces graders are: the
# script has to be invoked at the start of the command or after whitespace or
# a slash, so a quoted mention such as grep 'status.sh route fast' does not
# count.
before: { tool: Bash, input_match: '"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+route(?:\s|\\[nt])+fast(?:\s|\\[nt]|[;&|'']|\\"|")' }
after: { tool: Bash, input_match: '"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+route(?:\s|\\[nt])+main(?:\s|\\[nt]|[;&|'']|\\"|")' }
weight: 3
---
