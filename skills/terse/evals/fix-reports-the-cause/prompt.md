---
name: fix-reports-the-cause
description: A small bug fix. The fix lands and the handback states the cause and the change, without walking through the reads and edits that got there.
tags: [terse, handback, scaffold, write]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Edit]
expected_outcome: Reads src/cart.js, applies the discount before tax rather than after, and reports the cause in a sentence or two, with no step-by-step account of the tool calls.
---

Terse mode. The cart total in src/cart.js is wrong for discounted items, tax is being charged on the pre-discount price. Fix it.
