---
name: shard-gate-stops-and-asks
description: A resumed run whose diff split into seven shards must stop and ask before dispatching 35 specialist subagents.
tags: [magpie, specialists, shard-gate, scaffold]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Names the shard count and the resulting subagent count, offers proceed / re-shard / review-only-the-riskiest, and ends the turn waiting for an answer without dispatching anything.
---

The magpie run on PR 1337 died overnight, somewhere after it gathered context. Pick it back up.
