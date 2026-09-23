---
type: regex
# The fixture's help test asserts the whole --help output, so registering the
# flag turns it red until the expected text names --verbose. A run that deleted
# or loosened the assertion instead would not leave the flag in this file.
pattern: '--verbose'
target: { source: file, path: tests/help.test.js }
---
