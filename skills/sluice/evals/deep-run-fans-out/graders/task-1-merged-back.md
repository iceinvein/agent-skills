---
type: regex
# Task 1 commits in its own worktree, so this file reaches the run's tree only
# when that branch is merged back. The files target cannot show it: it lists
# only paths Claude created, and a merge is not certain to count.
pattern: '\bformatDuration\b'
target: { source: file, path: src/cli/duration.js }
---
