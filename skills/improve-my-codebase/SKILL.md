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

## Phase 1: Parse args

The orchestrator receives a single string of positional args after the command. Tokenize on whitespace and classify each token.

**Token classes:**
- **Mode tokens**: `quick`, `diff`, `interactive`. The first one encountered wins; later mode tokens are warned and dropped.
- **Scope tokens**: `focus`, `module`. Each consumes the next token as its value.
- **Unknown tokens**: warn and drop.

**Output structure:**

```json
{
  "mode": "full" | "quick" | "diff" | "interactive",
  "scope": {
    "module": "<path>" | null,
    "focus": "<area>" | null
  },
  "raw": "<original arg string>"
}
```

**Rules:**
- Empty args produce `{mode: "full", scope: {module: null, focus: null}}`.
- `quick` or `interactive` with scope tokens present: keep mode, set scope to `{module: null, focus: null}`, emit warning "scope tokens ignored in <mode> mode".
- `focus` without a value: emit error listing valid areas (from catalogue), exit before dispatch.
- `module` without a value: emit error "module requires a path argument", exit before dispatch.
- `module <path>` where path does not exist: emit error "no such module: <path>", exit before dispatch.

**Valid focus areas** (derived from the `applies` vocabulary):
`any`, `ui`, `domain`, `integration`, `architecture`, `errors`, `legacy`.

**Worked examples:**

| Input | Output |
|-------|--------|
| `""` | `{mode: "full", scope: {module: null, focus: null}}` |
| `"quick"` | `{mode: "quick", scope: {module: null, focus: null}}` |
| `"diff"` | `{mode: "diff", scope: {module: null, focus: null}}` |
| `"focus architecture"` | `{mode: "full", scope: {module: null, focus: "architecture"}}` |
| `"diff focus architecture"` | `{mode: "diff", scope: {module: null, focus: "architecture"}}` |
| `"module src/auth focus architecture"` | `{mode: "full", scope: {module: "src/auth", focus: "architecture"}}` |
| `"quick focus ui"` | `{mode: "quick", scope: {module: null, focus: null}}` plus warning |
| `"banana"` | `{mode: "full", scope: {module: null, focus: null}}` plus warning |

## Phase 2: Detect stack

Determine which audit categories apply to this repo. Use cheap signals only; do not walk the full repo tree.

**Detection output:**

```json
{
  "languages": ["typescript", "..."],
  "frameworks": ["react", "..."],
  "hasUI": true,
  "hasDomainLayer": false,
  "hasIntegration": false,
  "hasArchitecture": true
}
```

**Defaults**: all booleans default to `false`; `languages` and `frameworks` default to `[]`. A signal flipping a field to `true` or appending an entry is the only way values get populated.

**Signals to gather (run all four; the steps are cheap and orthogonal):**

1. **`package.json` if present**: read `dependencies` and `devDependencies`.
   - Frameworks: any of `react`, `vue`, `@angular/core`, `svelte`, `solid-js`. Sets `frameworks` and `hasUI: true`.
   - Integration: any of `kafkajs`, `amqplib`, `bullmq`, `nats`, `mqtt`. Sets `hasIntegration: true`.
2. **Top-level directory listing**: one `find . -maxdepth 3 -type d -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/coverage/*" -not -path "*/tests/fixtures/*"`.
   - `domain/`, `entities/`, `aggregates/`: sets `hasDomainLayer: true`.
   - `events/`, `messaging/`, `queues/`, `consumers/`: sets `hasIntegration: true`.
3. **File extension frequency**: one `find . -maxdepth 4 -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/build/*" -not -path "*/coverage/*" -not -path "*/tests/fixtures/*"`, count by extension.
   - **Frequency threshold for UI**: at least 3 files matching `.tsx`/`.jsx`/`.vue`/`.svelte`/`.html`/`.css`/`.scss` sets `hasUI: true`. A single fixture file should not flip the signal.
   - `.ts`/`.js`: adds `typescript`/`javascript` to `languages` (>= 1 file).
   - `.py`: adds `python` (>= 1).
   - `.rs`: adds `rust` (>= 1).
   - `.go`: adds `go` (>= 1).
4. **`hasArchitecture`**: true if total non-test source files >= 5 (excluding the same paths above).

**Failure behavior:**
- If no `package.json` and no source-file extensions are detected, treat as "no signal" and warn: "no recognizable codebase signals detected; running only `applies: any` audits".
- Detection is best-effort. False positives (e.g. an empty `events/` directory) are acceptable; the per-audit applicability check upstream will already drop irrelevant ones.

**What NOT to do:**
- Do not read source file contents for detection.
- Do not run language-specific tooling (no `tsc`, no `eslint`).
- Do not exceed two `find` invocations and one `package.json` read.
