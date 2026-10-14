---
type: regex
# The gate is a passing check recorded against the tree as it is handed back,
# so the order is the whole point: a verify call followed by any Write or Edit
# describes a tree that no longer exists. The negative lookahead runs to the
# end of the trace, so the match is only a verify call no later edit follows.
# Anchored on the command invoking status.sh, as the announces graders are, so
# a quoted mention (a grep, SKILL.md's own text) does not count, and `--` must
# be followed by whitespace so `verify --none` does not pass for a check.
# Edits made through Bash (sed, a heredoc) are not seen as edits here.
pattern: '"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+verify(?:(?:\s|\\[nt])+--dir(?:\s|\\[nt])+(?:[^"\\\s]|\\.)+)?(?:\s|\\[nt])+--(?:\s|\\[nt])(?![\s\S]*"name":"(?:Write|Edit|MultiEdit|NotebookEdit)")'
flags: i
target: trace
weight: 3
---
