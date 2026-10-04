---
type: regex
# phases.json is JSON.stringify(file, null, 2): "status" is the first key in
# each phase's object, on the line after the phase name.
pattern: '"seam":\s*\{\s*"status":\s*"done"'
match: not_contains
target: { source: file, path: .migrate/phases.json }
weight: 3
---
