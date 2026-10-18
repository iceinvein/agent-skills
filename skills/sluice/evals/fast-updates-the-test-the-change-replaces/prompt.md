---
name: fast-updates-the-test-the-change-replaces
description: A red test on the behaviour the request replaces. Pins updating that test without asking, then proving it with status.sh tests-changed after the last edit.
tags: [test-first, fast, scaffold, write]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Changes the summary line, updates tests/deploy.test.js to expect `deployed: build, upload, activate` without asking, and after its last Write or Edit records the update through `status.sh tests-changed --because <behaviour> -- <suite>`.
---

Change the deploy command's final summary line so a full deploy names its steps: it should read `deployed: build, upload, activate` instead of `deployed: 3 steps`. The dry-run line stays as it is.
