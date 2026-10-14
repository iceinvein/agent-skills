---
type: regex
# The gate is a passing check recorded against the tree as it is handed back,
# so the order is the whole point: a verify call followed by any Write or Edit
# describes a tree that no longer exists. The negative lookahead runs to the
# end of the trace, so the match is only a verify call no later edit follows.
# Anchored on the command invoking status.sh, as the announces graders are, so
# a quoted mention (a grep, SKILL.md's own text) does not count. The command
# after `--` must be the fixture's suite (npm test, npm run test or
# node --test), so `verify -- true` or `verify --none` does not pass for a
# check. A Write or Edit must come before it, so a run that changes nothing
# and only records the suite does not score. Not seen here: whether the verify exited 0, and edits made through
# Bash (sed, a heredoc) after it.
pattern: '"name":"(?:Write|Edit|MultiEdit)"[\s\S]*?"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+verify(?:(?:\s|\\[nt])+--dir(?:\s|\\[nt])+(?:[^"\\\s]|\\.)+)?(?:\s|\\[nt])+--(?:\s|\\[nt])+(?:npm(?:\s|\\[nt])+(?:run(?:\s|\\[nt])+)?test|node(?:\s|\\[nt])+--test)(?=\s|\\[nt]|\\"|"|[;&|])(?![\s\S]*"name":"(?:Write|Edit|MultiEdit|NotebookEdit)")'
flags: i
target: trace
weight: 3
---
