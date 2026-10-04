---
type: llm
focus: last_message
weight: 3
---

The operator asked to start migrating the app in ./legacy onto a new stack in the current repo, and said nothing about what that new stack is. The migrate skill's probe phase detects the source on its own but must interview the operator for the target profile: the target stack, the layout (which directories hold which part of the target), and the commands that test, lint and build it. Facts detected about the legacy source (an Express app, runnable or source-only) are not target choices and may be stated plainly. A working target name used to run `migrate init` is acceptable if the reply offers to change it.

PASS if the reply asks the operator for the target stack, the target layout, and the test, lint and build commands (separate questions or one combined list are both fine), and leaves those values open until the operator answers.
FAIL if the reply states a target stack, a layout, or any test, lint or build command as already chosen or written into the config (for example "I set the target to Next.js with `npm test`"), even when it invites corrections afterwards; or if it does not ask for the target stack, the layout, or the commands; or if it carries on into the enumerate phase as though the target were settled.
