---
name: pylon-pr-review
description: Interactive PR review pipeline. Runs five parallel specialist subagents (security, bugs, performance, code-smells, architecture), dedupes findings, applies a critic rubric, peer-reviews via codex exec, and serves an interactive HTML report for selecting findings to post via gh. Use when the user asks to review a GitHub pull request.
---

# Pylon PR Review

## Prerequisites

The skill pre-flights `bun`, `gh`, `codex`, `git`. If any are missing the run aborts with a single install hint line.

## Stage walkthrough

Stop reading and follow these steps in order. Do not skip stages. Use the exact Bash invocations below.

### 0. Identify the PR

Parse the user's request for a PR number, URL, or "this PR" (current branch). If ambiguous, ask one clarifying terminal question. Capture the PR number into `$PR_NUMBER` and the repository path into `$REPO` (default: current working directory).

Compute the run directory:

```
RUN_ID="pr-${PR_NUMBER}-$(date +%s)"
RUN_DIR="$HOME/.pylon-review/$RUN_ID"
```

### 1. Setup

```
pr-review setup "$RUN_DIR" --pr $PR_NUMBER --repo "$REPO"
```

If exit is non-zero, surface stderr verbatim and stop. The CLI removes the worktree and subdirs on failure; the run directory itself plus `log.jsonl` are kept for diagnostics.

### 2. Serve

Start the HTML server in the background using the Bash tool with `run_in_background: true`:

```
pr-review serve "$RUN_DIR"
```

Read `$RUN_DIR/state/server-info` for the URL. Print to the user: "Open <url> in your browser to follow along."

Render the first progress paint:

```
pr-review render "$RUN_DIR" progress
```

### 3. Context (optional)

If the `mcp__code-intelligence__search_code` tool is available in this conversation, build the context bundle by calling code-intelligence MCP tools for each changed file and writing the result to `$RUN_DIR/pr-context.json`. If MCP is not available, log `{stage: context, status: skipped, reason: mcp-unavailable}` to `$RUN_DIR/log.jsonl` and continue. Re-render progress.

Expected shape of `pr-context.json`:

```json
{
  "symbols": [
    {
      "name": "createProject",
      "kind": "function",
      "file": "apps/server/src/resolvers/Mutation/createProject.ts",
      "line": 8,
      "definition": "<source of the symbol, trimmed>",
      "references": [
        { "file": "apps/server/src/resolvers/Mutation/index.ts", "line": 5, "context": "<one-line snippet>" }
      ],
      "tests": [
        { "file": "apps/server/src/resolvers/Mutation/__tests__/createProject.test.ts", "line": 12, "context": "<one-line snippet>" }
      ]
    }
  ]
}
```

Cap `references` at 20 per symbol; include only tests that import or call the symbol.

### 4. Specialists

Dispatch the five specialist subagents in a single message using five Agent tool calls in parallel. For each focus in (security, bugs, performance, code-smells, architecture), the prompt is:

```
<specialist block for focus from this SKILL.md>

You are reviewing PR #<PR_NUMBER>.
Working directory: $RUN_DIR/worktree
Diff: $RUN_DIR/diff.patch
Code context (if exists): $RUN_DIR/pr-context.json

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
  "description": string,             // multi-paragraph; cite code with file:line
  "suggestion": {                    // OPTIONAL; omit the key entirely if not applicable. NOT "recommendation"
    "body": string,
    "startLine": number,
    "endLine": number
  },
  "domain": "<focus>"                // literal focus id, copied verbatim
}

If you have no findings, write []. Return as your final tool result a single line: `<focus>: <N> findings (<blocker>/<high>/<medium>/<low>)`. Do not include other prose.
```

After each subagent returns, append `{stage: specialist, focus: <focus>, status: done, findings: <count>}` to `$RUN_DIR/log.jsonl` and re-render progress. (Per-focus `specialist` entries are diagnostic; only the aggregate `specialists` entry advances `pr-review status`.)

If all five specialists fail (no findings files written), log `{stage: specialists, status: error}` and stop. Otherwise mark `{stage: specialists, status: done}`.

### 5. Dedupe

```
pr-review dedupe "$RUN_DIR"
```

Re-render progress.

### 6. Critic

Read `$RUN_DIR/findings.deduped.json`. Apply the critic rubric from this SKILL.md verbatim (one verdict per finding). Write the kept subset to `$RUN_DIR/findings.kept.json`. Append `{stage: critic, status: done}` and re-render progress.

### 7. Peer review

Build the peer-review prompt by taking the `pr-review-peer-review` block from this SKILL.md and substituting the placeholders listed in its `## Substitute before use` preamble. Write the substituted prompt to `$RUN_DIR/peer-prompt.md`. Then run codex with the prompt piped on stdin:

```
codex exec < "$RUN_DIR/peer-prompt.md" > "$RUN_DIR/peer.out"
```

