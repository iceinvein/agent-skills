---
type: llm
focus: last_message
weight: 2
---

The user asked why `def add(item, items=[])` accumulates items across calls.

PASS if the reply says the default list is evaluated once, when the function is defined, so every call that omits `items` mutates the same list object; and it gives the usual fix of defaulting to `None` and creating a new list inside the function.
FAIL if the explanation is wrong (for example, claims the list is re-created per call or blames scoping), or the fix is missing.
