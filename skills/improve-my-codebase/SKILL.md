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

1. Load catalogue from `skills/index.json`. If the file is missing, unreadable, or fails JSON parse, hard fail per the error table (the orchestrator cannot route without a catalogue). Filter to entries with both `applies` and `quick` fields (i.e. audit skills).
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

### Diff mode file set

When `mode === "diff"`, before dispatch the orchestrator computes the changed-file set:

1. Run `git diff --name-only origin/main...HEAD` (fall back to `git diff --name-only main...HEAD` if no `origin` remote).
2. Filter out paths that no longer exist (deleted files) and paths in the standard ignored set (`node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `tests/fixtures/`).
3. If the resulting list is empty, emit "diff mode: no changed files vs. main; rerun without `diff` or specify a commit range" per the error table and exit before dispatch.
4. Otherwise, this list is passed to each subagent as the `Scope` (the `Diff:` form of the prompt template in Phase 4).

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

**Per-audit metadata produced** (consumed by Phase 5):

```json
{
  "audit": "<audit-id>",
  "status": "ok" | "failed",
  "reason": "<string or null>",
  "dropped_findings": <int, count of findings dropped at validation>,
  "retried": <bool, true if recovered on attempt 2>
}
```

One such record is emitted per dispatched audit. Successful runs use `status: "ok"`, `reason: null`. Failed runs use `status: "failed"` and a reason string (e.g. `"timeout"`, `"crashed"`, `"malformed JSON after 2 attempts"`).

## Phase 5: Synthesize

Merge all `Finding[]` arrays into a single `Report` object.

**Inputs:**
- Map of `audit-id -> Finding[]` (one entry per dispatched audit; failed audits omitted from this map).
- Per-audit metadata: `{audit, status, dropped_findings, retried, reason}`.

**Algorithm:**

1. **Flatten** all findings into a single list, keeping `audit` on each.
2. **Group by file**: for each unique `file`, collect every finding on that file across all audits.
3. **Compute per-finding weight:**
   - `severity_weight`: high = 3, med = 2, low = 1.
   - `convergence_weight = min(3.0, 1 + 0.5 * (distinct_audits_on_file - 1))` where `distinct_audits_on_file` counts how many distinct audit IDs appear in the findings on this file.
   - `symbol_boost`: if the finding has a non-null `symbol` AND at least one other finding on the same file shares that symbol AND comes from a different audit, multiply by `1.25`.
   - `weight = severity_weight * convergence_weight * symbol_boost`.
4. **Per-file score**: sum of `weight` across all findings on that file.
5. **Sort files** by per-file score descending. Take the top 10 (or all if fewer) for the "files most worth fixing" section.
6. **Sort findings** flat by `weight` descending. Take the top 25 (or all if fewer) for the "top cross-cutting findings" section.
7. **Build per-audit summaries**: for each audit ID present in the input map, compute `{finding_count: <int>, unique_file_count: <int>, findings_by_file: [{file, findings: [...sorted by weight desc]}, ...]}`. This feeds the per-axis template in Phase 6.

**Output `Report` structure:**

```json
{
  "metadata": {
    "date": "YYYY-MM-DD",
    "mode": "full" | "quick" | "diff" | "interactive",
    "scope": { "module": "...", "focus": "..." },
    "audits_succeeded": 14,
    "audits_failed": 2,
    "audits_na": 4,
    "audits_total": 30,
    "failures": [{"audit": "event-design-reviewer", "reason": "malformed JSON after 2 attempts"}],
    "retries": [{"audit": "rams-design-audit", "recovered_on_attempt": 2}],
    "findings_high": 47,
    "findings_med": 89,
    "findings_low": 34
  },
  "top_files": [
    {
      "file": "src/checkout/order.ts",
      "score": 31.0,
      "audits_hit": ["coupling-auditor", "complexity-accountant", "cohesion-analyzer", "cqs-auditor"],
      "top_issue": "<principle of highest-weight finding on this file>"
    }
  ],
  "top_findings": [
    {
      "weight": 11.25,
      "finding": { "<full Finding object>": "..." },
      "convergence": "4 audits on this file"
    }
  ],
  "by_audit": {
    "coupling-auditor": [],
    "complexity-accountant": []
  },
  "by_audit_summary": {
    "coupling-auditor": {
      "finding_count": 12,
      "unique_file_count": 7,
      "findings_by_file": [
        {
          "file": "src/checkout/order.ts",
          "findings": []
        }
      ]
    }
  }
}
```

**Worked example (scoring):**

Three findings on `src/checkout/order.ts`:
- `coupling-auditor`, severity high, symbol `OrderService.applyDiscount`.
- `cohesion-analyzer`, severity med, symbol `OrderService.applyDiscount`.
- `complexity-accountant`, severity high, symbol `OrderService` (different).

`distinct_audits_on_file = 3` so `convergence_weight = 1 + 0.5 * 2 = 2.0`.

- Finding 1: `severity = 3`, `convergence = 2.0`, `symbol_boost = 1.25` (shares symbol with finding 2 from a different audit). `weight = 7.5`.
- Finding 2: `severity = 2`, `convergence = 2.0`, `symbol_boost = 1.25`. `weight = 5.0`.
- Finding 3: `severity = 3`, `convergence = 2.0`, `symbol_boost = 1.0` (its symbol is unique among the file's findings). `weight = 6.0`.

Per-file score: `7.5 + 5.0 + 6.0 = 18.5`. Findings sorted by weight: 1, 3, 2.

## Phase 6: Write report

The only filesystem-mutating phase. Produces one top-level rollup and one per-axis file per fired audit.

**Output paths:**
- `docs/improvements/YYYY-MM-DD/audit.md` (top-level rollup).
- `docs/improvements/YYYY-MM-DD/audit/<audit-id>.md` (one per audit that returned at least one finding).

If `docs/improvements/YYYY-MM-DD/` already exists for today, append a numeric suffix: `audit-2.md`, `audit-3.md`, etc. Do not overwrite a previous run.

**`audit.md` template:**

````markdown
# Codebase audit: {{date}}

**Mode**: {{mode}}{{#if scope.focus}} focus {{scope.focus}}{{/if}}{{#if scope.module}} module {{scope.module}}{{/if}}
**Audits run**: {{audits_succeeded}} succeeded / {{audits_failed}} failed / {{audits_na}} N/A / {{audits_total}} total
**Findings**: {{findings_high}} high, {{findings_med}} med, {{findings_low}} low

{{#if failures}}
**Failed audits**: {{#each failures}}{{audit}} ({{reason}}){{#unless @last}}, {{/unless}}{{/each}}
{{/if}}
{{#if retries}}
**Retries recovered**: {{#each retries}}{{audit}}{{#unless @last}}, {{/unless}}{{/each}}
{{/if}}

## Files most worth fixing

| File | Score | Audits hit | Top issue |
|------|-------|------------|-----------|
{{#each top_files}}| {{file}} | {{score}} | {{audits_hit}} | {{top_issue}} |
{{/each}}

## Top cross-cutting findings

{{#each top_findings}}
{{@index}}. **{{convergence}}**: `{{finding.file}}{{#if finding.line}}:{{finding.line}}{{/if}}` flagged by {{finding.audit}}: {{finding.principle}}. [details](audit/{{finding.audit}}.md)
   - Evidence: {{finding.evidence}}
   - Recommendation: {{finding.recommendation}}
{{/each}}

## Per-axis reports

{{#each by_audit}}
- [{{@key}}](audit/{{@key}}.md): {{this.length}} findings
{{/each}}
````

**Per-axis `audit/<audit-id>.md` template:**

The template renders against `Report.by_audit_summary[<audit-id>]` (produced in Phase 5 step 7).

````markdown
# {{audit-id}} findings

{{finding_count}} findings on {{unique_file_count}} files.

{{#each findings_by_file}}
## `{{file}}`

{{#each findings}}
### {{principle}} ({{severity}}){{#if line}} (line {{line}}){{/if}}{{#if symbol}} (`{{symbol}}`){{/if}}

**Evidence:** {{evidence}}

**Recommendation:** {{recommendation}}

{{/each}}
{{/each}}
````

**Terminal summary** (printed after writing files):

```
Codebase audit complete.

Mode: <mode>
Findings: <high>H / <med>M / <low>L  across <audits_succeeded> audits

Top 5 files to fix:
  1. <file>  (score <score>, hit by <audits_hit>)
  2. ...

Top 5 cross-cutting issues:
  1. [<convergence>] <file>:<line> : <principle>
  2. ...

Full report: docs/improvements/<date>/audit.md
```

**Failure handling:**
- If the target directory cannot be created or written to (permissions, disk full): fall back to printing the full `audit.md` content to the terminal, surface the write error, and do not write the per-axis files. The user can copy-paste the report.
- If a per-axis file fails to write but `audit.md` succeeds: emit a warning with the audit ID, continue, and link in `audit.md` is left as a broken link with an explanatory note.

## Orchestration: putting it together

When the user invokes `/improve-my-codebase [args]`, execute phases in order. Stop early on hard failures (per the error table). Soft failures (subagent issues) are recorded in metadata and do not stop the run.

Pseudocode:

```
parsed = parseArgs(rawArgs)
if parsed.errors: emit, exit

detection = detectStack(repoRoot)
if detection.noSignal: warn, continue with applies:any audits only

audits = routeAudits(catalogue, detection, parsed)
if audits.empty: emit specific message, exit

if parsed.mode == "interactive":
  invoke interactive interview (see Interactive Mode section); produces a refined `parsed`,
  then re-run routeAudits.

findings = dispatchSubagents(audits, parsed.scope, repoRoot)  // parallel
report = synthesize(findings, audits, parsed)
writeReport(report, todaysDateDir)
printTerminalSummary(report)
```

## Interactive Mode

When `parsed.mode === "interactive"`:

1. Show the user the detected stack and the audit set the orchestrator would run by default.
2. Ask, one at a time:
   - "Anything you've been losing time on lately?" (free text, suggests a `focus` area)
   - "Any directory you want to scope to?" (path or skip; sets `module`)
   - "Quick scan or thorough?" (sets `quick` or full)
3. Apply the answers as if they were args, re-route, then proceed to dispatch.
4. Confirm the final audit list before dispatching: "Running these audits: <list>. OK?"

Interactive mode is the only path that reroutes after Phase 3.

## Error handling

| Failure | Phase | Response |
|---------|-------|----------|
| No audits applicable | 3 | Skip dispatch. Emit message. Suggest `focus <area>` to override. |
| `module <path>` does not exist | 1 | Hard fail. Print path + suggestion. |
| `diff` mode with no changed files | 3 | Tell user, suggest `full` or commit-range. Do not run. |
| `focus <area>` matches no audits | 3 | List valid areas. Exit. |
| Subagent timeout | 4 | Drop. Record `{audit, status: 'failed', reason: 'timeout'}`. Continue. |
| Subagent crash | 4 | Drop. Record. Continue. No retry. |
| Subagent malformed JSON | 4 | Retry up to 1 time (2 attempts total). Then drop. |
| Finding fails schema | 5 | Drop bad finding only. Note count in metadata. |
| Cannot write report file | 6 | Fall back to terminal-only. Print full report. Surface write error. |
| `index.json` missing/malformed | 3 | Hard fail. Suggest reinstalling. |
