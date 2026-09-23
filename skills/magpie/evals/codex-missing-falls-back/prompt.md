---
name: codex-missing-falls-back
description: With codex off the machine, peer review still runs. A Claude subagent stands in, carrying the independence preamble, and the stage never logs an error.
tags: [magpie, peer-review, fallback, scaffold]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Peer review runs on the Claude path with the preamble prepended, logs provider claude and no error, and findings.final.json is written.
---

The magpie run on PR 1337 is parked just after the critic stage. Carry on with it.
