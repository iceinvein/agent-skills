# Root cause

No fix without investigation first. A patch that treats the symptom
returns, usually worse.

This rule is trigger-based, not channel-scoped: any bug, test failure, or
unexpected behaviour fires it, in every channel including `bypass`.

**Investigate.** Read the error completely, not just its first line.
Reproduce it reliably. Check what changed recently: a commit, a dependency
bump. Trace the bad value back to where it originates and fix it there,
not where it surfaced.

**Compare.** Find similar working code and list every difference from the
broken path, however small; the one you dismiss often matters most.

**Hypothesize.** State one hypothesis. Test it with the smallest change you
can make, one variable at a time; change two at once and a working fix
tells you nothing about which one did it.

**Fix.** Write the failing test that reproduces the bug first. Make the one
change your hypothesis predicts. Verify.

Three failed fixes means the architecture is wrong, not your hypothesis.
Stop and raise it instead of trying a fourth.

**Defense in depth.** Once you fix the root cause, add validation at the
layers that let the bad value through, so the next variant fails loudly,
not silently.

**Condition-based waiting.** A test that sleeps for a fixed duration will
flake; poll for the condition it depends on and fail on a timeout.

The friction line: "it is probably X, let me just try that." Seeing the
symptom is not understanding the cause.
