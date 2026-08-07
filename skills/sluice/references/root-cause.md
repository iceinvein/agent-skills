# Root cause

No fix without investigation first. A patch that treats the symptom
returns, usually worse.

This rule is trigger-based, not channel-assigned: any bug, test failure, or
unexpected behaviour fires it, in every channel including `bypass`.

**Understand before touching anything.** Read the error completely, not
just its first line. Reproduce it reliably. Check what changed recently: a
commit, a dependency bump. Trace the bad value to where it originates and
fix it there, not wherever it surfaced; set the broken path next to
similar working code so every difference stands out, down to the ones
that look irrelevant, since the one you wave off often matters most.

**One hypothesis, one change.** State it plainly, then test it with the
smallest change that would confirm or kill it, one variable at a time;
change two things and a working fix tells you nothing about which one did
it.

**Prove it, then harden it.** Write the failing test that reproduces the
bug, make the one change your hypothesis predicts, then verify. Once the
cause is actually fixed, add validation at the layers that let the bad
value through, so the next variant fails loudly instead of silently.

Three failed fixes points at the design, not your guesswork. Stop and
raise it instead of trying a fourth.

**Condition-based waiting.** A test that sleeps for a fixed duration will
flake; poll for the condition it depends on and fail on a timeout.

The friction line: "I have seen this exact error before, I know the fix."
Recognising the pattern skips the step where you check it still applies
here.
