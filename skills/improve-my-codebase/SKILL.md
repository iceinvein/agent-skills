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

## Phase 3: Route audits

Choose which audits to dispatch.

**Inputs:**
- Detection result from Phase 2.
- Parsed args from Phase 1.
- Catalogue: `skills/index.json`.

**Algorithm:**

1. Load catalogue. Filter to entries with both `applies` and `quick` fields (i.e. audit skills).
2. **Apply detection filter:** keep an audit if any of its `applies` values matches an active signal:
   - `any` always matches.
   - `ui` matches if `hasUI`.
   - `domain` matches if `hasDomainLayer`.
   - `integration` matches if `hasIntegration`.
   - `architecture` matches if `hasArchitecture`.
   - `errors` matches if `hasArchitecture` (proxy: any non-trivial codebase has error-handling concerns).
   - `legacy` matches only if `mode === "diff"`.
3. **Apply mode filter:**
   - `quick` mode: keep only entries with `quick: true`.
   - `diff` mode: no further filter (handled by `legacy` matching above).
   - `interactive` and `full` modes: no further filter.
4. **Apply focus filter:** if `scope.focus` is set, keep only entries whose `applies` array contains that focus area.
5. If the resulting list is empty, abort dispatch and emit one of:
   - "No audits applicable to detected stack: <signals>. Override with `focus <area>`."
   - "No audits matched `focus <area>`. Valid areas: <list>."
   - "No quick audits applicable; rerun without `quick`."

**Module scope** is **not** applied here. It carries forward to Phase 4 as a per-subagent scope hint, because audit routing is the same regardless of whether the audit examines the whole repo or one path.

**Worked example:**
- Repo: Bun backend with `events/` directory.
- Detection: `{hasUI: false, hasDomainLayer: false, hasIntegration: true, hasArchitecture: true}`.
- Args: `quick focus architecture`.
- Step 2: keep audits with `any`, `architecture`, or `integration`.
- Step 3: `quick` mode keeps only `quick: true`. Result: `module-secret-auditor`, `coupling-auditor`, `cohesion-analyzer`, `demeter-enforcer`, `dependency-direction-auditor`, `cqs-auditor`, `temporal-coupling-detector`, plus any `any+quick` audits.
- Step 4: `focus architecture` drops audits whose `applies` does not include `architecture`. Result: `module-secret-auditor`, `coupling-auditor`, `cohesion-analyzer`, `demeter-enforcer`, `dependency-direction-auditor`, `cqs-auditor`.

## Phase 4: Dispatch subagents

For each routed audit, spawn one parallel `Agent` call with `subagent_type: general-purpose`. All dispatches go in **a single message with multiple tool calls** so they execute concurrently.

**Per-subagent prompt template:**

````
You are running the <audit-id> audit on a codebase.

# Principles to apply

<paste the full content of skills/<audit-id>/SKILL.md verbatim>

# Scope

<one of:>
- Whole repo at <repo-root-absolute-path>.
- Module: <module-path-absolute>.
- Diff: only the following files changed vs. main: <newline-separated list>.

# Method

1. Read the principles above.
2. Examine the in-scope files. Use Read, Grep, and Glob. Do not run commands that mutate state.
3. Identify violations of the principles. For each, capture: file path, optional line and symbol, severity, the specific principle violated, evidence (a short quoted or paraphrased snippet), and a 1-2 sentence recommendation.
4. Severity: high = a senior engineer would advocate fixing this in the next sprint; med = should be fixed during related work; low = nice to have.
5. Be conservative. If you are not confident a violation is real, omit it.

# Output contract

Return ONLY a JSON array of Finding objects. No markdown fences. No commentary before or after. If you find nothing, return [].

Schema:

[
  {
    "audit": "<audit-id>",
    "file": "<repo-relative path>",
    "line": <int or null>,
    "symbol": "<string or null>",
    "severity": "high" | "med" | "low",
    "principle": "<short principle name, e.g. 'control coupling'>",
    "evidence": "<1-3 sentence quote or paraphrase>",
    "recommendation": "<1-2 sentence fix>"
  }
]

# Constraints

- Do not exceed 25 findings. If more exist, emit the 25 highest severity.
- Do not invent file paths or line numbers. Cite real locations.
- Do not include findings outside the declared scope.
````

**Concurrency**: dispatch all subagents in a single tool-call batch. Subagents do not communicate with each other.

**Soft cap**: if a subagent has not returned within 5 minutes, drop it. The orchestrator does not have a wall-clock timer; this cap is enforced by treating any subagent that fails to return cleanly as `status: failed` and continuing.

**Retry policy:**
- If a subagent returns prose, markdown fences, or text that does not parse as JSON, retry **once** with this follow-up prompt:
  > Your previous response was not valid JSON. Return ONLY a JSON array conforming to the schema specified earlier. No prose, no markdown fences, no commentary. If you found nothing, return `[]`.
- After the second failure, drop the audit and record `{audit, status: 'failed', reason: 'malformed JSON after 2 attempts'}`.
- Do not retry on timeout or tool-call crash.

**Per-finding validation:**
- Required fields: `audit`, `file`, `severity`, `principle`, `evidence`, `recommendation`.
- `severity` must be one of `"high"`, `"med"`, `"low"`.
- `audit` must equal the dispatched audit ID.
- A finding that fails validation is dropped; the count is added to that audit's metadata.
