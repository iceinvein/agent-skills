---
name: fast-flag-on-existing-command
description: A new flag on an existing command is the fast channel's own example. Pins the announcement and test-first.
tags: [routing, fast, scaffold, write]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Announces the fast channel, edits tests/deploy.test.js and runs the suite before touching src/cli/deploy.js, then ships --quiet with the suite green.
---

Add a `--quiet` flag to the deploy command. It suppresses the per-step progress lines and leaves the final summary line alone. Everything else about the command stays as it is.
