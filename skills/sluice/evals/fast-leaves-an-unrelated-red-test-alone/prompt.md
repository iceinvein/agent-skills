---
name: fast-leaves-an-unrelated-red-test-alone
description: A shared helper makes the obvious edit turn a test on behaviour nobody said would change red. Pins fixing that by changing code, or asking, and never editing that test.
tags: [test-first, fast, scaffold, write]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Deploy's summary names its steps; once tests/status.test.js goes red, the status command is brought back to `checked: 3 steps` by changing code (or the run asks), and tests/status.test.js is untouched.
---

Make the deploy command's final summary line name its steps, so a full deploy reads `deployed: build, upload, activate`.
