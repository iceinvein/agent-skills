---
name: scenarios-before-bodies
description: Scenarios are written from intent before the changed code is read, so their expected values cannot be anchored to the body. Pins scenarios.md on disk before any Read of src/discount.js.
tags: [order, intent, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: A write of .bug-hunter/<run>/scenarios.md appears in the trace before the first Read of src/discount.js.
---

What will QA find in `src/discount.js`, going by `SPEC.md`?
