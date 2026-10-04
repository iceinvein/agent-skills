---
name: probe-asks-for-the-target
description: A new migration with nothing said about the target. Probe writes config.toml and parity-basis.md, leaves init's placeholder commands alone, and asks the operator for the target profile instead of inventing one.
tags: [migrate, probe, interview, scaffold]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Runs migrate init against ./legacy, writes .migrate/parity-basis.md with the detection evidence, leaves [target.commands] as init wrote it, and ends by asking for the target stack, layout and the test, lint and build commands.
---

I want to move the app in ./legacy onto a new stack. The new one will live in this repo. Can you get the migration started?
