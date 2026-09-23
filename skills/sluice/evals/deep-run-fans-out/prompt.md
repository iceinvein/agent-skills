---
name: deep-run-fans-out
description: Three tasks with disjoint Touches and no Needs between them, under a worktree-per-implementer pre-flight answer, go out at once rather than one at a time.
tags: [routing, deep, execution, dispatch, parallel, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Tasks 1 to 3 are dispatched to three agents in one message, the flip follows alone once they land, and all four tasks reach done.
---

Plan's signed off and pre-flight's answered, it's all in `.sluice/run.json`. Go.
