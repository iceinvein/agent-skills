---
type: llm
focus: last_message
weight: 2
---

An earlier review of this same PR was interrupted one stage short of the report, and `magpie --list-runs` still lists it as active.

PASS if the reply tells the user that an unfinished run for PR 1337 already exists, and then either picks it up from where it stopped or asks whether to resume it or start over. Naming the run id or its path is fine but not required.
FAIL if the reply starts a fresh run, says nothing about the existing one, or treats the archived run for the other PR as the one to resume.
