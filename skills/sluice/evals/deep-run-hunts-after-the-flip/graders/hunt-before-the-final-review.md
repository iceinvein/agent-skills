---
type: regex
# Every task, the flip included, is done in the fixture, so any hunt in the
# trace comes after the flip; what is left to pin is that it lands before the
# final review is marked. From the start of the trace, no `status.sh final`
# call may come before the bug-hunter Skill call, and one must come after it.
# Both are anchored as tool inputs: the Skill call's own input, and a Bash
# command invoking status.sh (with an optional --dir) rather than quoting it,
# so SKILL.md's text, a grep or prose naming either does not count.
pattern: '^(?:(?!"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:(?:\s|\\[nt])+--dir(?:\s|\\[nt])+(?:[^"\\\s]|\\.)+)?(?:\s|\\[nt])+final(?=\s|\\[nt]|\\"|"|[;&|]))[\s\S])*?"name":"Skill","input":\{(?:[^{}]|\{[^{}]*\})*?"skill":"(?:[\w-]+:)?bug-hunter"[\s\S]*?"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:(?:\s|\\[nt])+--dir(?:\s|\\[nt])+(?:[^"\\\s]|\\.)+)?(?:\s|\\[nt])+final(?=\s|\\[nt]|\\"|"|[;&|])'
target: trace
weight: 3
---
