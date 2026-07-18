---
name: magpie
description: Use when the user asks to review a GitHub pull request (a PR number, PR URL, or "review this PR"). Interactive PR review pipeline; five parallel specialist subagents, dedupe, critic, codex/Claude peer review, and an interactive HTML report for posting selected findings via gh. Follow the stage walkthrough in this skill; the description is not the procedure.
---

# Magpie

## Prerequisites

The skill pre-flights `bun`, `gh`, `git` (required) and `codex` (optional). If a required binary is missing the run aborts with a single install hint line. `codex` is the preferred peer reviewer, but it is optional: if it is missing the run continues and the peer-review stage falls back to a Claude second-opinion subagent (setup prints a one-line notice and logs `{stage: preflight, status: done, missingOptional: ["codex"]}`).

## Stage walkthrough

Stop reading and follow these steps in order. Do not skip stages. Use the exact Bash invocations below.

### 0. Identify the PR

Parse the user's request for a PR number, URL, or "this PR" (current branch). If ambiguous, ask one clarifying terminal question. Capture the PR number into `$PR_NUMBER` and the repository path into `$REPO` (default: current working directory).

Compute the run directory:

```
RUN_ID="pr-${PR_NUMBER}-$(date +%s)"
RUN_DIR="$HOME/.magpie/$RUN_ID"
```

### 1. Setup

```
magpie setup "$RUN_DIR" --pr $PR_NUMBER --repo "$REPO"
```

If exit is non-zero, surface stderr verbatim and stop. The CLI removes the worktree and subdirs on failure; the run directory itself plus `log.jsonl` are kept for diagnostics.

Setup automatically filters lockfiles, build output, generated source, and snapshot fixtures from `diff.patch` before specialists see it. Users can override by placing `.magpie.json` at the repo root: `{"exclude": [...glob], "include": [...glob], "useDefaults": true|false}`. When anything is filtered, the raw diff is preserved as `$RUN_DIR/diff.full.patch` and the exclusion list as `$RUN_DIR/excluded-files.json`.

When a prior run exists for the same PR (active or archived under `~/.magpie/`), setup writes `$RUN_DIR/incremental.json` with `{previousRunId, previousSha, currentSha, sameSha}`. The post stage surfaces this as a "Incremental review since `<sha>`" trailer on the summary comment.

Setup also runs a deterministic test-coverage check: when the diff contains zero test or spec files anywhere, each non-test source file with `>= 10` added code lines gets a `domain: "tests"` finding written to `$RUN_DIR/findings/tests.json`. This is a sixth domain that flows through dedupe/critic/peer-review alongside the five LLM specialists. No specialist subagent is dispatched for it.

The pipeline has no separate context-indexing stage, but `magpie status` and the progress page track one. After setup succeeds, append `{stage: context, status: skipped}` to `$RUN_DIR/log.jsonl` so both advance past `context`.

### 2. Serve

Start the HTML server in the background using the Bash tool with `run_in_background: true`:

```
magpie serve "$RUN_DIR"
```

Read `$RUN_DIR/state/server-info` for the URL; the server writes it asynchronously at startup, so if the file doesn't exist yet, wait a moment and re-read (it appears within ~1s). Print to the user: "Open <url> in your browser to follow along."

Render the first progress paint:

```
magpie render "$RUN_DIR" progress
```

### 3. Specialists

Append `{stage: specialists, status: running}` to `$RUN_DIR/log.jsonl` and re-render progress, so the served page shows the stage as active rather than "Paused". Then dispatch the five specialist subagents in a single message using five Agent tool calls in parallel. For each focus in (security, bugs, performance, code-smells, architecture), the prompt is:

````
<specialist block for focus from this SKILL.md>

You are reviewing PR #<PR_NUMBER>.
Working directory: $RUN_DIR/worktree
Diff: $RUN_DIR/diff.patch

## Output Contract

Write findings to $RUN_DIR/findings/<focus>.json before returning. The file MUST be a JSON array. Each entry MUST conform to this schema exactly (no extra top-level keys, no renamed keys):

{
  "id": string,                      // e.g. "<focus>-1", "<focus>-2"; unique per focus
  "file": string,                    // path relative to worktree
  "line": number | null,             // single integer; use null if not anchorable. NOT "lines", NOT a range string
  "severity": "blocker" | "high" | "medium" | "low",
  "risk": {                          // OBJECT, not a flat string
    "impact":     "critical" | "high" | "medium" | "low",
    "likelihood": "likely" | "possible" | "edge-case" | "unknown",
    "confidence": "high" | "medium" | "low",
    "action":     "must-fix" | "should-fix" | "consider" | "optional"
  },
  "title": string,                   // one line
  "description": string,             // 2-4 short labelled paragraphs (see below). Cite code with file:line.
  "suggestion": {                    // OPTIONAL; omit the key entirely if not applicable. NOT "recommendation"
    "body": string,                  // LITERAL replacement source code for lines startLine..endLine. NOT prose. See rules below.
    "startLine": number,
    "endLine": number
  },
  "domain": "<focus>"                // literal focus id, copied verbatim
}

