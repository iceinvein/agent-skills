---
type: regex
# SKILL.md has the run drop a .gitignore holding `*` into .bug-hunter/ when
# none is there, so no repo has to ignore the directory itself. The files
# target would show the path but not what it holds, and an empty .gitignore
# ignores nothing, so this reads the trace: a Write call whose content is `*`,
# or a shell command that writes a `*` into it.
pattern: '\.bug-hunter/\.gitignore"\s*,\s*"content"\s*:\s*"\*(?:\\n)?"|"command":"(?:\\.|[^"\\])*?\*(?:\\.|[^"\\])*?>\s*[^"\s]*\.bug-hunter/\.gitignore'
target: trace
weight: 2
---
