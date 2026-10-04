---
type: regex
pattern: '\b(in summary|to summari[sz]e|in short|tl;dr|to recap|so,? in a nutshell|the key takeaway)\b'
flags: i
match: not_contains
target: last_message
---
