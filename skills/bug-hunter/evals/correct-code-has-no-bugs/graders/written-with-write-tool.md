---
type: regex
# SKILL.md writes intent.md, findings.json and report.md with the Write tool,
# never from a shell command. The content graders read a heredoc's literal JSON
# as readily as a Write call's, so this is what holds the rule: it fails a Bash
# command that redirects or tees into one of the three under .bug-hunter/. A
# script that opens the file itself (python3, node -e) is not caught here; the
# content graders fail that, since the trace then holds no literal JSON.
pattern: '"command":"(?:\\.|[^"\\])*?(?:>|\btee\b(?:\\.|[^"\\|;&])*?)\s*[^"\s]*\.bug-hunter/[^"\s]*?(?:intent\.md|findings\.json|report\.md)'
match: not_contains
target: trace
weight: 2
---
