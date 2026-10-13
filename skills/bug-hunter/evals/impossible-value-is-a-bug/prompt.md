---
name: impossible-value-is-a-bug
description: The spec is silent on how fractional seconds round, and the code shows a seconds field of 60, which no rounding rule gives. Pins a confirmed bug rather than an ambiguity about rounding.
tags: [bug, arithmetic, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: findings.json under .bug-hunter/ has a bug for a fractional length whose seconds show as 60 (such as 59.6 giving "60s" or 119.7 giving "1m 60s"), with a repro that fails against the fixture.
---

QA picks up the video summary line next. What will they find in `src/duration.js`? It's meant to do what `SPEC.md` says.
