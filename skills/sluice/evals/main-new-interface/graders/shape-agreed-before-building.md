---
type: llm
focus: trace
weight: 2
---

The agent was asked to put deploy behind a pluggable target seam, which is a new interface the repo does not have.

PASS if, before writing the implementation, the agent stated the shape it intended to build: it named the seam and the operations on it, and where it recommended landing it. A single recommended approach counts; so does naming two options with one recommended.
FAIL if it started editing files with no statement of the shape first, or if it listed options with no recommendation and ended its turn waiting for an answer.
