---
type: regex
# As task-1-merged-back. args.js comes from the scaffold, so only its content
# can show Task 2 arrived; the files target never lists a file Claude only
# modified.
pattern: '\btimings\b'
target: { source: file, path: src/cli/args.js }
---
