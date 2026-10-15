---
type: regex
# The surface test turns the first new flag into a new public flags() export,
# so the route that fits is main, and it has to come before source changes.
# Matches from the start of the trace to a Bash call invoking
# status.sh route main, refusing any Write or Edit under src/ or any fast or
# deep route on the way. Anchored as the announces graders are, so a quoted
# mention such as grep 'status.sh route main' does not count.
# file_path is found wherever it sits in the input: an Edit's opens with
# replace_all, so anchoring on file_path first let an early Edit through.
pattern: '^(?:(?!"name":"(?:Write|Edit|MultiEdit)","input":\{(?:"(?:[^"\\]|\\.)*"|[^"{}])*?"file_path":"[^"]*/src/|"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+route(?:\s|\\[nt])+(?:fast|deep)(?:\s|\\[nt]|[;&|]|"))[\s\S])*?"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:\s|\\[nt])+route(?:\s|\\[nt])+main(?:\s|\\[nt]|[;&|]|")'
target: trace
weight: 3
---
