---
name: main-new-interface
description: Adding a port the repo does not have is the main channel. Pins the announcement and agreeing the shape before building.
tags: [routing, main, scaffold, write]
max_turns: 80
timeout_seconds: 2400
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
expected_outcome: Announces the main channel, states the port's shape and a recommendation before implementing, then builds it test-first with the suite green.
---

Deploy only knows how to push to our own boxes. I want it to go through a pluggable target, so the same three steps can run against S3 later without the command knowing which one it got. Build the target seam and move the current behaviour behind it.
