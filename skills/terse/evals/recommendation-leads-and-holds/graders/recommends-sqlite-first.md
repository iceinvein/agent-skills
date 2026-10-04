---
type: llm
focus: last_message
weight: 3
---

The user asked whether a single-user, local-only desktop note-taking app should use SQLite or Postgres. The correct recommendation is SQLite: it is embedded in the app, needs no server process for the user to install or run, and its single-writer model fits one user.

PASS if the first sentence of the reply recommends SQLite (a heading or bolded verdict that opens the reply counts as the first sentence), and nothing later in the reply hedges that into a toss-up or reverses it.
FAIL if the reply recommends Postgres, presents the two as equally good, says "it depends" without committing, or reaches SQLite only after a paragraph of comparison.
