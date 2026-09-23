---
type: regex
# parseFlags refuses anything outside FLAGS, so a run that parses --verbose
# inline in deploy.js throws on its own test; a run that skips the table some
# other way still leaves --help silent about the flag. The row is the convention.
pattern: '--verbose'
target: { source: file, path: src/cli/flags.js }
weight: 3
---
