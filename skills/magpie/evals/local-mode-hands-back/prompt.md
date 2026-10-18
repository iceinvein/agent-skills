---
name: local-mode-hands-back
description: A local review of the current branch, resumed after peer review, hands the findings back as text, archives the run, and stops. There is no PR, so nothing is served, rendered or posted.
tags: [magpie, local, handoff, resume, scaffold]
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Finds the active local run, runs magpie handoff, then magpie cleanup, and replies with both findings and the archive path. Never serves, renders, posts or calls gh.
---

Peer review's finished on the magpie local review of this branch. Take it from there.
