---
name: bypass-question-stays-silent
description: A question that changes no code must be answered without a channel announcement.
tags: [routing, bypass, readonly]
max_turns: 6
allowed_tools: [Skill]
expected_outcome: A direct answer about idempotency keys, with no "<channel> channel" line anywhere in the reply.
---

What's the difference between an idempotency key and a request ID? I keep seeing both in payment APIs and I'm not sure when each one earns its place.
