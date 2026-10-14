---
name: fast-verifies-before-handback
description: The fast channel's gate. Pins a passing check recorded with status.sh verify after the run's last edit, so the handback describes the tree as it stands.
tags: [verify, fast, scaffold, write]
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Ships --quiet in the fast channel, and after its last Write or Edit runs the suite through `status.sh verify -- <cmd>` before handing back.
---

Add a `--quiet` flag to the deploy command. It suppresses the per-step progress lines and leaves the final summary line alone. Everything else about the command stays as it is.
