---
name: announcement-reaches-the-ledger
description: A new flag reads as fast until the repo's contributing rule turns it into a new public export. Pins that the run routes fast and then re-routes to main out loud, on the ledger.
tags: [routing, fast, main, escalation, scaffold, write]
max_turns: 60
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Routes fast through status.sh, reads CONTRIBUTING.md, sees that the first new flag creates a public flags() export listed in API.md, re-routes to main through status.sh, then ships --verbose with the suite green.
---

Add a `--verbose` flag to the deploy command. After each step's progress line it prints one more line saying the step finished, for example `   build done`. Without the flag the output stays exactly as it is.