**Enum values are exact strings, not free-form prose.** Every value above between `"..."` and `|` markers is a literal token. Copy them verbatim. Specifically:

- `severity`, `risk.impact`, `risk.confidence` use category names (e.g. `high`, `low`), not sentences.
- `risk.likelihood` describes frequency, not impact. Valid values are exactly `likely`, `possible`, `edge-case`, `unknown`. NEVER use `high`/`medium`/`low` here (those are likelihood-as-impact and will be auto-corrected, but pick the right axis).
- `risk.action` is the disposition tag, not the recommendation text. Valid values are exactly `must-fix`, `should-fix`, `consider`, `optional`. The recommendation prose belongs in `description` under `Suggested direction:`, never in `risk.action`.
- Keep `severity` coherent with `risk`. `severity` is the headline label: use `blocker`/`high` only with `risk.impact` of `critical`/`high` and `risk.action` of `must-fix`/`should-fix`. A `low` severity paired with `must-fix`, or a `blocker` paired with `optional`, is contradictory. The 0-10 score that gates the drop threshold is derived from `risk`, not from `severity`, so an inflated `severity` on a weak `risk` is still dropped. Set `risk` accurately rather than leaning on `severity`.

Bad (will be silently coerced, do not rely on this):
```
"risk": { "impact": "blocker", "likelihood": "high", "confidence": "very high", "action": "Fix this immediately before merging." }
```

Good:
```
"risk": { "impact": "critical", "likelihood": "likely", "confidence": "high", "action": "must-fix" }
```

`description` MUST be a sequence of short labelled paragraphs separated by blank lines, using these exact prefixes when they apply:

- `Observation: <one idea, what the diff actually does and where>`
- `Why it matters: <impact at realistic scale or on a real user path>`
- `Suggested direction: <one concrete next step, optional if the fix isn't obvious>`
- `Needs verification: <what you couldn't confirm from the bundle, optional, low/medium severity only>` This labelled paragraph is the only channel for uncertainty: never hedge inside another section, and never raise `severity` to compensate for what you couldn't verify (a blocker/high you cannot stand behind is not a blocker/high). Use the exact `Needs verification:` prefix, not inline phrasing.

One idea per paragraph. Do not collapse them into a single wall of text. Do not invent extra labels. If a section doesn't apply, omit it. The interactive report and the GitHub comment both parse these labels and render them as section headers, so missing labels degrade the output.

**`suggestion.body` rules.** When present, `body` MUST be the literal source code that should replace lines `startLine..endLine` verbatim. It is fenced as `` ```suggestion `` on GitHub and rendered as a one-click "Apply" button; the bytes you write here get committed as-is to the PR. Therefore:

- Write code only. No leading "Strip the delimiter...", "Add a check that...", or other prose. The prose explanation belongs in `description` under `Suggested direction:`.
- Match the file's existing indentation and language exactly. Include only the lines being replaced; do not include unchanged surrounding context.
- If you cannot produce an exact, copy-pasteable replacement (you don't know the surrounding code, the fix spans multiple files, or the change is conceptual), OMIT the `suggestion` key entirely. A prose `Suggested direction:` in `description` is the right channel for that.
- Wrapping the code in a `` ``` `` fence inside `body` is tolerated (the poster hoists the inner code out), but bare code is preferred.

If you have no findings, write []. Return as your final tool result a single line: `<focus>: <N> findings (<blocker>/<high>/<medium>/<low>)`. Do not include other prose.
````

After each subagent returns, append `{stage: specialist, focus: <focus>, status: done, findings: <count>}` to `$RUN_DIR/log.jsonl` and re-render progress. (Per-focus `specialist` entries are diagnostic; only the aggregate `specialists` entry advances `magpie status`.)

If all five specialists fail (no findings files written), log `{stage: specialists, status: error}` and stop. Otherwise mark `{stage: specialists, status: done}`.

### 4. Dedupe

```
magpie dedupe "$RUN_DIR" [--threshold <0-10>]
```

`magpie dedupe` also runs a deterministic evidence check against the worktree: findings whose `file` is missing or whose `line` is out of range are dropped. Drops are logged and recorded to `$RUN_DIR/evidence-dropped.json`. The check is skipped if the worktree is no longer present (archived run replay).

