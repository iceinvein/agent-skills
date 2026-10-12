---
type: regex
# The same findings.json write as bugs-empty, read for its ambiguities: one
# whose question asks about the quantity cap (the cap, a maximum or ceiling,
# or the 99 the code uses). The question is matched inside its own \"...\"
# string value. The same closing lookahead as bugs-empty holds the match to
# the last findings.json write.
pattern: 'findings\.json(?:","content":")?(?:\\.|[^"\\])*?\\"ambiguities\\":(?:\\.|[^"\\])*?\\"question\\":(?:\s|\\n)*\\"(?:(?!\\")(?:\\.|[^"\\]))*?(?:\bcap|maximum|\bmax\b|ceiling|\b99\b|\b100\b|upper limit)(?![\s\S]*?(?:findings\.json","(?:content|old_string)":"|>\s*[^"\s]*findings\.json))'
flags: i
target: trace
weight: 2
---
