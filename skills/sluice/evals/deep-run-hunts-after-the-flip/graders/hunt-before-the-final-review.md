---
type: regex
# Every task, the flip included, is done in the fixture, so any hunt in the
# trace comes after the flip; what is left to pin is that it lands before the
# final review. From the start of the trace, no Agent call and no
# `status.sh final` call may come before the bug-hunter Skill call, and an
# Agent call or a `status.sh final` must come after it. Marking `final` is a
# rule of its own (deep-run-finishes-without-checking-in), so a run that hunts,
# dispatches the review and forgets the mark still kept this one. `final` alone
# is not enough before the hunt, because it is marked after the review clears.
# An Agent call stands for the review: every task is
# already done, so there is no implementer to dispatch, and bug-hunter's own
# SKILL.md dispatches no agents, so any Agent call before the hunt can only be
# the final review.
# Both are anchored as tool inputs: the Skill call's own input, and a Bash
# command invoking status.sh (with an optional --dir) rather than quoting it,
# so SKILL.md's text, a grep or prose naming either does not count.
pattern: '^(?:(?!"name":"Agent"|"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:(?:\s|\\[nt])+--dir(?:\s|\\[nt])+(?:[^"\\\s]|\\.)+)?(?:\s|\\[nt])+final(?=\s|\\[nt]|\\"|"|[;&|]))[\s\S])*?"name":"Skill","input":\{(?:[^{}]|\{[^{}]*\})*?"skill":"(?:[\w-]+:)?bug-hunter"[\s\S]*?(?:"name":"Agent"|"command":"(?:(?:[^"\\]|\\.)*?(?:[\s/]|\\[nt]))?status\.sh(?:\\"|'')?(?:(?:\s|\\[nt])+--dir(?:\s|\\[nt])+(?:[^"\\\s]|\\.)+)?(?:\s|\\[nt])+final(?=\s|\\[nt]|\\"|"|[;&|]))'
target: trace
weight: 3
---