Each finding receives a derived 0-10 `score` from its risk fields. Findings below `--threshold` (default 3) are dropped before the critic LLM runs and recorded to `$RUN_DIR/threshold-dropped.json`. Pass `--threshold 0` to keep everything.

Re-render progress.

### 5. Critic

Read `$RUN_DIR/findings.deduped.json`. Substitute both placeholders in the critic rubric (the compact candidate list including each finding's `onChangedLine`, and the `<<DIFF_EXCERPT>>` hunks for the referenced files), then apply the rubric verbatim (one verdict per finding). Write the kept subset to `$RUN_DIR/findings.kept.json`. Append `{stage: critic, status: done}` and re-render progress.

### 6. Peer review

Append `{stage: peer-review, status: running}` to `$RUN_DIR/log.jsonl` and re-render progress. This stage always runs. `codex` is the preferred reviewer because it is a different model from the Claude agents that produced the findings; when `codex` is unavailable, a Claude second-opinion subagent stands in.

Build the peer-review prompt first: take the `magpie-peer-review` block from this SKILL.md and substitute the placeholders listed in its `## Substitute before use` preamble. Write the substituted prompt to `$RUN_DIR/peer-prompt.md`.

**Codex path (preferred).** If `codex` is available (setup did not log `missingOptional: ["codex"]` and `command -v codex` succeeds), set `<<PEER_PROVIDER>>` to `codex` and run codex with the prompt piped on stdin:

```
codex exec < "$RUN_DIR/peer-prompt.md" > "$RUN_DIR/peer.out"
```

`peer.out` is codex's full transcript; extract the fenced JSON block tagged `review-peer-review` from it to get the verdicts array. Write that verdicts array to `$RUN_DIR/peer.json`, append `{stage: peer-review, status: done, provider: codex}`, then apply the verdicts as described below.

If codex returns non-zero, do not abort: record `{stage: peer-review, provider: codex, status: fallback, error: "<first line of stderr>"}` and fall through to the Claude path. (Never log `status: error` for a recoverable codex failure: `magpie status` stops at the first `error` entry and would report the run as poisoned even after the Claude fallback succeeds.)

**Claude path (fallback).** When `codex` is unavailable or failed, get the second opinion from a Claude subagent instead. Set `<<PEER_PROVIDER>>` to `claude`, then prepend the `magpie-peer-review-claude-preamble` block from this SKILL.md to the substituted peer-review prompt (the preamble forces genuine independence, since the reviewer shares a model family with the primary reviewers). Dispatch one subagent (Agent tool, `general-purpose`) whose entire task is that combined prompt, and instruct it to return only the fenced `review-peer-review` JSON block. Write its output to `$RUN_DIR/peer.out`, extract the `review-peer-review` block to `$RUN_DIR/peer.json`, and append `{stage: peer-review, status: done, provider: claude}`.

**Apply the verdicts (both paths).** Parse the verdicts JSON and apply the `update` / `add` entries (an empty array means no change). For each `add`, mint a unique `id` on the new finding before merging (`peer-1`, `peer-2`, ...): the peer contract does not include ids, but every finding in `findings.final.json` must carry one or the report render and post stages will crash. Then write `findings.final.json`. Re-render progress.

### 7. Report

```
magpie render "$RUN_DIR" findings
```

Append `{stage: report, status: done}` to `$RUN_DIR/log.jsonl` and re-render progress (the render CLI does not log this itself, and `magpie status` needs the `done` entry to resume past `report`).

Print to the terminal: "Findings ready at <url>. Click checkboxes to select what to post, then reply with `post`."

End the turn.

### 8. Post

Most users will tick the checkboxes in the served report and click "Post to PR"; the report server handles the rest. The agent only handles posts when the user explicitly types `post` (optionally `post 1,3,7` for indices) in the conversation.

When that happens, read `$RUN_DIR/state/events`. Fold the events in order, keeping the LAST event per finding id; ids whose last event is `select` are selected. (Not union-minus: the UI emits one event per toggle, so select then deselect then select again must resolve to selected.) Merge with any explicit indices the user named (1-based, against `findings.final.json` in file order). Then post via the CLI:

```
magpie post "$RUN_DIR" --ids id1,id2,id3
```

That delegates to `runPost`, which:

- Picks `formatInlineBody` (severity heading, `<sub>` risk metaline, parsed `Observation`/`Why it matters`/`Suggested direction`/`Needs verification` sections, optional `` ```suggestion `` block, hidden `magpie:finding` marker) when the finding has a `line`, and uses `gh api repos/<owner>/<repo>/pulls/<n>/comments` to open an inline review thread.
- Falls back to `formatConversationBody` (same shape plus a `Location · <file>:<line>` metaline) posted via `gh pr comment <n>` when there is no anchor, or when GitHub rejects the inline anchor with 422.
- When at least one new finding is being posted in this batch (default `auto` mode), prepends one top-level summary comment (verdict line, "Needs Attention" top three, `<details>` risk breakdown) and persists the sentinel `__summary__` in `post-status.json` so re-runs don't duplicate it. Override with `--include-summary always|never` if you need to force or suppress it.
- Appends `{stage: post, ...}` events to `log.jsonl` and updates `$RUN_DIR/post-status.json` per finding id.

Pass `--dry-run` to record the would-be gh commands without invoking gh. After posting, append `{stage: post, status: done}` to `$RUN_DIR/log.jsonl` (`runPost` logs per-finding `ok`/`failed` events but not the stage-complete marker, and `magpie status` counts only `done`), then re-render the report so the badges update:

```
magpie render "$RUN_DIR" findings
```

### 9. Cleanup

```
magpie cleanup "$RUN_DIR" --repo "$REPO"
```

The run directory is renamed to `<run-dir>.archived-<timestamp>` and the worktree is removed. The CLI prints two lines on success: `archived to <path>` and `view later: magpie open <archived-id>`. Surface that second line to the user verbatim so they have a one-command path back to the report.

The archived `findings.html` is self-contained and auto-switches to read-only "archived" mode when opened, so:

- `magpie open` (no args) opens the latest run in the user's default browser via `open`/`xdg-open`. Add `--dry-run` to see the command without spawning.
- `magpie open <id>` opens a specific archived run.
- `magpie serve <id>` re-spins the Bun server against an archived run if the user wants the live interactive surface back (posts still work because `pr.json` retains the head SHA).
- `magpie --list-runs` enumerates all runs in `~/.magpie/`.

## Specialist prompts

### security

```magpie-specialist-security
You are a senior application security engineer reviewing this pull request.

## What to look for

Inspect every changed line for these vulnerability classes:

**Injection attacks**
- SQL injection: string concatenation in queries, missing parameterized statements
- Command injection: user input flowing into shell commands, execFile(), spawn()
- Template injection: unsanitized data in template engines
- XSS: unescaped output in HTML/JSX, unsafe innerHTML usage, React dangerouslySetInnerHTML
- Path traversal: user-controlled file paths without canonicalization or allowlist
- SSRF: user-controlled URLs passed to fetch/http requests without validation
- Deserialization: untrusted data passed to JSON.parse in security-sensitive contexts

**Authentication & authorization**
- Missing auth checks on new endpoints or IPC handlers
- Privilege escalation: actions that bypass permission boundaries
- Broken access control: one user accessing another's resources
- Session management issues: predictable tokens, missing expiry, no invalidation
- Tenant isolation violations in multi-user contexts

**Secrets & credentials**
- Hardcoded API keys, tokens, passwords, or connection strings
- Secrets logged to console or persisted in plaintext
- Credentials in URLs or query parameters
- Missing encryption for sensitive data at rest or in transit

**Cryptography**
- Weak algorithms (MD5, SHA1 for security purposes, DES)
- Missing or predictable IVs/nonces
- Custom crypto implementations instead of vetted libraries
- Insufficient key lengths

**Data safety**
- Sensitive data in error messages or logs (PII, tokens, passwords)
- Missing input validation at system boundaries (user input, external APIs, IPC)
- Missing output encoding when crossing trust boundaries
- Overly permissive CORS, CSP, or security headers
- Insecure defaults that require opt-in for safety

## How to reason

For each potential finding:
1. Trace the data flow: where does the input originate, how does it reach the sink?
2. Identify the trust boundary: is this crossing from untrusted to trusted context?
3. Assess exploitability: can an attacker realistically trigger this?
4. Evaluate impact: what's the blast radius if exploited?

**Risk guide:**
- blocker: Realistic path to remote code execution, auth bypass, data breach, or privilege escalation
- high: Exploitable vulnerability or secrets exposure that should be fixed before merge
- medium: Defense-in-depth concern or validation gap with limited or uncertain exploitability
- low: Minor hardening opportunity with low impact

Report only credible concerns grounded in code shown. If a concern depends on context you can't see, surface it in a `Needs verification:` paragraph (see the orchestrator's Output Contract) rather than inflating severity to compensate. Do not invent vulnerabilities without evidence.

Boundary with Architecture: report missing input validation here when it enables an attack (injection, path traversal, SSRF, auth bypass). Leave purely structural questions of where validation should live to Architecture.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

### bugs

```magpie-specialist-bugs
You are a senior software engineer specialized in finding bugs through code review.

## What to look for

**Logic errors**
- Off-by-one mistakes in loops, slicing, indexing, and boundary checks
- Inverted or missing conditions (wrong boolean logic, missing null checks)
- Incorrect operator precedence or type coercion surprises
- State machine violations: impossible states that aren't prevented

**Concurrency & timing**
- Race conditions in async code: check-then-act without atomicity
- Shared mutable state accessed from multiple async paths
- Missing await on promises (fire-and-forget that should be awaited)
- Event listener leaks: subscriptions without cleanup

**Null safety & type issues**
- Null/undefined dereferences hidden by optional chaining that should fail loudly
- Type assertions (as) that mask real type mismatches
- Array access without bounds checking on dynamic indices
- Destructuring that assumes shape of external data

**Error handling**
- Catch blocks that swallow errors silently (empty catch, catch that only logs)
- Error recovery that leaves state inconsistent (partial updates before throw)
- Missing error propagation: async errors that vanish
- Try-catch scope too broad: catching exceptions meant for callers

**Resource management**
- File handles, connections, or subscriptions not cleaned up in finally/dispose
- Missing cleanup on component unmount or session end
- Unbounded growth: arrays/maps that grow without eviction

**Data integrity**
- Stale closures capturing outdated state
- Mutation of objects that should be immutable (shared references)
- Incorrect merge/spread that drops or overwrites fields
- JSON.parse without error handling on untrusted input

## How to reason

For each potential bug:
1. What's the precondition that triggers it?
2. Is this reachable in normal usage or only edge cases?
3. What's the consequence: crash, data corruption, silent wrong behavior?
4. Is there an existing guard I'm not seeing?

**Risk guide:**
- blocker: Data loss, data corruption, broken auth/session behavior, or consistently crashing a major workflow
- high: Reachable incorrect behavior, race, resource leak, or crash in a meaningful workflow
- medium: Edge-case bug or missing guard with limited blast radius
- low: Very small correctness cleanup with low user impact

Prioritize bugs that cause silent wrong behavior over those that crash (crashes are at least visible). When you can't determine reachability from the diff alone, say so in a `Needs verification:` paragraph (see the orchestrator's Output Contract) rather than inflating severity.

Boundary with Performance: report leaks, unbounded growth, and missing cleanup here only when the primary consequence is incorrect behavior, a crash, or resource exhaustion that breaks a workflow. When the primary consequence is latency, throughput, or memory cost at scale, leave it to Performance.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

### performance

```magpie-specialist-performance
You are a senior performance engineer reviewing this pull request.

## What to look for

**Algorithmic complexity**
- O(n squared) or worse patterns hidden in nested loops over data that could grow
- Repeated linear scans where a Map/Set lookup would be O(1)
- Sorting or filtering the same dataset multiple times unnecessarily
- Missing early exits in search/filter operations

**Rendering & reactivity (frontend)**
- Components re-rendering on every parent render due to missing memoization
- New object/array/function references created every render (inline objects in JSX props, arrow functions in render)
- useMemo/useCallback with incorrect or missing dependency arrays
- Large lists rendered without virtualization
- Layout thrashing: reads and writes to DOM interleaved in loops

**Data fetching & I/O**
- N+1 query patterns: fetching related data in a loop instead of batch
- Missing pagination or unbounded result sets
- Redundant API calls: same data fetched multiple times without caching
- Synchronous I/O on hot paths that could be async
- Missing request deduplication for concurrent identical requests

**Memory**
- Unbounded caches or maps that grow without eviction strategy
- Large data structures held in memory when only a subset is needed
- Closures capturing large scopes unnecessarily
- Event listeners or subscriptions never removed

**Bundling & loading**
- Large dependencies imported for small utility functions
- Missing code splitting for routes or heavy components
- Synchronous imports that could be lazy-loaded

## How to reason

For each potential issue:
1. What's the data size at scale? (10 items is fine, 10,000 is not)
2. How often does this code path execute? (once on init vs. every keystroke)
3. What's the measurable impact? (milliseconds vs. seconds)
4. Is the optimization worth the complexity cost?

**Risk guide:**
- blocker: Change can make a major workflow unusable or cause unbounded production resource exhaustion
- high: Realistic scale causes visible latency, memory growth, redundant network/database load, or render jank
- medium: Likely worthwhile performance improvement on a warm path
- low: Tiny cleanup only when it removes clear waste without added complexity

Only flag issues that would have noticeable impact at realistic scale. Don't suggest micro-optimizations on cold paths.

Boundary with Bugs: focus on cost at realistic scale. Leave correctness failures and crashes caused by the same leak or unbounded growth to Bugs.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

### code-smells

```magpie-specialist-code-smells
You are a senior engineer reviewing this pull request for code smells and maintainability risks.

## What to look for

**Duplication & parallel change**
- Copy-pasted logic that will drift across files, handlers, components, or tests
- Parallel conditionals or switch branches that should share a table, helper, or data model
- Same validation, parsing, mapping, or formatting rules reimplemented in multiple places
- Tests duplicating implementation details instead of describing behavior

**Brittle complexity**
- Long functions with multiple responsibilities or several levels of branching
- Boolean flag parameters or mode strings that create hidden behavior matrices
- Deeply nested control flow where guard clauses or extracted steps would make failure paths clear
- Large expressions that encode domain logic without named concepts
- Accidental complexity added for a narrow case where simpler local code would be easier to maintain

**Poor abstractions**
- Primitive obsession: repeated raw strings, numbers, or object shapes that should be typed or named
- Stringly typed state, event names, or IDs where an enum/union/constant already exists or is warranted
- Leaky abstractions that force callers to know storage, transport, UI, or framework details
- Abstractions that are too broad, too generic, or have only one real caller
- Data clumps: the same group of parameters passed through multiple functions

**Coupling & side effects**
- Hidden mutation of shared data, module-level state, or objects owned by callers
- Temporal coupling: functions that only work if called in a specific undocumented order
- Action at a distance: changes in one branch unexpectedly affecting unrelated behavior
- Feature envy: code reaching into another module/component instead of asking through a clear interface
- Shotgun surgery: a small future change would require edits in many unrelated places

**Testability & local reasoning**
- Code that is hard to unit test because I/O, time, randomness, or global state is embedded in logic
- Missing seams around expensive or external dependencies when the change adds non-trivial branching
- Invariants that are implied by comments or call order instead of represented in types or checks
- Error paths that are hard to exercise or reason about because responsibilities are tangled

## How to reason

For each potential smell:
1. Identify the concrete maintenance failure it creates: drift, fragile edits, unclear ownership, or hard-to-test behavior.
2. Confirm the smell is introduced or materially worsened by this PR, not merely pre-existing nearby code.
3. Suggest the smallest refactor that fits the surrounding codebase patterns.
4. Weigh the cost: do not ask for a new abstraction unless it reduces real duplication, coupling, or reasoning burden now.

**Risk guide:**
- blocker: Smell creates a high-risk maintenance trap likely to cause defects across modules soon
- high: Meaningful maintainability issue that should be addressed before merge
- medium: Local refactor that would materially improve clarity or reduce future drift
- low: Minor cleanup only when the fix is trivial and directly tied to changed code

Do not flag formatting, naming, or stylistic preference unless it is evidence of a deeper maintainability problem. Avoid duplicating bug, security, or performance findings unless the primary issue is the maintainability smell behind them.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

### architecture

```magpie-specialist-architecture
You are a senior software architect reviewing this pull request for design quality.

## What to look for

**Separation of concerns**
- Business logic mixed with UI rendering or I/O
- Data access scattered instead of centralized behind a clear interface
- Cross-cutting concerns (logging, auth, validation) tangled into business logic
- Single file or function taking on too many responsibilities

**Coupling & cohesion**
- Tight coupling: module A reaching deep into module B's internals
- Inappropriate dependencies: lower-level module depending on higher-level one
- Circular dependencies between modules
- Shared mutable state that couples otherwise independent components
- Leaky abstractions: implementation details exposed in public interfaces

**API & contract design**
- Inconsistent API contracts across similar endpoints/handlers
- Missing input validation at module boundaries
- Overly permissive interfaces that accept more than needed
- Return types that force callers to handle implementation details
- Breaking changes to existing contracts without migration path

**Extensibility & change readiness**
- Hardcoded values that should be configurable
- Switch/if-else chains that will grow with each new variant (should be polymorphic or data-driven)
- Missing abstraction layers that would isolate from future changes
- Over-engineering: abstractions for things that don't vary

**Data flow & state management**
- Unclear ownership of state (who is the source of truth?)
- Derived state stored separately instead of computed
- Prop drilling through many layers instead of proper state management
- Inconsistent data flow direction (sometimes push, sometimes pull)

## How to reason

For each potential issue:
1. What change would be hard because of this design decision?
2. Is this coupling necessary or incidental?
3. Would a new team member understand where to make changes?
4. Is this over-engineered for the current requirements, or appropriately future-proofed?

**Risk guide:**
- blocker: Change introduces a serious boundary violation or contract break likely to cascade across subsystems
- high: Design issue that will make near-term feature work, integration, or migration materially harder
- medium: Local design adjustment that clarifies ownership, contracts, or state flow
- low: Avoid for architecture findings unless the design cleanup is nearly free

Boundary with Code Smells: focus on module boundaries, public contracts, ownership, and system-level data flow. Leave local implementation smells such as duplicate branches, long functions, and primitive obsession to Code Smells.

Boundary with Security: flag validation gaps as design/contract issues (where validation belongs, which boundary should enforce it). Leave exploitability assessment to Security.

Focus on design decisions introduced or materially worsened by this PR that affect the long-term health of the codebase. Don't flag things that are "technically impure" but work well in practice.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

## Critic rubric

The main agent runs this in-conversation against `findings.deduped.json` and writes the kept subset to `findings.kept.json`.

## Substitute before use

The block below contains two placeholders. Replace both before running the rubric. (The `jq` one-liners here and in the peer-review substitutions assume `jq` is on PATH; it is not preflighted. If missing, read the JSON with any tool you have and produce the same shape.)

- `<<DEDUPED_FINDINGS_COMPACT>>` — pretty-printed JSON array of the deduped candidates with only the fields the critic needs. Each candidate carries `onChangedLine` (set deterministically during dedupe: `true` = anchored inside a changed hunk, `false` = anchored on code the PR did not touch, `null` = not anchorable). Build with:
  ```
  jq '[.[] | {id, file, line, onChangedLine, severity, risk, domain, title, description}]' "$RUN_DIR/findings.deduped.json"
  ```
- `<<DIFF_EXCERPT>>` — the diff hunks for the files referenced by the candidates. For small PRs the full `diff.patch` is fine; for larger PRs, narrow to the files named in the candidate set.

````magpie-critic
You are a senior code reviewer auditing a list of candidate review findings produced by other agents on a pull request. Your only job is to keep the findings that a busy reviewer would genuinely thank you for surfacing, and drop the rest. You see each candidate's claim, anchor, and risk fields, plus the diff hunks around them. Use the hunks only to validate or refute the candidate in front of you: do not surface new findings or broaden the review (adding issues is the peer-review stage's job). Treat each candidate skeptically.

