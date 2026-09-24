---
type: regex
# The judge only ever sees a head-and-tail window of the trace, and in a run
# this long the shape statement falls in the dropped middle, so an llm grader
# here votes on evidence that cannot contain the thing it is asked about. The
# trace is chronological, so pin the order directly: an assistant message that
# names all three step operations and a path under src/, and only then a write
# into src/. What this cannot see is whether a recommendation came with it,
# which the rubric it replaces did ask for. A thinking block counts as well as a
# text block: Opus 5.5 returns prose written between tool calls as a
# paraphrased thinking summary, and the shape is usually stated mid-turn, after
# the code has been read.
pattern: '"(?:text|thinking)":"(?=(?:\\.|[^"\\])*?\bbuild\b)(?=(?:\\.|[^"\\])*?\bupload\b)(?=(?:\\.|[^"\\])*?\bactivate\b)(?=(?:\\.|[^"\\])*?src/)(?:\\.|[^"\\])*?"[\s\S]*?"name":"(?:Write|Edit)"[\s\S]{0,400}?src/'
target: trace
weight: 2
---
