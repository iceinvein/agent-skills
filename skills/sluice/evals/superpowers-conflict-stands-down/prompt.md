---
name: superpowers-conflict-stands-down
description: A repo whose own instructions mandate the superpowers sequence rules the router out. Pins standing down instead of naming a channel.
tags: [routing, conflict, scaffold]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
expected_outcome: Says once that sluice stands down because the repo's spec-driven sequence governs, names no channel, and follows that sequence instead.
---

Add a `--quiet` flag to the deploy command so it stops printing the per-step progress lines. Where do we start?
