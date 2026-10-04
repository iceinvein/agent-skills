---
type: regex
pattern: '^\W*(sure|certainly|of course|absolutely|great question|good question|happy to|i''d be happy|you''re asking)\b'
flags: i
match: not_contains
target: last_message
---
