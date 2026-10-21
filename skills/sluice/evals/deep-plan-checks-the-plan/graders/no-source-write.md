---
type: tool_used
# The run plans and stops at pre-flight, so no Write may land under src/ or
# tests/. Bash is allowed here so plan.sh validate can run, and the
# stops-at-preflight judge covers a change made through it.
tool: Write
input_match: '"file_path"\s*:\s*"(?:[^"]*/)?(?:src|tests)/'
min: 0
max: 0
weight: 2
---
