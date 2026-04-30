---
name: improve-my-codebase
description: Use when the user wants a prioritized improvement report across an entire codebase or a scoped subset. Orchestrates the existing audit skills (Parnas, Ousterhout, Hickey, Martin, Evans, Rams, etc.) in parallel and produces a ranked, per-file report. Trigger on "/improve-my-codebase", "audit my codebase", "what should I improve", "review the whole repo", or scoped variants.
---

# Improve My Codebase

A meta-orchestrator that runs the existing audit skills in this package across a codebase, then synthesizes their findings into a single prioritized report. Default invocation runs a full sweep; positional args switch modes (quick, diff, interactive) or narrow scope (focus area, module path).

**Core principle:** every issue surfaced should be one a senior engineer would agree is worth a developer's attention. Convergent findings (multiple audits flagging the same file or symbol) rank above single-axis findings, because independent perspectives agreeing is the strongest signal of real problems.

## When to Use

- A user types `/improve-my-codebase` or asks for a codebase-wide audit.
- A user wants to know what's worth improving in a repo before planning work.
- A user wants a scoped audit of changed files (`diff` mode) or a single module (`module <path>`).

**Not for:**
- Reviewing a single function or short snippet. Invoke the relevant single-axis audit directly.
- Auto-applying fixes. This skill emits a report only.
- Replacing the individual audit skills. They remain the source of truth and are dispatched here, not duplicated.

## Invocation

```
/improve-my-codebase                                  # full sweep
/improve-my-codebase quick                            # fast subset, top 5 issues
/improve-my-codebase diff                             # only changed files vs. main
/improve-my-codebase interactive                      # interview-driven
/improve-my-codebase focus <area>                     # narrow to one axis
/improve-my-codebase module <path>                    # scope to a directory or file
/improve-my-codebase diff focus <area>                # composition
/improve-my-codebase module <path> focus <area>
```

Argument rules:
- Positional. No leading `--`.
- Modes: `quick`, `diff`, `interactive`. First match wins; mutually exclusive.
- Scope filters: `focus <area>`, `module <path>`. Compose freely with each other and with default/diff modes.
- `quick` and `interactive` ignore scope tokens (warn, do not error).
- Unknown tokens: warn and drop, do not abort.

## Process Overview

Six sequential phases. Each phase is described in its own section below.

1. Parse args.
2. Detect stack.
3. Route audits.
4. Dispatch subagents in parallel.
5. Synthesize findings.
6. Write report.

The orchestrator is read-only until phase 6.
