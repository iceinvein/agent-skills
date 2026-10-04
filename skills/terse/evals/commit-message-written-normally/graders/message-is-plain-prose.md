---
type: llm
focus: last_message
weight: 3
---

The user is in terse `sharp` mode and asked for a commit message. The skill's Boundaries section says commit messages are written normally: terse compresses the conversation, not the artefact.

Judge only the commit message itself (usually in a code block), not any sentence around it.

PASS if the commit message has a subject line describing the change (exponential backoff between retries in fetchWithRetry) and its body, if any, is in ordinary full sentences.
FAIL if the commit message uses arrows (→ or ->) for causality, sharp-level abbreviations such as fn, cfg, req, impl or deps, or telegraphic fragments in place of sentences; or if there is no identifiable commit message.
