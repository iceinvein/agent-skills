---
type: regex
# As findings-written in proves-a-spec-boundary-bug: the files target holds
# the run directory's date prefix to the shape SKILL.md states.
pattern: '^\.bug-hunter/\d{4}-\d{2}-\d{2}-[^/]+/intent\.md$'
flags: m
target: files
---
