---
type: regex
# The trace is chronological. From its start, step over everything that is
# not a Read of src/discount.js until a write of scenarios.md under
# .bug-hunter/ (a Write call, or a shell redirect into it); a Read of the file
# first means the match cannot get there. What it sees: Read tool calls, and
# the scenarios.md write, wherever in the trace they are recorded. What it
# cannot see: the body reached some other way (`cat` or `sed` in Bash, Grep
# with content output, or the source pasted into a dispatch prompt), and
# anything a dispatched agent did if the trace does not carry its tool calls.
pattern: '^(?:(?!"name":"Read","input":\{[^}]*?"file_path":"[^"]*src/discount\.js")[\s\S])*?(?:"name":"Write","input":\{"file_path":"[^"]*\.bug-hunter/[^"]*/scenarios\.md"|"name":"Bash","input":\{"command":"(?:\\.|[^"\\])*?>\s*[^"\s]*\.bug-hunter/[^"\s]*/scenarios\.md)'
target: trace
weight: 3
---
