---
name: main-skips-the-hunt-without-a-claim
description: The main channel's hunt is conditional. A seam that moves existing behaviour states no limit, boundary or result to check, so the run says so in one line and does not invoke bug-hunter.
tags: [verify, hunt, main, scaffold, write]
plugins: ["plugins/sluice", "plugins/bug-hunter"]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash, Agent]
expected_outcome: Routes main and builds the target seam with the suite green, never invokes bug-hunter, and says in one line that the intent stated no checkable claim so the hunt was skipped.
---

Deploy only knows how to push to our own boxes. I want it to go through a pluggable target, so the same three steps can run against S3 later without the command knowing which one it got. Build the target seam and move the current behaviour behind it.
