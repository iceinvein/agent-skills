---
type: regex
# findings.json sits under a slug the skill picks, so no file target can name
# it; the trace carries its content in the Write call (or shell command) that
# created it. That content is one JSON string in the trace line, its quotes
# escaped as \" and its newlines as \n, and the match is held inside that one
# string. Matches a findings.json write whose "bugs" is an empty array, and
# only the last one: the closing lookahead fails the match if any later
# findings.json write follows (a Write, its echoed result, an Edit, or a shell
# redirect), so an empty first draft rewritten with bugs does not pass. A Write
# is echoed in full by its tool result, so the last Write still matches there.
# A later Edit fails the grader, since an Edit's result does not carry the
# whole file. A file written by a dispatched agent counts only if the trace
# carries that agent's tool calls.
pattern: 'findings\.json(?:","content":")?(?:\\.|[^"\\])*?\\"bugs\\":(?:\s|\\n)*\[(?:\s|\\n)*\](?![\s\S]*?(?:findings\.json","(?:content|old_string)":"|>\s*[^"\s]*findings\.json))'
target: trace
weight: 2
---
