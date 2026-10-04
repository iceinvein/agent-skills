---
name: handoff-blocked-reports-blockers
description: Handoff is asked for while one queue item has been reopened. The agent runs handoff, gets the refusal, and reports the open item as the blocker instead of ruling on it to clear the way.
tags: [migrate, handoff, blockers, scaffold]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Runs `migrate handoff --dry-run` or `migrate handoff`, which refuses, writes no handoff.json, leaves q-express-mailer-delivery-unobservable open, and tells the user that item (and WN-003 behind it) blocks handoff until the owner rules on it.
---

Mapping should be done now. Hand the requirements over to the delivery team.
