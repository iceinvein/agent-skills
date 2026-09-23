---
name: deep-run-blocks-on-a-real-decision
description: The one reason a deep run may end a turn mid-plan. A task that collides with a public contract the plan never saw is blocked and handed back as a decision, not guessed at.
tags: [routing, deep, execution, blocked, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Tasks 2 and 3 land, Task 4 is marked blocked, and the turn ends on one question with options. The public-API test is left exactly as it was.
---

Plan's signed off and pre-flight's answered, it's all in `.sluice/run.json`. Go.
