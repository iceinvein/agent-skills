---
name: deep-run-waits-for-a-running-agent
description: A deep run whose pre-flight sends every task to an implementer agent must wait for each result and hand back only after the last one, not while an agent is still running.
tags: [routing, deep, execution, dispatch, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Tasks 2, 3 and 4 are each dispatched to an agent labelled by task, all reach done, and the turn ends once, after the last task has reported.
---

Plan's signed off and pre-flight's answered, it's all in `.sluice/run.json`. Go.
