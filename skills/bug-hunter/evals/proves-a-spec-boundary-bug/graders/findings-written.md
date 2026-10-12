---
type: file_exists
# The run directory's slug is the skill's choice, so the path is a glob; only
# file_exists resolves one. The llm grader cannot open this file for the same
# reason and reads the trace instead.
path: '.bug-hunter/*/findings.json'
---
