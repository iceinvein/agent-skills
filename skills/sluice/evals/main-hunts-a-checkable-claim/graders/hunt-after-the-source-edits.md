---
type: regex
# The hunt runs on the diff once the code is green, so a bug-hunter call before
# any source change hunts nothing the run wrote. The trace is chronological:
# a Write or Edit whose file_path has a src/ segment (found wherever it sits in
# the input, since an Edit's input opens with replace_all), and only then the Skill
# call naming bug-hunter. The Skill input is matched as a tool_use, so the
# words "bug-hunter" in SKILL.md or in prose do not count.
pattern: '"name":"(?:Write|Edit|MultiEdit)","input":\{(?:"(?:[^"\\]|\\.)*"|[^"{}])*?"file_path":"(?:(?:[^"\\]|\\.)*?/)?src/(?:[^"\\]|\\.)*"[\s\S]*?"name":"Skill","input":\{(?:[^{}]|\{[^{}]*\})*?"skill":"(?:[\w-]+:)?bug-hunter"'
target: trace
weight: 2
---
