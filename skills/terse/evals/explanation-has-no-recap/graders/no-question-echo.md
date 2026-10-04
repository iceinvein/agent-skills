---
type: regex
pattern: '^\W*(you''re (asking|wondering|seeing)|the question is|this is a (common|classic|well-known))'
flags: i
match: not_contains
target: last_message
---
