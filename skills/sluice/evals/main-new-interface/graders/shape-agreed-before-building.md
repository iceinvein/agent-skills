---
type: regex
# The judge only ever sees a head-and-tail window of the trace, and in a run
# this long the shape statement falls in the dropped middle, so an llm grader
# here votes on evidence that cannot contain the thing it is asked about. The
# trace is chronological, so pin the order directly: an assistant message that
# names all three step operations, and only then a write into src/. A write is
# a Write or Edit call, or a Bash command that redirects or `sed -i`s into src/:
# runs build the seam with a heredoc as often as with Write. The message is not
# asked to name a path, because a shape stated as build/upload/activate on a
# target is the shape whether or not it says where the file goes. What this
# cannot see is whether a recommendation came with it, which the rubric it
# replaces did ask for, nor whether a src/ write came before the message too. A thinking block counts as well as a
# text block: Opus 5.5 can return some prose written between tool calls as a
# narration thinking block, and the shape is usually stated mid-turn, after the
# code has been read. This leans on the harness returning private reasoning
# empty, as it does today, so the only thinking text in a trace is narration the
# partner sees; if that changes, this grader can pass on reasoning nobody saw.
pattern: '"(?:text|thinking)":"(?=(?:\\.|[^"\\])*?\bbuild\b)(?=(?:\\.|[^"\\])*?\bupload\b)(?=(?:\\.|[^"\\])*?\bactivate\b)(?:\\.|[^"\\])*?"[\s\S]*?(?:"name":"(?:Write|Edit|MultiEdit)","input":\{(?:"(?:[^"\\]|\\.)*"|[^"{}])*?"file_path":"(?:[^"]*/)?src/|"name":"Bash","input":\{(?:"(?:[^"\\]|\\.)*"|[^"{}])*?"command":"(?:[^"\\]|\\.)*?(?:>>?\s*(?:\\"|'')?(?:[^\s"\\''<>|;&]*/)?src/|\bsed\s+-i(?:[^"\;&|]|\\.)*?[\s/'']src/))'
target: trace
weight: 2
---
