---
type: llm
focus: last_message
weight: 2
---

The user asked how HTTP caching with ETags works, in terse `sharp` mode.

PASS if the reply covers the revalidation round trip: the server sends an `ETag` with the response, the client sends it back in `If-None-Match`, and the server answers `304 Not Modified` without a body when the resource has not changed. Mentioning the full 200 response when it has changed is welcome but not required.
FAIL if any of those three parts is missing or wrong, for example the client header is misnamed or the 304 is described as carrying the full body.
