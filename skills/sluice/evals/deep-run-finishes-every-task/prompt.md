---
name: deep-run-finishes-every-task
description: A deep run past pre-flight with three tasks left must carry them all to done in one turn, not check in after each.
tags: [routing, deep, execution, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Tasks 2, 3 and 4 all reach done, the suite is green, and the turn ends once at the handback rather than after each task.
---

Plan's signed off and pre-flight's answered, it's all in `.sluice/run.json`. Go.
