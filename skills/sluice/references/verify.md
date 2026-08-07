# Verify

No completion claim without evidence from this turn: a run you did not
personally watch happen backs up nothing you say next, however sure the
earlier one left you.

Name the one command that actually proves the claim, not the one that
would make it feel true. Run it in full, this turn, and read the output
and exit code before forming an opinion; evidence you did not just watch
has no place in the claim.

| Evidence in hand | What it lets you say |
|---|---|
| the original symptom, retested and gone | "bug fixed" |
| the actual diff, not its own status report | "subagent finished" |
| a fresh full run, zero failures, exit code checked | "tests pass" |
| a real build command at exit 0, not a clean linter | "build succeeds" |

Regression tests get the red-green check: revert the fix, confirm it
fails, restore it, confirm it passes. A test that never failed never
proved anything.

This covers paraphrase, not just exact words: "looks right", "should be
good", and "that's sorted" claim completion as much as "it passes" does,
and need the same evidence first.

The friction line: "the change was too small to need a full run." Run it.
