---
name: resume-reads-status-first
description: A run stopped part way through extract. Resuming reads where it stopped from migrate status or migrate phase before writing anything, and never re-runs init over the live store.
tags: [migrate, resume, extract, scaffold]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Runs migrate status or migrate phase before any import, census, queue add or init; picks up extract at the two capabilities not yet mined; leaves config.toml as it was and never runs migrate init.
---

The migration of ./legacy got cut off partway through yesterday. Can you carry on with it?
