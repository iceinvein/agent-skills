---
type: regex
# findings.json sits under a slug the skill picks, so no file target can name
# it; the trace carries its content in the Write call (or shell command) that
# created it. That content is one JSON string in the trace line, its quotes
# escaped as \" and its newlines as \n, and the match is held inside that one
# string. Matches a findings.json write whose "bugs" is an empty array. A file
# written by a dispatched agent counts only if the trace carries that agent's
# tool calls.
pattern: 'findings\.json(?:","content":")?(?:\\.|[^"\\])*?\\"bugs\\":(?:\s|\\n)*\[(?:\s|\\n)*\]'
target: trace
weight: 2
---
