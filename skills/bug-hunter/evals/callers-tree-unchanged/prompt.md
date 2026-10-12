---
name: callers-tree-unchanged
description: The skill hunts in a scratch worktree and writes only under .bug-hunter/. Pins the caller's tree left as it was, with repros written and run along the way.
tags: [tree, worktree, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Every file the run created or changed in the caller's tree is under .bug-hunter/.
---

Hunt for bugs in `src/backoff.js` against `SPEC.md` before QA gets to it.
