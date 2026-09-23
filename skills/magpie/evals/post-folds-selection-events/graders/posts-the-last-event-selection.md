---
type: regex
pattern: 'magpie post [^\n]*--ids (bugs-1,perf-1|perf-1,bugs-1)\b'
target: { source: file, path: .magpie-calls.log }
weight: 3
---
