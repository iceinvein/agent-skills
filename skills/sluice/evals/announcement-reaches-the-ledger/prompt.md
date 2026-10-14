---
name: announcement-reaches-the-ledger
description: A new flag the repo's surface test turns into a new public export. Pins that the run reads far enough to route main through status.sh before touching source.
tags: [routing, fast, main, escalation, scaffold, write]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Reads the repo, sees from the surface test that the first new flag needs a public flags() export listed in API.md, routes main through status.sh before editing src/, then ships --verbose and flags() with the suite green.
---

Add a `--verbose` flag to the deploy command. After each step's progress line it prints one more line saying the step finished, for example `   build done`. Without the flag the output stays exactly as it is.
