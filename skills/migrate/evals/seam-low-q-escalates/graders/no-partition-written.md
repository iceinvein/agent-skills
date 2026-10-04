---
type: regex
# Escalating means no capability is written until the owner picks one. The
# fixture leaves capabilities.jsonl empty, so any slug here was written by the
# run.
pattern: '"slug"'
match: not_contains
target: { source: file, path: .migrate/capabilities.jsonl }
weight: 3
---
