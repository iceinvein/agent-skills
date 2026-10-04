---
type: regex
# The fixture writes an empty capabilities.jsonl, so this reads a real file
# whether the run partitioned or escalated. Either is a correct seam outcome;
# the pinned behaviour is that the shared setting lands in no capability.
pattern: 'setting-default-connection'
match: not_contains
target: { source: file, path: .migrate/capabilities.jsonl }
weight: 3
---
