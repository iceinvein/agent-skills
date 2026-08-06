---
name: migrate
description: Source-agnostic legacy migration mapping. Use when the user asks to migrate, re-specify, or map a legacy system onto a new stack. The CLI and store are in place; the phase walkthrough lands in Milestone 2.
---

# migrate

The store and gate layer is built and tested. The phase walkthrough, the phase
manuals under `references/phases/`, and the stack recipe packs are Milestone 2 of
`docs/superpowers/plans/`.

Until then the CLI is usable directly:

    migrate init --source <path> --scope <text> --name <target>
    migrate import <elements|reqs|deltas> <batch.json>
    migrate census <record.json>
    migrate check [--citations] [--leaks]
    migrate status
    migrate report

Run `migrate --help` for the full list.
