# Verify

Claiming that something works has a fixed sequence in front of it: pick the
command that proves the claim rather than the one that would make it feel
true, run that command in full during this turn, read its output and its exit
code, and write the sentence only once you have. What you remember from an
earlier run is no substitute for reading this one, however convincing it was
at the time.

| Evidence in hand | What it lets you say |
|---|---|
| the original symptom, retested and gone | "bug fixed" |
| the actual diff, not its own status report | "subagent finished" |
| a fresh full run, zero failures, exit code checked | "tests pass" |
| a real build command at exit 0, not a clean linter | "build succeeds" |

A regression test counts only once you have seen it go both ways: red with
the fix backed out, green with the fix back in. A test that has only ever
passed proves nothing about what it would catch.

Wording is not a loophole. "Looks right", "should be good" and "that's
sorted" are completion claims in other clothes. So is pleasure at your own
work: "beautiful", "there we go", "nailed it" each announce that the thing
landed, and each needs the same command run beforehand as "it passes" does.

The friction line: "the change was too small to need a full run." Run it.
