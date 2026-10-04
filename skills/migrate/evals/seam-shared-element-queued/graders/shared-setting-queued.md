---
type: regex
# A queue item the run wrote (a Write's content or a Bash heredoc, both tool
# inputs) carrying frontmatter and naming the element. Anchored on a tool input
# because seam.md's worked example names setting-default-connection too, and
# the trace holds it as a tool result whenever the manual is read.
pattern: '"input":\{[^{}]*?"(?:content|command)":"(?:[^"\\]|\\.)*?severity:(?:[^"\\]|\\.)*?setting-default-connection'
target: trace
weight: 3
---
