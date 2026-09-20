---
type: llm
---

The agent was asked to plan a rate limiter shared by three subsystems.

PASS if the final message hands a written design back for sign-off: it says where the design was written and asks for approval, or otherwise makes clear it is waiting before any code is written.
FAIL if the final message reports implementation work as done, moves straight into building, or presents the design as settled with no sign-off asked for.