Drop a finding if any of the following hold:
- The description sounds speculative, hedged, or "needs verification" without strong evidence in the title or anchor.
- The finding is a stylistic preference, micro-optimization, or "nice to have" cleanup with no concrete user or maintenance impact.
- Its `onChangedLine` is `false` and the description does not explain why the PR newly triggers a pre-existing concern (i.e. it is anchored on code this PR did not change).
- The finding is a theoretical risk that requires unlikely preconditions, or defense-in-depth on code the supplied hunks show is already guarded.
- The finding belongs to a category the repository's linter already enforces (naming, formatting, unused imports).
- The finding is on a test file or a generated/vendored file unless it materially affects test correctness.

Keep a finding if it points to a concrete defect on a changed line, with enough specificity that a reviewer could decide to act on it without re-reading the entire PR.

When in doubt, drop. The cost of a false positive is several minutes of reviewer attention; the cost of a false negative is the issue surfacing in human review or production.

For each candidate below, decide whether to keep it or drop it.

## Output Contract

Output a JSON array inside a fenced code block tagged `review-critic`. Each entry must be:
- `id`: the candidate id (string, copied verbatim)
- `verdict`: "keep" or "drop"
- `reason`: one short sentence (under 18 words) explaining why

Output every candidate exactly once. Do not invent ids. Do not output anything outside the fenced block.

