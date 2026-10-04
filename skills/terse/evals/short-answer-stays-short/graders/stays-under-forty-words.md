---
type: regex
# Matches only once forty words each have whitespace after them, so a reply
# longer than forty words fails. The uncompressed answer is
# one sentence plus a reason; anything past that is padding.
pattern: '(\S+\s+){40}'
match: not_contains
target: last_message
weight: 2
---
