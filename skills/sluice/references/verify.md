# Verify

No completion claim without fresh evidence. If you did not run the command
in this turn, you cannot say it passes, no matter how confident the last
run left you.

The gate: identify the command that actually proves the claim, run it in
full, read the output and the exit code, then make the claim with that
evidence in hand.

Match the claim to its evidence:

| Claim | Evidence |
|---|---|
| Tests pass | test output, zero failures |
| Build succeeds | exit 0, not a clean linter |
| Bug fixed | the original symptom, retested |
| Subagent finished | the VCS diff, not its own report |

Regression tests get the red-green check: revert the fix, confirm the test
fails, restore the fix, confirm it passes. A test that never failed never
proved anything.

This covers paraphrase and implication, not only the exact words.
Expressing satisfaction before verifying is the same violation as
claiming completion: "looks right", "should be good", "that's sorted",
and "that should be fixed now" all claim it as much as "it passes" does,
and need the same evidence before you say them.

The friction line: "it should work now." Run it.
