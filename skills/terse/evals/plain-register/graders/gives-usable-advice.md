---
type: llm
focus: last_message
weight: 2
---

The user asked how to approach rate limiting for a public REST API before launch.

PASS if the reply gives concrete advice a developer could act on: limit per API key or client (not only per IP), name an algorithm such as token bucket or sliding window, and return HTTP 429 with a Retry-After header or rate-limit headers.
FAIL if the advice is vague (no algorithm, no status code), or if compression has dropped it to a bare list of nouns with no guidance on what to do.
