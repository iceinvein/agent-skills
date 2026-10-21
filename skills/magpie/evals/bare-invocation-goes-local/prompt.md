---
name: bare-invocation-goes-local
description: A bare /magpie on a branch that already has an open PR reviews the branch in local mode. It never looks the PR up or sets up a PR run.
tags: [magpie, local, routing, scaffold]
max_turns: 15
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Runs magpie setup with --local against the workspace, never --pr, and never calls gh. The branch shares no history with any base, so setup fails and the run stops there, surfacing the error.
---

/magpie
