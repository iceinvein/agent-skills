---
type: llm
weight: 2
---

The reply should answer a conceptual question about two identifiers used in payment APIs.

PASS if the reply explains that an idempotency key is supplied by the caller to make a retried write safe (the server returns the original result instead of performing the operation twice), and that a request ID identifies one call for tracing, logging, or support, without affecting what the server does.
FAIL if the reply conflates the two, describes only one of them, asks a clarifying question instead of answering, or answers with a plan of work rather than an explanation.
