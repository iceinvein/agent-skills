---
name: deep-run-survives-a-milestone
description: A deep run whose plan names its first three tasks a milestone must carry on past it to the flip in the same turn, not report at the milestone.
tags: [routing, deep, execution, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: All six tasks reach done, the Stop hook never has to refuse a stop, and the turn ends once at the handback.
---

Plan's signed off and pre-flight's answered, it's all in `.sluice/run.json`. Go.
