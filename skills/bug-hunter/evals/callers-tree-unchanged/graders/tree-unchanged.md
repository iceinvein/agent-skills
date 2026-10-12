---
type: regex
# A grader cannot run `git status --porcelain`, so this reads the harness's own
# list of files the run created or changed in the working directory, one path
# per line, relative to it. It is stricter than porcelain: a file .gitignore
# hides still shows here. .git/ is excluded because git keeps its worktree
# bookkeeping there and porcelain never reports it. Fails on any line naming a
# path outside .bug-hunter/.
pattern: '^(?!\.bug-hunter/|\.git/).+'
flags: m
match: not_contains
target: files
weight: 3
---
