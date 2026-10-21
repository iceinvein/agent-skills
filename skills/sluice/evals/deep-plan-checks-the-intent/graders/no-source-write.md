---
type: tool_used
# The run plans and stops for sign-off, so no Write may land under src/ or
# tests/. Bash is left out of the case's tools, so these two are the only ways
# code could change.
tool: Write
input_match: '"file_path"\s*:\s*"(?:[^"]*/)?(?:src|tests)/'
min: 0
max: 0
weight: 2
---
