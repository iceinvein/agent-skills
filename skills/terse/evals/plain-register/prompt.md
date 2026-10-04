---
name: plain-register
description: "A question that invites consultant language. The plain-language register holds: no leverage, utilize, robust, seamless, comprehensive, holistic."
tags: [terse, register, readonly]
max_turns: 4
allowed_tools: [Skill]
expected_outcome: Practical rate-limiting advice (per-key limits, a token bucket or sliding window, 429 with Retry-After) in words you would say out loud.
---

Terse mode. What's a sensible way to approach rate limiting for a public REST API we're about to launch?