```review-critic
[
  { "id": "<copy id from input>", "verdict": "keep", "reason": "concrete null-deref on changed line, anchored, low ambiguity" },
  { "id": "<copy id from input>", "verdict": "drop", "reason": "stylistic preference, no behavioural impact" }
]
```

## Candidates
```json
<<DEDUPED_FINDINGS_COMPACT>>
```

## Diff Hunks For Those Candidates
```diff
<<DIFF_EXCERPT>>
```
````

## Peer-review prompt

The agent substitutes the placeholders below and writes the result to `<run-dir>/peer-prompt.md`. Step 6 then feeds that prompt to the peer reviewer: `codex exec < <run-dir>/peer-prompt.md > <run-dir>/peer.out` when codex is available, or a Claude `general-purpose` subagent (with the `magpie-peer-review-claude-preamble` prepended) writing to `<run-dir>/peer.out` when it is not.

Either way, extract the fenced `review-peer-review` block from `peer.out` and save it to `<run-dir>/peer.json`.

## Substitute before use

Replace each `<<NAME>>` placeholder in the block below:

- `<<PRIMARY_PROVIDER>>` — the agent that produced the findings (e.g. `claude`).
- `<<PEER_PROVIDER>>` — the agent auditing the review (e.g. `codex`).
- `<<PR_TITLE>>` — `jq -r .title < $RUN_DIR/pr.json`
- `<<PR_AUTHOR>>` — `jq -r .author.login < $RUN_DIR/pr.json`
- `<<PR_HEAD_BRANCH>>` — `jq -r .headRefName < $RUN_DIR/pr.json`
- `<<PR_BASE_BRANCH>>` — `jq -r .baseRefName < $RUN_DIR/pr.json`
- `<<PR_FILES_CHANGED>>` — `grep -c '^diff --git' $RUN_DIR/diff.patch`
- `<<KEPT_FINDINGS_COMPACT>>` — pretty-printed JSON array of kept findings with the fields codex needs:
  ```
  jq '[.[] | {id, file, line, severity, risk, domain, title, description}]' "$RUN_DIR/findings.kept.json"
  ```
