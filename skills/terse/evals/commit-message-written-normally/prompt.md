---
name: commit-message-written-normally
description: Terse applies to conversation, not artefacts. A commit message asked for in sharp mode is written as normal prose without arrows or abbreviations.
tags: [terse, boundaries, readonly]
max_turns: 4
allowed_tools: [Skill]
expected_outcome: A conventional commit message with a subject line and a body in full sentences explaining why the retry now backs off. No arrows, no fn/cfg/req shorthand inside the message.
---

Terse mode, sharp level. Write me a commit message for this diff:

```diff
--- a/src/http/client.ts
+++ b/src/http/client.ts
@@ -12,9 +12,14 @@ export async function fetchWithRetry(url: string, attempts = 3) {
   for (let i = 0; i < attempts; i++) {
     try {
       return await fetch(url);
     } catch (err) {
-      if (i === attempts - 1) throw err;
+      if (i === attempts - 1) {
+        throw err;
+      }
+      // Upstream rate-limits bursts; spacing retries out lets it recover.
+      const delayMs = 200 * 2 ** i;
+      await new Promise((resolve) => setTimeout(resolve, delayMs));
     }
   }
 }
```
