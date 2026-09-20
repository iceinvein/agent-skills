---
name: explicit-instruction-collapses-to-fast
description: The same new-interface work as the main case, with an explicit instruction to skip the ceremony. Explicit instruction wins, so it collapses to fast.
tags: [routing, fast, override, scaffold, write]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Announces the fast channel rather than main, and implements the target seam without proposing shapes or writing a design.
---

Deploy only knows how to push to our own boxes. Put the three steps behind a pluggable target so S3 can slot in later. Don't propose anything, don't write it up, just do it.
