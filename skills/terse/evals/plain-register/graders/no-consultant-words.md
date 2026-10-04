---
type: regex
# SKILL.md's Register list and the tight-level synonym list, as they appear in
# replies. Matched on the reply only, because the trace carries SKILL.md itself.
pattern: '\b(leverag\w*|utiliz\w*|robust\w*|seamless\w*|comprehensive\w*|holistic\w*|facilitat\w*|delv\w*|landscape|commenc\w*|mitigat\w*|prior to|in order to|due to the fact)\b'
flags: i
match: not_contains
target: last_message
weight: 2
---
