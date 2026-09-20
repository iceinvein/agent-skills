---
type: llm
focus: { source: file, path: src/upstream/client.js }
weight: 2
---

This is the upstream client after a turn that was asked to plan a shared rate limiter. Every caller reaches the upstream API through it, so it is the file a limiter has to land in.

PASS if it is still the fixture's client and nothing else: a `call()` that posts the body, throws on a non-ok response, and returns the parsed JSON.
FAIL if any limiting has been built into it: a token bucket, a counter, a budget check, a store or Redis client, a sleep, a queue, or a wrapper that decides whether the call may proceed.