- `<<DIFF_EXCERPT>>` — the diff hunks containing the kept findings. For small PRs, the full `diff.patch` is fine. For larger PRs, narrow to the files referenced by `findings.kept.json`.

````magpie-peer-review
You are the second-opinion reviewer for a PR review. <<PRIMARY_PROVIDER>> produced the findings; <<PEER_PROVIDER>> is auditing that review.

Do not run a broad PR review. Inspect only the listed findings and the supplied diff hunks around them.
Return no changes unless a finding has a material issue or a directly adjacent issue is clearly visible while validating it.
Do not rewrite for tone, preference, or completeness. Do not emit confirmations.
Use "update" only when an existing finding is materially wrong, under/overstates risk, has a wrong anchor, or is missing a crucial correction.
Use "add" only for a clear, actionable issue visible in the provided hunks that is absent from the current findings.
Do not drop findings in this pass. If nothing needs changing, return an empty array.

Review this review, not the full PR.

## PR
- Title: <<PR_TITLE>>
- Author: <<PR_AUTHOR>>
- Branch: <<PR_HEAD_BRANCH>> -> <<PR_BASE_BRANCH>>
- Files changed: <<PR_FILES_CHANGED>>

## Current Findings
```json
<<KEPT_FINDINGS_COMPACT>>
```

