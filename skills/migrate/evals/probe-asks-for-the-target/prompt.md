---
name: probe-asks-for-the-target
description: A new migration with nothing said about the target. Probe writes parity-basis.md from the detection evidence, then asks the operator for the target profile instead of inventing one, and holds init until it is answered.
tags: [migrate, probe, interview, scaffold]
max_turns: 40
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Task]
expected_outcome: Writes .migrate/parity-basis.md with the detection evidence, does not run migrate init, and ends by asking for the target name, stack, layout and the test, lint and build commands.
---

I want to move the app in ./legacy onto a new stack. The new one will live in this repo. Can you get the migration started?