`peer.out` is codex's full transcript; extract the fenced JSON block tagged `review-peer-review` from it to get the verdicts array. Write that verdicts array to `$RUN_DIR/peer.json` for record-keeping.

If codex returns non-zero, ask the user once: "Codex peer-review failed: <stderr>. Skip peer-review and proceed, or abort?". On "skip", copy `findings.kept.json` to `findings.final.json` and add `{stage: peer-review, status: skipped}`.

Otherwise parse the verdicts JSON, apply them (drop / downgrade), and write `findings.final.json`. Append `{stage: peer-review, status: done}` and re-render progress.

### 8. Report

```
pr-review render "$RUN_DIR" findings
```

Print to the terminal: "Findings ready at <url>. Click checkboxes to select what to post, then reply with `post`."

End the turn.

### 9. Post

On the user's next message, if they say `post` (or `post 1,3,7` for explicit indices), read `$RUN_DIR/state/events`. Compute the latest selection set (union of `select` events minus `deselect`, plus any explicit indices from the user message). For each selected finding, post via `gh`:

- If the finding has `line`: `gh api repos/<owner>/<repo>/pulls/<n>/comments -X POST -F body=<body> -F commit_id=<head_sha> -F path=<file> -F line=<line> -F side=RIGHT`
- Otherwise: `gh pr comment <n> --body <body>`

After each post, append `{stage: post, status: ok|failed, id: <finding-id>}` to `log.jsonl` and update `$RUN_DIR/post-status.json` ({"<finding-id>": "posted" | {"status": "failed", "message": "..."}}). When all selected findings are processed, re-render `findings.html`.

### 10. Cleanup

```
pr-review cleanup "$RUN_DIR" --repo "$REPO"
```

The run directory is renamed to `<run-dir>.archived-<timestamp>` and the worktree is removed.

## Specialist prompts

### security

```pr-review-specialist-security
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

Report only credible concerns grounded in code shown. If a concern depends on context you can't see, note it as "needs verification" in the description. Do not invent vulnerabilities without evidence.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

### bugs

```pr-review-specialist-bugs
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

Prioritize bugs that cause silent wrong behavior over those that crash (crashes are at least visible). Flag "needs verification" when you can't determine reachability from the diff alone.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

### performance

```pr-review-specialist-performance
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

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

### code-smells

```pr-review-specialist-code-smells
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

```pr-review-specialist-architecture
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

Focus on design decisions introduced or materially worsened by this PR that affect the long-term health of the codebase. Don't flag things that are "technically impure" but work well in practice.

Use the JSON schema defined in the orchestrator's `## Output Contract` block; do not invent fields.
```

## Critic rubric

The main agent runs this in-conversation against `findings.deduped.json` and writes the kept subset to `findings.kept.json`.

## Substitute before use

The block below contains one placeholder. Replace it before running the rubric.

- `<<DEDUPED_FINDINGS_COMPACT>>` — pretty-printed JSON array of the deduped candidates with only the fields the critic needs. Build with:
  ```
  jq '[.[] | {id, file, line, severity, risk, domain, title, description}]' "$RUN_DIR/findings.deduped.json"
  ```

````pr-review-critic
You are a senior code reviewer auditing a list of candidate review findings produced by other agents on a pull request. Your only job is to keep the findings that a busy reviewer would genuinely thank you for surfacing, and drop the rest. You do not see the diff itself; you only see what the candidate finding claims, its anchor, and its risk fields. Treat each candidate skeptically.

Drop a finding if any of the following hold:
- The description sounds speculative, hedged, or "needs verification" without strong evidence in the title or anchor.
- The finding is a stylistic preference, micro-optimization, or "nice to have" cleanup with no concrete user or maintenance impact.
- The finding is a pre-existing concern not introduced by the PR.
- The finding is a theoretical risk that requires unlikely preconditions, or defense-in-depth on already-defended code.
- The finding belongs to a category the repository's linter already enforces (naming, formatting, unused imports).
- The finding is on a test file or a generated/vendored file unless it materially affects test correctness.
- The finding duplicates another candidate at a similar anchor and is the weaker version.

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
````

## Peer-review prompt

The agent substitutes the placeholders below, writes the result to `<run-dir>/peer-prompt.md`, then runs:

```
codex exec < <run-dir>/peer-prompt.md > <run-dir>/peer.out
```

Then extract the fenced `review-peer-review` block from `peer.out` and save it to `<run-dir>/peer.json`.

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

````pr-review-peer-review
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

## Resuming a crashed run

If the user re-invokes the skill and a `$RUN_DIR/state/server-info` exists:

```
pr-review status "$RUN_DIR"
```

The JSON output tells you `lastCompleted` and `next`. Resume from `next`. If a specialist focus has no findings file but its sibling stages are done, re-dispatch only that focus.

## Aborting

If the user types `abort` mid-run, run `pr-review cleanup` immediately and exit.