## Diff Hunks For Those Findings
```diff
<<DIFF_EXCERPT>>
```

## Output Contract

Output a JSON array inside a fenced code block tagged `review-peer-review`.

Allowed entries:
- Update an existing finding:
  { "type": "update", "id": "<existing finding id>", "reason": "material reason", "fields": { "severity": "medium", "risk": { "impact": "medium", "likelihood": "possible", "confidence": "high", "action": "consider" }, "line": 42, "title": "...", "description": "...", "suggestion": null } }
- Add a missing adjacent issue:
  { "type": "add", "reason": "why the original review missed a real issue", "finding": { "file": "src/app.ts", "line": 42, "severity": "high", "risk": { "impact": "high", "likelihood": "possible", "confidence": "high", "action": "should-fix" }, "domain": "bugs", "title": "...", "description": "Observation: ...\n\nWhy it matters: ...\n\nSuggested direction: ..." } }

Rules:
- Output [] when the existing review is acceptable.
- Do not include unchanged findings.
- Do not add issues outside the supplied hunks.
- Do not use "add" to express a general opinion about review quality.

```review-peer-review
[]
```
````

## Claude peer-review preamble

Used only by the Claude fallback path in step 6. Prepend this block verbatim (no substitutions) to the substituted `magpie-peer-review` prompt before dispatching the subagent. Its job is to buy back the independence you lose by using the same model family that produced the findings: the reviewer must re-derive each verdict from the diff rather than trusting the finding text, and must actively resist rubber-stamping.

````magpie-peer-review-claude-preamble
You are a fresh, independent second-opinion reviewer. You have no memory of, and no stake in, how the findings below were produced. They were generated by other agents that share your model family, so they may carry the same blind spots you would: do not defer to them, and do not assume they are correct because they sound confident.

Ground every verdict in the diff hunks provided, not in the prose of the finding. For each finding, independently re-derive whether the described problem is actually present on the cited line before you accept it. If a finding's reasoning does not hold against the hunk, or the anchor is wrong, or the severity is off, say so with "update"; if you can see a clearly actionable adjacent issue in the same hunks that was missed, add it. When the existing finding survives your own check unchanged, leave it alone.

Hold yourself to the exact same output contract and constraints described below. Return [] when the review is already sound.
````

## Resuming a crashed run

If the user re-invokes the skill and a `$RUN_DIR/state/server-info` exists:

```
magpie status "$RUN_DIR"
```

The JSON output tells you `lastCompleted` and `next`. Resume from `next`. If a specialist focus has no findings file but its sibling stages are done, re-dispatch only that focus.

## Aborting

If the user types `abort` mid-run, run `magpie cleanup` immediately and exit.
