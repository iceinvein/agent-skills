---
type: tool_order
# The first CLI call that reads where the run stopped has to come before the
# first one that writes to the store. Both sides are anchored to the command
# being invoked (start of the command, or after whitespace, a slash or a shell
# separator), so a quoted mention such as grep 'migrate status' counts for
# neither. A run that never writes anything fails here too: tool_order needs
# both calls, and "carry on" means extract work lands.
before: { tool: Bash, input_match: '(?:"|\s|/|;|&|\|)migrate\s+(?:status|phase)\b' }
after: { tool: Bash, input_match: '(?:"|\s|/|;|&|\|)migrate\s+(?:import|census|queue\s+add|init)\b' }
weight: 3
---
