---
type: regex
# The fixture's init named the target tiny-next. Red if the scaffold failed or
# the run rewrote or removed the store's config.
pattern: '\[target\]\s*\nname\s*=\s*"tiny-next"'
target: { source: file, path: .migrate/config.toml }
weight: 2
---
