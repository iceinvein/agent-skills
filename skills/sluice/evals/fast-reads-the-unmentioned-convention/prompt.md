---
name: fast-reads-the-unmentioned-convention
description: A new flag in a repo whose flags live in one table that generates --help. The prompt names neither. Pins that a fast run still reads the repo's convention and lands the flag where it says.
tags: [routing, fast, convention, scaffold, write]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Stays fast, finds the FLAGS table through CONTRIBUTING.md, registers --verbose in src/cli/flags.js, updates the help test to list it, and ships with the suite green.
---

Add a `--verbose` flag to the deploy command. After each step's progress line it prints one more line saying the step finished, for example `   build done`. Without the flag the output stays exactly as it is.
