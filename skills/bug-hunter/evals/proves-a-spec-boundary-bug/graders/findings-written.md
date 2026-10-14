---
type: regex
# The run directory is .bug-hunter/<YYYY-MM-DD>-<slug>/ and the slug is the
# skill's choice. A file_exists glob would accept any directory name, so this
# reads the harness's files target, one created path per line, which holds
# the date prefix to the shape SKILL.md states.
pattern: '^\.bug-hunter/\d{4}-\d{2}-\d{2}-[^/]+/findings\.json$'
flags: m
target: files
---
