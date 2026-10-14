---
type: regex
# The hunt is the controller's work, so it is recorded in the run record, not
# in run.json: a `## Hunt` section the final review reads. The fixture's record
# has Pre-flight and Log only, and the record is the scaffold's file, which the
# files target never lists, so its content is read directly.
pattern: '^## Hunt\b'
flags: m
target: { source: file, path: docs/plans/2026-10-01-step-retries-record.md }
weight: 2
---
