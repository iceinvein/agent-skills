---
type: regex
# Anchored on a tool input (a Write's content or a Bash heredoc), never a tool
# result: seam.md's own COBOL example carries both "severity: critical" and
# "vertical-slice-only", and the trace holds it whenever the manual is read.
pattern: '"input":\{[^{}]*?"(?:content|command)":"(?:[^"\\]|\\.)*?severity: critical(?:[^"\\]|\\.)*?[Vv]ertical'
target: trace
weight: 2
---
