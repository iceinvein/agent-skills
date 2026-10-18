---
type: regex
pattern: 'magpie handoff [\s\S]*magpie cleanup \S+'
target: { source: file, path: .magpie-calls.log }
weight: 2
---
