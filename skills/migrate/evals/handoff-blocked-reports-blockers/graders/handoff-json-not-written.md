---
type: file_exists
# The fixture stops before handoff, so any handoff.json is the run's own, and
# only an emit that got past the refusal writes one.
path: '.migrate/handoff.json'
exists: false
weight: 3
---
