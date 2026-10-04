---
type: regex
# The fixture's copy of the source. Red here means the scaffold failed, not
# the run.
pattern: "require\\('express'\\)"
target: { source: file, path: legacy/app.js }
---
