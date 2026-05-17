# PR Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Pylon's multi-stage PR review pipeline to an interactive Claude Code slash command (`/pr-review`) that runs entirely inside the user's Claude Code conversation, with bundled Bun scripts for deterministic stages and an HTML report for selecting findings to post.

**Architecture:** A skill markdown file plus a Bun-based CLI (`bin/pr-review`) with five subcommands (`setup`, `serve`, `dedupe`, `render`, `cleanup`). Five specialist subagents run in parallel via the Task tool, write findings to disk, then dedupe / critic / codex-peer-review stages consume them in order. An auto-spawned HTML server serves a progress page during the run and a findings-selection page at the end; the user clicks to pick findings, sends a terminal message, and the agent posts via `gh`.

**Tech Stack:** Bun, TypeScript, Biome (lint, format), bun:test, Bun.serve, `gh` CLI, `codex` CLI, `git worktree`. Skill source lives in the Pylon repo at `skills/pylon-pr-review/` and is installed by symlinking into `~/.claude/skills/`.

**Spec:** `docs/plans/2026-05-14-pr-review-skill-design.md`

---

## Phase 1: Scaffolding

### Task 1: Create skill directory structure and config files

**Files:**
- Create: `skills/pylon-pr-review/package.json`
- Create: `skills/pylon-pr-review/tsconfig.json`
- Create: `skills/pylon-pr-review/biome.json`
- Create: `skills/pylon-pr-review/.gitignore`
- Modify: `package.json` (root) to add `lint:skills`, `test:skills`, `typecheck:skills` scripts
- Modify: `.gitignore` (root) to ignore skill build artifacts

- [ ] **Step 1: Create the skill directory and config files**

```bash
mkdir -p skills/pylon-pr-review/bin
mkdir -p skills/pylon-pr-review/scripts
mkdir -p skills/pylon-pr-review/scripts/__tests__
mkdir -p skills/pylon-pr-review/templates
mkdir -p skills/pylon-pr-review/fixtures
```

Write `skills/pylon-pr-review/package.json`:

```json
{
  "name": "pylon-pr-review",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "bun test",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "tsc --noEmit"
  }
}
```

Write `skills/pylon-pr-review/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["bun-types"],
    "lib": ["ESNext"],
    "jsx": "preserve"
  },
  "include": ["bin/**/*.ts", "scripts/**/*.ts"]
}
```

Write `skills/pylon-pr-review/biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "extends": ["../../biome.json"],
  "files": {
    "include": ["bin/**", "scripts/**"]
  }
}
```

Write `skills/pylon-pr-review/.gitignore`:

```
node_modules/
.bun/
fixtures/runs/
```

- [ ] **Step 2: Wire skill-level scripts into root `package.json`**

Modify `/Users/dikrana/Documents/workspace/pylon/package.json`. Find the `scripts` block (after `"format": "biome format --write src/",` and before `"grammars:sync":`) and insert these three lines so the root commands also exercise the skill:

```json
    "test:skills": "cd skills/pylon-pr-review && bun test",
    "lint:skills": "cd skills/pylon-pr-review && bun run lint",
    "typecheck:skills": "cd skills/pylon-pr-review && bun run typecheck",
```

- [ ] **Step 3: Verify lint runs against the skill and finds no issues yet**

Run: `bun run lint:skills`
Expected: Exits 0 with "Checked 0 files" (no .ts files yet).

Run: `bun run typecheck:skills`
Expected: Exits 0 (tsc has no input files).

- [ ] **Step 4: Commit**

```bash
git add skills/pylon-pr-review/package.json skills/pylon-pr-review/tsconfig.json skills/pylon-pr-review/biome.json skills/pylon-pr-review/.gitignore package.json
git commit -m "feat(pr-review-skill): scaffold skill directory and config"
```

---

### Task 2: Create SKILL.md skeleton

**Files:**
- Create: `skills/pylon-pr-review/SKILL.md`

The SKILL.md skeleton has the frontmatter and section headers; content (specialist prompts, critic rubric, peer-review prompt, stage walkthrough) is filled in by Tasks 22-25. The skeleton is committed first so later tasks have a target to edit.

- [ ] **Step 1: Write `skills/pylon-pr-review/SKILL.md`**

```markdown
---
name: pylon-pr-review
description: Interactive PR review pipeline. Runs five parallel specialist subagents (security, bugs, performance, code-smells, architecture), dedupes findings, applies a critic rubric, peer-reviews via codex exec, and serves an interactive HTML report for selecting findings to post via gh. Use when the user asks to review a GitHub pull request.
---

# Pylon PR Review

## Prerequisites

The skill pre-flights `bun`, `gh`, `codex`, `git`. If any are missing the run aborts with a single install hint line.

## Stage walkthrough

(Filled in by Task 25.)

## Specialist prompts

(Filled in by Task 22.)

## Critic rubric

(Filled in by Task 23.)

## Peer-review prompt

(Filled in by Task 24.)

## Resuming a crashed run

(Filled in by Task 25.)
```

- [ ] **Step 2: Commit**

```bash
git add skills/pylon-pr-review/SKILL.md
git commit -m "feat(pr-review-skill): add SKILL.md skeleton"
```

---

### Task 3: Bun CLI entry point with subcommand router

**Files:**
- Create: `skills/pylon-pr-review/bin/pr-review`
- Create: `skills/pylon-pr-review/bin/pr-review.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/cli.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import { $ } from 'bun'

const CLI = new URL('../../bin/pr-review.ts', import.meta.url).pathname

test('unknown subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI, 'wat'], { stderr: 'pipe', stdout: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Unknown subcommand: wat')
  expect(stderr).toContain('Usage: pr-review <subcommand>')
})

test('no subcommand exits non-zero with usage', async () => {
  const proc = Bun.spawn(['bun', CLI], { stderr: 'pipe' })
  const exit = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  expect(exit).not.toBe(0)
  expect(stderr).toContain('Usage: pr-review <subcommand>')
})

test('--help prints usage and exits 0', async () => {
  const proc = Bun.spawn(['bun', CLI, '--help'], { stdout: 'pipe' })
  const exit = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  expect(exit).toBe(0)
  expect(stdout).toContain('Usage: pr-review <subcommand>')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/cli.test.ts`
Expected: FAIL with "could not resolve" for `bin/pr-review.ts`.

- [ ] **Step 3: Write `skills/pylon-pr-review/bin/pr-review.ts`**

```typescript
#!/usr/bin/env bun

const USAGE = `Usage: pr-review <subcommand> [args]

Subcommands:
  setup <run-dir> --pr <n>   Pre-flight, fetch PR, create worktree
  serve <run-dir>            Start the HTML server in the background
  dedupe <run-dir>           Merge specialist findings into deduped set
  render <run-dir> <page>    Render progress.html or findings.html
  cleanup <run-dir>          Remove worktree, stop server, archive run
  status <run-dir>           Print highest completed stage
  --list-runs                List archived runs
  --cleanup-run <id>         Delete an archived run
  --help                     Show this message`

type Handler = (args: string[]) => Promise<number> | number

const HANDLERS: Record<string, Handler> = {
  setup: async () => 0,
  serve: async () => 0,
  dedupe: async () => 0,
  render: async () => 0,
  cleanup: async () => 0,
  status: async () => 0,
  '--list-runs': async () => 0,
  '--cleanup-run': async () => 0,
}

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  const handler = HANDLERS[sub]
  if (!handler) {
    process.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}\n`)
    return 2
  }
  return await handler(rest)
}

const code = await main(process.argv.slice(2))
process.exit(code)
```

- [ ] **Step 4: Write `skills/pylon-pr-review/bin/pr-review` (shell shim)**

```bash
#!/usr/bin/env bash
exec bun "$(dirname "$0")/pr-review.ts" "$@"
```

Make it executable:

```bash
chmod +x skills/pylon-pr-review/bin/pr-review
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/cli.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/bin/pr-review skills/pylon-pr-review/bin/pr-review.ts skills/pylon-pr-review/scripts/__tests__/cli.test.ts
git commit -m "feat(pr-review-skill): add CLI entry point and subcommand router"
```

---

## Phase 2: Types and Dedupe

### Task 4: Types module

**Files:**
- Create: `skills/pylon-pr-review/scripts/types.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/types.test.ts`

The shape mirrors Pylon's `ReviewFinding` in `src/shared/types.ts` so dedupe logic ports without translation.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/types.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import type { ReviewFinding, FocusId } from '../types.ts'
import { FOCUS_IDS, parseFinding } from '../types.ts'

test('FOCUS_IDS contains the five default focuses', () => {
  expect(FOCUS_IDS).toEqual(['security', 'bugs', 'performance', 'code-smells', 'architecture'])
})

test('parseFinding accepts a minimal finding', () => {
  const raw = {
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    severity: 'high',
    risk: { impact: 'high', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: 'oops',
    description: 'detail',
    domain: 'bugs',
  }
  const parsed: ReviewFinding = parseFinding(raw)
  expect(parsed.title).toBe('oops')
  expect(parsed.domain).toBe('bugs')
})

test('parseFinding rejects an unknown severity', () => {
  expect(() =>
    parseFinding({
      id: 'f1',
      file: 'src/x.ts',
      line: 10,
      severity: 'panic',
      risk: { impact: 'high', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
      title: 't',
      description: 'd',
      domain: 'bugs',
    }),
  ).toThrow(/severity/)
})

test('parseFinding accepts null line', () => {
  const parsed = parseFinding({
    id: 'f1',
    file: 'src/x.ts',
    line: null,
    severity: 'low',
    risk: { impact: 'low', likelihood: 'edge-case', confidence: 'medium', action: 'consider' },
    title: 't',
    description: 'd',
    domain: 'code-smells',
  })
  expect(parsed.line).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/types.test.ts`
Expected: FAIL with module resolution error for `../types.ts`.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/types.ts`**

```typescript
export const FOCUS_IDS = ['security', 'bugs', 'performance', 'code-smells', 'architecture'] as const
export type FocusId = (typeof FOCUS_IDS)[number]

export const SEVERITIES = ['blocker', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export const IMPACTS = ['critical', 'high', 'medium', 'low'] as const
export type Impact = (typeof IMPACTS)[number]

export const LIKELIHOODS = ['likely', 'possible', 'edge-case', 'unknown'] as const
export type Likelihood = (typeof LIKELIHOODS)[number]

export const CONFIDENCES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const ACTIONS = ['must-fix', 'should-fix', 'consider', 'optional'] as const
export type Action = (typeof ACTIONS)[number]

export type Risk = {
  impact: Impact
  likelihood: Likelihood
  confidence: Confidence
  action: Action
}

export type Suggestion = {
  body: string
  startLine: number
  endLine: number
}

export type MergedFromEntry = {
  domain: string
  title: string
}

export type ReviewFinding = {
  id: string
  file: string
  line: number | null
  severity: Severity
  risk: Risk
  title: string
  description: string
  suggestion?: Suggestion
  domain: FocusId | string | null
  mergedFrom?: MergedFromEntry[]
}

function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Invalid ${field}: ${JSON.stringify(value)} (allowed: ${allowed.join(', ')})`)
  }
}

export function parseFinding(raw: unknown): ReviewFinding {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Finding must be an object, got ${typeof raw}`)
  }
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') throw new Error('Finding.id must be string')
  if (typeof r.file !== 'string') throw new Error('Finding.file must be string')
  if (r.line !== null && typeof r.line !== 'number') {
    throw new Error('Finding.line must be number or null')
  }
  assertOneOf(r.severity, SEVERITIES, 'severity')
  if (!r.risk || typeof r.risk !== 'object') throw new Error('Finding.risk must be object')
  const risk = r.risk as Record<string, unknown>
  assertOneOf(risk.impact, IMPACTS, 'risk.impact')
  assertOneOf(risk.likelihood, LIKELIHOODS, 'risk.likelihood')
  assertOneOf(risk.confidence, CONFIDENCES, 'risk.confidence')
  assertOneOf(risk.action, ACTIONS, 'risk.action')
  if (typeof r.title !== 'string') throw new Error('Finding.title must be string')
  if (typeof r.description !== 'string') throw new Error('Finding.description must be string')

  let suggestion: Suggestion | undefined
  if (r.suggestion !== undefined && r.suggestion !== null) {
    const s = r.suggestion as Record<string, unknown>
    if (typeof s.body !== 'string') throw new Error('suggestion.body must be string')
    if (typeof s.startLine !== 'number') throw new Error('suggestion.startLine must be number')
    if (typeof s.endLine !== 'number') throw new Error('suggestion.endLine must be number')
    suggestion = { body: s.body, startLine: s.startLine, endLine: s.endLine }
  }

  return {
    id: r.id,
    file: r.file,
    line: (r.line as number | null) ?? null,
    severity: r.severity as Severity,
    risk: {
      impact: risk.impact as Impact,
      likelihood: risk.likelihood as Likelihood,
      confidence: risk.confidence as Confidence,
      action: risk.action as Action,
    },
    title: r.title,
    description: r.description,
    suggestion,
    domain: (r.domain as ReviewFinding['domain']) ?? null,
    mergedFrom: Array.isArray(r.mergedFrom) ? (r.mergedFrom as MergedFromEntry[]) : undefined,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/types.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/pylon-pr-review/scripts/types.ts skills/pylon-pr-review/scripts/__tests__/types.test.ts
git commit -m "feat(pr-review-skill): add ReviewFinding types and parser"
```

---

### Task 5: Port dedupe logic with tests

**Files:**
- Create: `skills/pylon-pr-review/scripts/dedupe.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/dedupe.test.ts`

The logic is ported verbatim from `src/main/pr-review-dedupe.ts`. We re-derive the test cases against the new types so the tests are independent.

- [ ] **Step 1: Write the failing tests**

`skills/pylon-pr-review/scripts/__tests__/dedupe.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import type { ReviewFinding } from '../types.ts'
import { deduplicateFindings, tokenize, diceCoefficient } from '../dedupe.ts'

function f(partial: Partial<ReviewFinding> & { id: string; title: string }): ReviewFinding {
  return {
    id: partial.id,
    file: partial.file ?? 'src/a.ts',
    line: partial.line ?? 1,
    severity: partial.severity ?? 'medium',
    risk: partial.risk ?? {
      impact: 'medium',
      likelihood: 'possible',
      confidence: 'medium',
      action: 'should-fix',
    },
    title: partial.title,
    description: partial.description ?? 'desc',
    suggestion: partial.suggestion,
    domain: partial.domain ?? 'bugs',
    mergedFrom: partial.mergedFrom,
  }
}

test('tokenize lowercases, strips punctuation, drops stopwords and short tokens', () => {
  const tokens = tokenize('A potential null dereference in the helper.')
  expect(tokens.has('potential')).toBe(true)
  expect(tokens.has('null')).toBe(true)
  expect(tokens.has('dereference')).toBe(true)
  expect(tokens.has('helper')).toBe(true)
  expect(tokens.has('the')).toBe(false)
  expect(tokens.has('a')).toBe(false)
})

test('diceCoefficient returns 1 for identical sets', () => {
  expect(diceCoefficient(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1)
})

test('diceCoefficient returns 0 for disjoint sets', () => {
  expect(diceCoefficient(new Set(['a']), new Set(['b']))).toBe(0)
})

test('single finding is preserved', () => {
  const out = deduplicateFindings([f({ id: '1', title: 'null deref' })])
  expect(out).toHaveLength(1)
})

test('identical anchor and similar title collapse', () => {
  const out = deduplicateFindings([
    f({ id: '1', title: 'potential null dereference here' }),
    f({ id: '2', title: 'potential null dereference here' }),
  ])
  expect(out).toHaveLength(1)
})

test('cluster keeps highest severity as primary', () => {
  const out = deduplicateFindings([
    f({ id: '1', title: 'unsafe pointer dereference', severity: 'low', domain: 'code-smells' }),
    f({ id: '2', title: 'unsafe pointer dereference', severity: 'blocker', domain: 'security' }),
  ])
  expect(out).toHaveLength(1)
  expect(out[0].severity).toBe('blocker')
  expect(out[0].domain).toBe('security')
  expect(out[0].description).toContain('Also flagged by: code-smells')
})

test('different file + line stays separate', () => {
  const out = deduplicateFindings([
    f({ id: '1', file: 'a.ts', line: 1, title: 'null deref' }),
    f({ id: '2', file: 'b.ts', line: 1, title: 'null deref' }),
  ])
  expect(out).toHaveLength(2)
})

test('null line groups separately from anchored', () => {
  const out = deduplicateFindings([
    f({ id: '1', file: 'a.ts', line: null, title: 'null deref overall' }),
    f({ id: '2', file: 'a.ts', line: 1, title: 'null deref overall' }),
  ])
  expect(out).toHaveLength(2)
})

test('near-line duplicates within radius 3 with strong title overlap absorb', () => {
  const out = deduplicateFindings([
    f({ id: '1', file: 'a.ts', line: 10, title: 'broken auth check on user request handler' }),
    f({ id: '2', file: 'a.ts', line: 12, title: 'broken auth check on user request handler' }),
  ])
  expect(out).toHaveLength(1)
})

test('near-line duplicates beyond radius 3 are kept separate', () => {
  const out = deduplicateFindings([
    f({ id: '1', file: 'a.ts', line: 10, title: 'broken auth check on user request handler' }),
    f({ id: '2', file: 'a.ts', line: 20, title: 'broken auth check on user request handler' }),
  ])
  expect(out).toHaveLength(2)
})

test('merged primary keeps suggestion from cluster member when primary lacks one', () => {
  const out = deduplicateFindings([
    f({ id: '1', title: 'broken null deref handling', severity: 'blocker' }),
    f({
      id: '2',
      title: 'broken null deref handling',
      severity: 'low',
      suggestion: { body: 'if (!x) return', startLine: 1, endLine: 1 },
    }),
  ])
  expect(out).toHaveLength(1)
  expect(out[0].suggestion?.body).toBe('if (!x) return')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/dedupe.test.ts`
Expected: FAIL with module resolution error for `../dedupe.ts`.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/dedupe.ts`**

Port from `src/main/pr-review-dedupe.ts` (the local Pylon copy is the source of truth). Only difference: import `ReviewFinding` from `./types.ts` rather than `../shared/types`.

```typescript
import type { ReviewFinding } from './types.ts'

const SEVERITY_RANK: Record<string, number> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const SIMILARITY_THRESHOLD = 0.5
const MIN_TOKEN_OVERLAP = 2

const NEAR_LINE_SIMILARITY_THRESHOLD = 0.65
const NEAR_LINE_MIN_TOKEN_OVERLAP = 3
const NEAR_LINE_RADIUS = 3

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'of', 'on', 'in', 'to', 'for', 'with', 'at', 'by', 'from', 'into',
  'about', 'as', 'this', 'that', 'these', 'those', 'it', 'its', 'their',
  'there', 'here', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'not',
  'no', 'has', 'have', 'had', 'do', 'does', 'did', 'can', 'could', 'should',
  'would', 'will', 'may', 'might', 'when', 'where', 'what', 'which', 'who',
  'how', 'why', 'use', 'used', 'using', 'make', 'makes', 'making',
])

export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  return new Set(tokens)
}

export function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  return (2 * intersect) / (a.size + b.size)
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const t of a) if (b.has(t)) n++
  return n
}

function clusterByTitleSimilarity(group: ReviewFinding[]): number[][] {
  const tokens = group.map((f) => tokenize(f.title))
  const clusters: number[][] = []
  const assigned = new Array<number>(group.length).fill(-1)

  for (let i = 0; i < group.length; i++) {
    if (assigned[i] !== -1) continue
    const idx = clusters.length
    const cluster = [i]
    assigned[i] = idx
    for (let j = i + 1; j < group.length; j++) {
      if (assigned[j] !== -1) continue
      if (
        diceCoefficient(tokens[i], tokens[j]) >= SIMILARITY_THRESHOLD &&
        intersectionSize(tokens[i], tokens[j]) >= MIN_TOKEN_OVERLAP
      ) {
        cluster.push(j)
        assigned[j] = idx
      }
    }
    clusters.push(cluster)
  }
  return clusters
}

function mergeCluster(group: ReviewFinding[], indices: number[]): ReviewFinding {
  if (indices.length === 1) return group[indices[0]]

  const sorted = [...indices].sort(
    (a, b) => (SEVERITY_RANK[group[a].severity] ?? 99) - (SEVERITY_RANK[group[b].severity] ?? 99),
  )
  const primary = group[sorted[0]]
  const others = sorted.slice(1).map((i) => group[i])

  const mergedFrom = others
    .filter((o) => o.domain !== primary.domain)
    .map((o) => ({ domain: (o.domain as string) ?? 'unknown', title: o.title }))

  return {
    ...primary,
    suggestion: primary.suggestion ?? others.find((o) => o.suggestion !== undefined)?.suggestion,
    description:
      primary.description +
      (mergedFrom.length > 0
        ? `\n\n_Also flagged by: ${mergedFrom.map((m) => m.domain).join(', ')}_`
        : ''),
    mergedFrom: mergedFrom.length > 0 ? mergedFrom : undefined,
  }
}

function mergeNearLineDuplicates(findings: ReviewFinding[]): ReviewFinding[] {
  const byFile = new Map<string, ReviewFinding[]>()
  for (const f of findings) {
    const key = f.file || ''
    const list = byFile.get(key)
    if (list) list.push(f)
    else byFile.set(key, [f])
  }

  const result: ReviewFinding[] = []
  for (const group of byFile.values()) {
    const anchored = group.filter((f) => f.line != null)
    const unanchored = group.filter((f) => f.line == null)
    result.push(...unanchored)

    const sorted = [...anchored].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
    )

    type Kept = { finding: ReviewFinding; tokens: Set<string>; line: number }
    const kept: Kept[] = []

    for (const candidate of sorted) {
      const candidateLine = candidate.line as number
      const candidateTokens = tokenize(candidate.title)
      const absorber = kept.find((k) => {
        if (Math.abs(k.line - candidateLine) > NEAR_LINE_RADIUS) return false
        if (k.line === candidateLine) return false
        const overlap = intersectionSize(k.tokens, candidateTokens)
        if (overlap < NEAR_LINE_MIN_TOKEN_OVERLAP) return false
        return diceCoefficient(k.tokens, candidateTokens) >= NEAR_LINE_SIMILARITY_THRESHOLD
      })

      if (!absorber) {
        kept.push({ finding: candidate, tokens: candidateTokens, line: candidateLine })
        continue
      }

      const mergedFromEntries = absorber.finding.mergedFrom ? [...absorber.finding.mergedFrom] : []
      if (candidate.domain && candidate.domain !== absorber.finding.domain) {
        mergedFromEntries.push({
          domain: candidate.domain as string,
          title: candidate.title,
        })
      }
      absorber.finding = {
        ...absorber.finding,
        suggestion: absorber.finding.suggestion ?? candidate.suggestion,
        mergedFrom: mergedFromEntries.length > 0 ? mergedFromEntries : absorber.finding.mergedFrom,
      }
    }

    result.push(...kept.map((k) => k.finding))
  }

  return result
}

export function deduplicateFindings(findings: ReviewFinding[]): ReviewFinding[] {
  const groups = new Map<string, ReviewFinding[]>()
  for (const f of findings) {
    const key = `${f.file}:${f.line ?? 'null'}`
    const list = groups.get(key)
    if (list) list.push(f)
    else groups.set(key, [f])
  }

  const exactPass: ReviewFinding[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      exactPass.push(group[0])
      continue
    }
    const clusters = clusterByTitleSimilarity(group)
    for (const indices of clusters) {
      exactPass.push(mergeCluster(group, indices))
    }
  }

  return mergeNearLineDuplicates(exactPass)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/dedupe.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/pylon-pr-review/scripts/dedupe.ts skills/pylon-pr-review/scripts/__tests__/dedupe.test.ts
git commit -m "feat(pr-review-skill): port dedupe logic from pr-review-dedupe.ts"
```

---

### Task 6: Wire `dedupe` subcommand into CLI

**Files:**
- Modify: `skills/pylon-pr-review/bin/pr-review.ts`
- Create: `skills/pylon-pr-review/scripts/dedupe-cmd.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/dedupe-cmd.test.ts`

The CLI subcommand reads all `findings/*.json` files in a run-dir, parses them, dedupes, writes `findings.deduped.json`.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/dedupe-cmd.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDedupe } from '../dedupe-cmd.ts'
import type { ReviewFinding } from '../types.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-dedupe-'))
  await mkdir(join(runDir, 'findings'), { recursive: true })
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

function f(id: string, file: string, line: number, title: string, domain: string): ReviewFinding {
  return {
    id,
    file,
    line,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title,
    description: 'd',
    domain,
  }
}

test('runDedupe reads focus files, writes deduped output', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'null deref happens here', 'bugs')]),
  )
  await writeFile(
    join(runDir, 'findings', 'security.json'),
    JSON.stringify([f('2', 'a.ts', 10, 'null deref happens here', 'security')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
  expect(out[0].description).toContain('Also flagged by')
})

test('runDedupe tolerates missing focus files', async () => {
  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'null deref', 'bugs')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
})

test('runDedupe with malformed focus file logs and continues', async () => {
  await writeFile(join(runDir, 'findings', 'bugs.json'), 'not json')
  await writeFile(
    join(runDir, 'findings', 'security.json'),
    JSON.stringify([f('1', 'a.ts', 10, 'something', 'security')]),
  )
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(1)
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  expect(log).toContain('"stage":"dedupe"')
  expect(log).toContain('parse-error')
})

test('runDedupe with no findings files writes empty array', async () => {
  const exit = await runDedupe(runDir)
  expect(exit).toBe(0)
  const out = JSON.parse(await readFile(join(runDir, 'findings.deduped.json'), 'utf8'))
  expect(out).toHaveLength(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/dedupe-cmd.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/dedupe-cmd.ts`**

```typescript
import { readdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deduplicateFindings } from './dedupe.ts'
import { parseFinding, type ReviewFinding, FOCUS_IDS } from './types.ts'

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify({ ...entry, ts: Date.now() })}\n`
  await appendFile(join(runDir, 'log.jsonl'), line)
}

export async function runDedupe(runDir: string): Promise<number> {
  const findingsDir = join(runDir, 'findings')
  const collected: ReviewFinding[] = []
  let files: string[]
  try {
    files = await readdir(findingsDir)
  } catch {
    files = []
  }

  for (const name of files) {
    if (!name.endsWith('.json')) continue
    const focus = name.slice(0, -'.json'.length)
    if (!FOCUS_IDS.includes(focus as (typeof FOCUS_IDS)[number])) {
      await logLine(runDir, {
        stage: 'dedupe',
        status: 'skip',
        reason: 'unknown-focus',
        file: name,
      })
      continue
    }
    const path = join(findingsDir, name)
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path, 'utf8'))
    } catch (err) {
      await logLine(runDir, {
        stage: 'dedupe',
        status: 'parse-error',
        file: name,
        error: String(err),
      })
      continue
    }
    if (!Array.isArray(raw)) {
      await logLine(runDir, {
        stage: 'dedupe',
        status: 'parse-error',
        file: name,
        error: 'expected array',
      })
      continue
    }
    for (const item of raw) {
      try {
        collected.push(parseFinding(item))
      } catch (err) {
        await logLine(runDir, {
          stage: 'dedupe',
          status: 'parse-error',
          file: name,
          error: String(err),
        })
      }
    }
  }

  const deduped = deduplicateFindings(collected)
  await writeFile(join(runDir, 'findings.deduped.json'), `${JSON.stringify(deduped, null, 2)}\n`)
  await logLine(runDir, {
    stage: 'dedupe',
    status: 'done',
    input: collected.length,
    output: deduped.length,
  })
  return 0
}
```

- [ ] **Step 4: Wire into CLI**

Edit `skills/pylon-pr-review/bin/pr-review.ts`. Replace `dedupe: async () => 0,` with:

```typescript
  dedupe: async (args) => {
    const runDir = args[0]
    if (!runDir) {
      process.stderr.write('dedupe: missing <run-dir>\n')
      return 2
    }
    const { runDedupe } = await import('../scripts/dedupe-cmd.ts')
    return runDedupe(runDir)
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/dedupe-cmd.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Smoke-test the CLI end-to-end**

```bash
TMP=$(mktemp -d)
mkdir -p "$TMP/findings"
echo '[{"id":"1","file":"a.ts","line":10,"severity":"high","risk":{"impact":"high","likelihood":"likely","confidence":"high","action":"must-fix"},"title":"x","description":"d","domain":"bugs"}]' > "$TMP/findings/bugs.json"
skills/pylon-pr-review/bin/pr-review dedupe "$TMP"
cat "$TMP/findings.deduped.json"
rm -rf "$TMP"
```

Expected: prints a JSON array with one element matching the input.

- [ ] **Step 7: Commit**

```bash
git add skills/pylon-pr-review/scripts/dedupe-cmd.ts skills/pylon-pr-review/scripts/__tests__/dedupe-cmd.test.ts skills/pylon-pr-review/bin/pr-review.ts
git commit -m "feat(pr-review-skill): wire dedupe subcommand"
```

---

## Phase 3: Setup subcommand

### Task 7: Pre-flight dependency check

**Files:**
- Create: `skills/pylon-pr-review/scripts/preflight.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/preflight.test.ts`

The preflight uses `Bun.which()` to check each required binary on PATH. Test injection is done by overriding the binary names via env vars (`PR_REVIEW_BUN_BIN`, etc.) so tests don't need to manipulate PATH.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/preflight.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import { preflight } from '../preflight.ts'

test('returns ok when all binaries resolve', async () => {
  const result = await preflight({
    bun: 'bun',
    gh: 'echo',
    codex: 'echo',
    git: 'git',
  })
  expect(result.ok).toBe(true)
  expect(result.missing).toEqual([])
})

test('returns missing list when binaries do not resolve', async () => {
  const result = await preflight({
    bun: 'bun',
    gh: 'definitely-not-a-binary-xyz123',
    codex: 'also-not-real-abc456',
    git: 'git',
  })
  expect(result.ok).toBe(false)
  expect(result.missing).toContain('gh')
  expect(result.missing).toContain('codex')
})

test('renderInstallHint produces a single-line message per missing tool', () => {
  const { renderInstallHint } = require('../preflight.ts')
  const out = renderInstallHint(['gh', 'codex'])
  expect(out).toContain('gh:')
  expect(out).toContain('codex:')
  expect(out.split('\n').length).toBeGreaterThanOrEqual(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/preflight.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/preflight.ts`**

```typescript
export type Deps = {
  bun: string
  gh: string
  codex: string
  git: string
}

export type PreflightResult = {
  ok: boolean
  missing: string[]
  resolved: Record<keyof Deps, string | null>
}

export async function preflight(deps: Deps): Promise<PreflightResult> {
  const resolved: Record<keyof Deps, string | null> = {
    bun: Bun.which(deps.bun),
    gh: Bun.which(deps.gh),
    codex: Bun.which(deps.codex),
    git: Bun.which(deps.git),
  }
  const missing = (Object.keys(resolved) as Array<keyof Deps>).filter((k) => resolved[k] === null)
  return { ok: missing.length === 0, missing, resolved }
}

const HINTS: Record<string, string> = {
  bun: 'bun: install from https://bun.sh',
  gh: 'gh: install from https://cli.github.com (run `gh auth login` after)',
  codex: 'codex: install the Codex CLI per Codex docs (run `codex auth login` after)',
  git: 'git: install via your package manager',
}

export function renderInstallHint(missing: string[]): string {
  return missing.map((m) => HINTS[m] ?? `${m}: not found on PATH`).join('\n')
}

export function defaultDeps(): Deps {
  return {
    bun: process.env.PR_REVIEW_BUN_BIN || 'bun',
    gh: process.env.PR_REVIEW_GH_BIN || 'gh',
    codex: process.env.PR_REVIEW_CODEX_BIN || 'codex',
    git: process.env.PR_REVIEW_GIT_BIN || 'git',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/preflight.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/pylon-pr-review/scripts/preflight.ts skills/pylon-pr-review/scripts/__tests__/preflight.test.ts
git commit -m "feat(pr-review-skill): add preflight dependency check"
```

---

### Task 8: PR fetch via gh

**Files:**
- Create: `skills/pylon-pr-review/scripts/gh.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/gh.test.ts`
- Create: `skills/pylon-pr-review/fixtures/fake-gh.sh`

We inject a fake `gh` script via the `PR_REVIEW_GH_BIN` env var. The fake binary returns canned JSON for `pr view` and a static diff for `pr diff`.

- [ ] **Step 1: Write the fake gh script**

`skills/pylon-pr-review/fixtures/fake-gh.sh`:

```bash
#!/usr/bin/env bash
case "$1 $2" in
  "pr view")
    cat <<'JSON'
{
  "number": 1234,
  "title": "Fake PR",
  "headRefName": "feature-x",
  "baseRefName": "main",
  "headRefOid": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "baseRefOid": "cafebabecafebabecafebabecafebabecafebabe",
  "author": { "login": "octocat" },
  "body": "Fake body"
}
JSON
    ;;
  "pr diff")
    cat <<'DIFF'
diff --git a/a.ts b/a.ts
index 0000000..1111111 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
-export const x = 1
+export const x = 2
+export const y = 3
DIFF
    ;;
  *)
    echo "fake-gh: unsupported args: $*" >&2
    exit 1
    ;;
esac
```

```bash
chmod +x skills/pylon-pr-review/fixtures/fake-gh.sh
```

- [ ] **Step 2: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/gh.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchPr } from '../gh.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-gh-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('fetchPr writes pr.json and diff.patch', async () => {
  const result = await fetchPr({ ghBin: FAKE_GH, prNumber: 1234, runDir })
  expect(result.ok).toBe(true)
  const prJson = JSON.parse(await readFile(join(runDir, 'pr.json'), 'utf8'))
  expect(prJson.number).toBe(1234)
  expect(prJson.headRefName).toBe('feature-x')
  const diff = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(diff).toContain('export const x = 2')
})

test('fetchPr returns ok=false when gh exits non-zero', async () => {
  const result = await fetchPr({
    ghBin: '/usr/bin/false',
    prNumber: 1234,
    runDir,
  })
  expect(result.ok).toBe(false)
  expect(result.error).toBeDefined()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/gh.test.ts`
Expected: FAIL with module resolution error for `../gh.ts`.

- [ ] **Step 4: Write `skills/pylon-pr-review/scripts/gh.ts`**

```typescript
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type FetchPrInput = {
  ghBin: string
  prNumber: number
  runDir: string
}

export type FetchPrResult =
  | { ok: true; prJsonPath: string; diffPath: string }
  | { ok: false; error: string }

const PR_VIEW_FIELDS = [
  'number',
  'title',
  'headRefName',
  'baseRefName',
  'headRefOid',
  'baseRefOid',
  'author',
  'body',
].join(',')

export async function fetchPr(input: FetchPrInput): Promise<FetchPrResult> {
  const { ghBin, prNumber, runDir } = input
  const view = Bun.spawn([ghBin, 'pr', 'view', String(prNumber), '--json', PR_VIEW_FIELDS], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const viewStdout = await new Response(view.stdout).text()
  const viewStderr = await new Response(view.stderr).text()
  const viewExit = await view.exited
  if (viewExit !== 0) {
    return { ok: false, error: `gh pr view exit ${viewExit}: ${viewStderr.trim()}` }
  }

  const diff = Bun.spawn([ghBin, 'pr', 'diff', String(prNumber)], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const diffStdout = await new Response(diff.stdout).text()
  const diffStderr = await new Response(diff.stderr).text()
  const diffExit = await diff.exited
  if (diffExit !== 0) {
    return { ok: false, error: `gh pr diff exit ${diffExit}: ${diffStderr.trim()}` }
  }

  const prJsonPath = join(runDir, 'pr.json')
  const diffPath = join(runDir, 'diff.patch')
  await writeFile(prJsonPath, viewStdout)
  await writeFile(diffPath, diffStdout)
  return { ok: true, prJsonPath, diffPath }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/gh.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/scripts/gh.ts skills/pylon-pr-review/scripts/__tests__/gh.test.ts skills/pylon-pr-review/fixtures/fake-gh.sh
git commit -m "feat(pr-review-skill): fetch PR JSON and diff via gh"
```

---

### Task 9: Worktree creation

**Files:**
- Create: `skills/pylon-pr-review/scripts/worktree.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/worktree.test.ts`

The worktree is created against the user's current repository. The test runs against a real ephemeral git repo so we exercise the real `git worktree` machinery.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/worktree.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorktree, removeWorktree } from '../worktree.ts'

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} exit ${exit}: ${err}`)
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'prskill-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'branch', 'feature-x')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true })
})

test('createWorktree checks out the branch at the right SHA', async () => {
  const result = await createWorktree({
    gitBin: 'git',
    repoPath: repo,
    branch: 'feature-x',
    runDir,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.worktreePath).toBe(join(runDir, 'worktree'))
  const fileExists = await Bun.file(join(result.worktreePath, 'a.txt')).exists()
  expect(fileExists).toBe(true)
})

test('createWorktree fails on unknown branch', async () => {
  const result = await createWorktree({
    gitBin: 'git',
    repoPath: repo,
    branch: 'no-such-branch',
    runDir,
  })
  expect(result.ok).toBe(false)
})

test('removeWorktree cleans up', async () => {
  const created = await createWorktree({
    gitBin: 'git',
    repoPath: repo,
    branch: 'feature-x',
    runDir,
  })
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error(created.error)
  const removed = await removeWorktree({
    gitBin: 'git',
    repoPath: repo,
    worktreePath: created.worktreePath,
  })
  expect(removed.ok).toBe(true)
  const fileExists = await Bun.file(join(created.worktreePath, 'a.txt')).exists()
  expect(fileExists).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/worktree.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/worktree.ts`**

```typescript
import { join } from 'node:path'

export type CreateWorktreeInput = {
  gitBin: string
  repoPath: string
  branch: string
  runDir: string
}

export type CreateWorktreeResult =
  | { ok: true; worktreePath: string }
  | { ok: false; error: string }

async function runGit(
  gitBin: string,
  cwd: string,
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([gitBin, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  return { exit, stdout, stderr }
}

export async function createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
  const worktreePath = join(input.runDir, 'worktree')
  const result = await runGit(input.gitBin, input.repoPath, [
    'worktree',
    'add',
    '--detach',
    worktreePath,
    input.branch,
  ])
  if (result.exit !== 0) {
    return { ok: false, error: `git worktree add exit ${result.exit}: ${result.stderr.trim()}` }
  }
  return { ok: true, worktreePath }
}

export type RemoveWorktreeInput = {
  gitBin: string
  repoPath: string
  worktreePath: string
}

export type RemoveWorktreeResult = { ok: true } | { ok: false; error: string }

export async function removeWorktree(input: RemoveWorktreeInput): Promise<RemoveWorktreeResult> {
  const result = await runGit(input.gitBin, input.repoPath, [
    'worktree',
    'remove',
    '--force',
    input.worktreePath,
  ])
  if (result.exit !== 0) {
    return { ok: false, error: `git worktree remove exit ${result.exit}: ${result.stderr.trim()}` }
  }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/worktree.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/pylon-pr-review/scripts/worktree.ts skills/pylon-pr-review/scripts/__tests__/worktree.test.ts
git commit -m "feat(pr-review-skill): add git worktree create/remove helpers"
```

---

### Task 10: Atomic `setup` subcommand wiring

**Files:**
- Create: `skills/pylon-pr-review/scripts/setup-cmd.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/setup-cmd.test.ts`
- Modify: `skills/pylon-pr-review/bin/pr-review.ts`

The `setup` subcommand sequences preflight → fetchPr → createWorktree, and is atomic: if any step fails after the run dir was created, it removes the partial state.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/setup-cmd.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetup } from '../setup-cmd.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname
const FALSE_BIN = '/usr/bin/false'

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} exit ${exit}: ${err}`)
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'prskill-setup-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-setup-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'branch', 'feature-x')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true })
})

test('runSetup completes happy path: writes pr.json, diff.patch, worktree', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(0)
  const contents = await readdir(runDir)
  expect(contents).toContain('pr.json')
  expect(contents).toContain('diff.patch')
  expect(contents).toContain('worktree')
})

test('runSetup with missing dep returns non-zero and cleans up', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: 'definitely-not-a-thing', codex: 'echo', git: 'git' },
  })
  expect(exit).not.toBe(0)
  const contents = await readdir(runDir).catch(() => [])
  expect(contents.filter((c) => c !== 'log.jsonl')).toHaveLength(0)
})

test('runSetup with failing gh removes any partial state', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FALSE_BIN, codex: 'echo', git: 'git' },
  })
  expect(exit).not.toBe(0)
  const contents = await readdir(runDir).catch(() => [])
  expect(contents).not.toContain('worktree')
  expect(contents).not.toContain('pr.json')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/setup-cmd.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/setup-cmd.ts`**

```typescript
import { mkdir, rm, unlink, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflight, renderInstallHint, type Deps, defaultDeps } from './preflight.ts'
import { fetchPr } from './gh.ts'
import { createWorktree } from './worktree.ts'

export type RunSetupInput = {
  runDir: string
  prNumber: number
  repoPath: string
  deps?: Deps
}

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  await appendFile(join(runDir, 'log.jsonl'), `${JSON.stringify({ ...entry, ts: Date.now() })}\n`)
}

export async function runSetup(input: RunSetupInput): Promise<number> {
  const deps = input.deps ?? defaultDeps()
  await mkdir(input.runDir, { recursive: true })
  await mkdir(join(input.runDir, 'findings'), { recursive: true })
  await mkdir(join(input.runDir, 'screen'), { recursive: true })
  await mkdir(join(input.runDir, 'state'), { recursive: true })

  const preResult = await preflight(deps)
  if (!preResult.ok) {
    await logLine(input.runDir, { stage: 'setup', status: 'error', missing: preResult.missing })
    process.stderr.write(`pr-review: missing dependencies:\n${renderInstallHint(preResult.missing)}\n`)
    await cleanup(input.runDir)
    return 3
  }
  await logLine(input.runDir, { stage: 'preflight', status: 'done' })

  const fetched = await fetchPr({
    ghBin: deps.gh,
    prNumber: input.prNumber,
    runDir: input.runDir,
  })
  if (!fetched.ok) {
    await logLine(input.runDir, { stage: 'fetch-pr', status: 'error', error: fetched.error })
    process.stderr.write(`pr-review: ${fetched.error}\n`)
    await cleanup(input.runDir)
    return 4
  }
  await logLine(input.runDir, { stage: 'fetch-pr', status: 'done' })

  const prJson = await Bun.file(join(input.runDir, 'pr.json')).json()
  const branch = prJson.headRefName as string

  const wt = await createWorktree({
    gitBin: deps.git,
    repoPath: input.repoPath,
    branch,
    runDir: input.runDir,
  })
  if (!wt.ok) {
    await logLine(input.runDir, { stage: 'worktree', status: 'error', error: wt.error })
    process.stderr.write(`pr-review: ${wt.error}\n`)
    await cleanup(input.runDir)
    return 5
  }
  await logLine(input.runDir, { stage: 'setup', status: 'done', worktree: wt.worktreePath })
  return 0
}

async function cleanup(runDir: string): Promise<void> {
  for (const name of ['worktree', 'pr.json', 'diff.patch', 'findings', 'screen', 'state']) {
    await rm(join(runDir, name), { recursive: true, force: true }).catch(() => {})
  }
}
```

- [ ] **Step 4: Wire into CLI**

Edit `skills/pylon-pr-review/bin/pr-review.ts`. Replace `setup: async () => 0,` with:

```typescript
  setup: async (args) => {
    const runDir = args[0]
    const prFlag = args.indexOf('--pr')
    const repoFlag = args.indexOf('--repo')
    if (!runDir || prFlag === -1 || !args[prFlag + 1]) {
      process.stderr.write('setup: missing <run-dir> --pr <n> [--repo <path>]\n')
      return 2
    }
    const prNumber = Number(args[prFlag + 1])
    if (!Number.isFinite(prNumber)) {
      process.stderr.write(`setup: invalid PR number ${args[prFlag + 1]}\n`)
      return 2
    }
    const repoPath = repoFlag !== -1 ? args[repoFlag + 1] : process.cwd()
    const { runSetup } = await import('../scripts/setup-cmd.ts')
    return runSetup({ runDir, prNumber, repoPath })
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/setup-cmd.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/scripts/setup-cmd.ts skills/pylon-pr-review/scripts/__tests__/setup-cmd.test.ts skills/pylon-pr-review/bin/pr-review.ts
git commit -m "feat(pr-review-skill): atomic setup subcommand"
```

---

## Phase 4: Server subcommand

### Task 11: Helper.js for click capture and submit

**Files:**
- Create: `skills/pylon-pr-review/scripts/helper.js`
- Create: `skills/pylon-pr-review/scripts/__tests__/helper.test.ts`

`helper.js` is the client-side script that the server injects into HTML responses. It captures checkbox clicks and submit-button clicks, POSTs them to `/events`, and sends periodic heartbeats.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/helper.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'

const HELPER = new URL('../helper.js', import.meta.url).pathname

test('helper.js posts to /events on click and submit', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain('addEventListener')
  expect(src).toContain("fetch('/events'")
  expect(src).toContain("type: 'click'")
  expect(src).toContain("type: 'submit'")
})

test('helper.js sends periodic heartbeats', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain("fetch('/heartbeat'")
  expect(src).toMatch(/setInterval/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/helper.test.ts`
Expected: FAIL because `helper.js` does not exist.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/helper.js`**

```javascript
(function () {
  function post(payload) {
    return fetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }

  document.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target.type !== 'checkbox') return
    if (!target.dataset.findingId) return
    post({
      type: target.checked ? 'select' : 'deselect',
      findingId: target.dataset.findingId,
      timestamp: Date.now(),
    })
  })

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.matches('[data-action="submit"]')) return
    const checked = Array.from(document.querySelectorAll('input[type="checkbox"][data-finding-id]'))
      .filter((el) => el.checked)
      .map((el) => el.dataset.findingId)
    post({ type: 'submit', findingIds: checked, timestamp: Date.now() })
  })

  setInterval(() => {
    fetch('/heartbeat', { method: 'POST' }).catch(() => {})
  }, 30_000)
})()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/helper.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/pylon-pr-review/scripts/helper.js skills/pylon-pr-review/scripts/__tests__/helper.test.ts
git commit -m "feat(pr-review-skill): client-side helper for click capture"
```

---

### Task 12: Server: serves newest HTML, injects helper

**Files:**
- Create: `skills/pylon-pr-review/scripts/server.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/server.test.ts`

The server lifecycle is: bind to port 0, write `state/server-info` with the chosen port, watch the screen directory, serve the newest file, exit after 30 minutes of idle. For tests we expose the same module with an override hook.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/server.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer, type ServerHandle } from '../server.ts'

let runDir: string
let server: ServerHandle | null

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-server-'))
  await mkdir(join(runDir, 'screen'), { recursive: true })
  await mkdir(join(runDir, 'state'), { recursive: true })
  server = null
})

afterEach(async () => {
  if (server) await server.stop()
  await rm(runDir, { recursive: true, force: true })
})

async function fetchHtml(handle: ServerHandle): Promise<string> {
  const res = await fetch(handle.url)
  return res.text()
}

test('serves the newest HTML file and injects the helper', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>One</h1>')
  await new Promise((r) => setTimeout(r, 5))
  await writeFile(join(runDir, 'screen', 'b.html'), '<h1>Two</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const html = await fetchHtml(server)
  expect(html).toContain('<h1>Two</h1>')
  expect(html).toContain('helper.js')
})

test('POST /events appends a JSON line to state/events', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const res = await fetch(`${server.url}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'click', findingId: 'f1' }),
  })
  expect(res.ok).toBe(true)
  const events = await readFile(join(runDir, 'state', 'events'), 'utf8')
  const lines = events.trim().split('\n')
  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0]).findingId).toBe('f1')
})

test('POST /heartbeat resets the idle timer', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 200 })
  await new Promise((r) => setTimeout(r, 100))
  await fetch(`${server.url}/heartbeat`, { method: 'POST' })
  await new Promise((r) => setTimeout(r, 150))
  const stopped = await Bun.file(join(runDir, 'state', 'server-stopped')).exists()
  expect(stopped).toBe(false)
})

test('idle timeout causes server to exit and write server-stopped', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 100 })
  await new Promise((r) => setTimeout(r, 250))
  const stopped = await Bun.file(join(runDir, 'state', 'server-stopped')).exists()
  expect(stopped).toBe(true)
  server = null
})

test('writes server-info on start with url and port', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const info = JSON.parse(await readFile(join(runDir, 'state', 'server-info'), 'utf8'))
  expect(info.url).toBe(server.url)
  expect(typeof info.port).toBe('number')
  expect(info.pid).toBe(process.pid)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/server.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/server.ts`**

```typescript
import { readdir, readFile, stat, writeFile, appendFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export type ServerHandle = {
  url: string
  port: number
  stop: () => Promise<void>
}

export type StartServerInput = {
  runDir: string
  idleMs: number
  host?: string
}

async function newestScreenPath(runDir: string): Promise<string | null> {
  const dir = join(runDir, 'screen')
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  let bestPath: string | null = null
  let bestMtime = -Infinity
  for (const name of entries) {
    if (!name.endsWith('.html')) continue
    const path = join(dir, name)
    const s = await stat(path)
    if (s.mtimeMs > bestMtime) {
      bestMtime = s.mtimeMs
      bestPath = path
    }
  }
  return bestPath
}

const HELPER_PATH = new URL('./helper.js', import.meta.url).pathname

async function htmlWithHelper(htmlPath: string): Promise<string> {
  const body = await readFile(htmlPath, 'utf8')
  const wrapped = body.includes('<html')
    ? body
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review</title></head><body>${body}</body></html>`
  return wrapped.replace(
    '</body>',
    `<script src="/helper.js"></script></body>`,
  )
}

export async function startServer(input: StartServerInput): Promise<ServerHandle> {
  const { runDir, idleMs } = input
  let lastActivity = Date.now()
  let stopped = false
  const events = join(runDir, 'state', 'events')
  const serverInfo = join(runDir, 'state', 'server-info')
  const serverStopped = join(runDir, 'state', 'server-stopped')

  await unlink(serverStopped).catch(() => {})

  const server = Bun.serve({
    hostname: input.host ?? '127.0.0.1',
    port: 0,
    fetch: async (req) => {
      lastActivity = Date.now()
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname === '/events') {
        const body = await req.text()
        await appendFile(events, `${body.trim()}\n`)
        return new Response('ok')
      }
      if (req.method === 'POST' && url.pathname === '/heartbeat') {
        return new Response('ok')
      }
      if (req.method === 'GET' && url.pathname === '/helper.js') {
        const src = await readFile(HELPER_PATH, 'utf8')
        return new Response(src, { headers: { 'Content-Type': 'application/javascript' } })
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204 })
      }
      if (req.method === 'GET' && url.pathname === '/') {
        const newest = await newestScreenPath(runDir)
        if (!newest) {
          return new Response('<h1>Waiting for first render</h1>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        }
        const html = await htmlWithHelper(newest)
        return new Response(html, { headers: { 'Content-Type': 'text/html' } })
      }
      return new Response('not found', { status: 404 })
    },
  })

  const port = server.port
  const url = `http://${input.host ?? '127.0.0.1'}:${port}`
  await writeFile(serverInfo, JSON.stringify({ url, port, pid: process.pid }))

  const idleTimer = setInterval(async () => {
    if (stopped) return
    if (Date.now() - lastActivity >= idleMs) {
      stopped = true
      clearInterval(idleTimer)
      server.stop(true)
      await writeFile(serverStopped, String(Date.now()))
      await unlink(serverInfo).catch(() => {})
    }
  }, Math.max(50, Math.min(idleMs / 4, 5000)))

  return {
    url,
    port,
    stop: async () => {
      if (stopped) return
      stopped = true
      clearInterval(idleTimer)
      server.stop(true)
      await writeFile(serverStopped, String(Date.now()))
      await unlink(serverInfo).catch(() => {})
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/server.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/pylon-pr-review/scripts/server.ts skills/pylon-pr-review/scripts/__tests__/server.test.ts
git commit -m "feat(pr-review-skill): HTML server with events, heartbeat, idle exit"
```

---

### Task 13: Wire `serve` subcommand into CLI

**Files:**
- Create: `skills/pylon-pr-review/scripts/serve-cmd.ts`
- Modify: `skills/pylon-pr-review/bin/pr-review.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/serve-cmd.test.ts`

The `serve` subcommand starts the server, prints `{url, port, state_dir, pid}` JSON to stdout, and keeps the process alive until killed or until the idle timer fires.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/serve-cmd.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let runDir: string
const CLI = new URL('../../bin/pr-review.ts', import.meta.url).pathname

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-serve-'))
  await mkdir(join(runDir, 'screen'), { recursive: true })
  await mkdir(join(runDir, 'state'), { recursive: true })
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('serve prints server-info JSON to stdout and stays alive briefly', async () => {
  const proc = Bun.spawn(
    ['bun', CLI, 'serve', runDir, '--idle-ms', '300'],
    { stdout: 'pipe' },
  )
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  const start = Date.now()
  let buffer = ''
  while (Date.now() - start < 5000) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value)
    const newlineIdx = buffer.indexOf('\n')
    if (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx)
      const parsed = JSON.parse(line)
      expect(typeof parsed.url).toBe('string')
      expect(typeof parsed.port).toBe('number')
      expect(parsed.state_dir).toBe(join(runDir, 'state'))
      proc.kill()
      await proc.exited
      return
    }
  }
  proc.kill()
  throw new Error('did not receive server-info on stdout')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/serve-cmd.test.ts`
Expected: FAIL because subcommand is still the stub.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/serve-cmd.ts`**

```typescript
import { join } from 'node:path'
import { startServer } from './server.ts'

export type RunServeInput = {
  runDir: string
  idleMs: number
  host?: string
}

export async function runServe(input: RunServeInput): Promise<number> {
  const handle = await startServer({
    runDir: input.runDir,
    idleMs: input.idleMs,
    host: input.host,
  })
  process.stdout.write(
    `${JSON.stringify({
      url: handle.url,
      port: handle.port,
      state_dir: join(input.runDir, 'state'),
      pid: process.pid,
    })}\n`,
  )

  return new Promise<number>((resolve) => {
    const shutdown = async () => {
      await handle.stop()
      resolve(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    const watcher = setInterval(async () => {
      const stopped = await Bun.file(join(input.runDir, 'state', 'server-stopped')).exists()
      if (stopped) {
        clearInterval(watcher)
        resolve(0)
      }
    }, 200)
  })
}
```

- [ ] **Step 4: Wire into CLI**

Edit `skills/pylon-pr-review/bin/pr-review.ts`. Replace `serve: async () => 0,` with:

```typescript
  serve: async (args) => {
    const runDir = args[0]
    if (!runDir) {
      process.stderr.write('serve: missing <run-dir>\n')
      return 2
    }
    const idleFlag = args.indexOf('--idle-ms')
    const idleMs = idleFlag !== -1 ? Number(args[idleFlag + 1]) : 30 * 60 * 1000
    const hostFlag = args.indexOf('--host')
    const host = hostFlag !== -1 ? args[hostFlag + 1] : undefined
    const { runServe } = await import('../scripts/serve-cmd.ts')
    return runServe({ runDir, idleMs, host })
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/serve-cmd.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/scripts/serve-cmd.ts skills/pylon-pr-review/scripts/__tests__/serve-cmd.test.ts skills/pylon-pr-review/bin/pr-review.ts
git commit -m "feat(pr-review-skill): wire serve subcommand"
```

---

## Phase 5: Render subcommand

### Task 14: Templates and render core

**Files:**
- Create: `skills/pylon-pr-review/templates/styles.css`
- Create: `skills/pylon-pr-review/scripts/render-progress.ts`
- Create: `skills/pylon-pr-review/scripts/render-findings.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/render-progress.test.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/render-findings.test.ts`

We split rendering into two modules because the templates are big and decoupled. `render-progress.ts` takes a stage-status object; `render-findings.ts` takes the deduped/kept/final findings list plus the post-status map.

- [ ] **Step 1: Write the styles file**

`skills/pylon-pr-review/templates/styles.css`:

```css
:root {
  --bg: #faf9f7;
  --fg: #1f1d1c;
  --muted: #6e6a64;
  --line: #e7e3dc;
  --accent: #1f1d1c;
  --blocker: #c0392b;
  --high: #d35400;
  --medium: #b9a40b;
  --low: #788078;
}
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, system-ui, sans-serif; }
h1, h2, h3 { margin: 0 0 0.5rem; }
.subtle { color: var(--muted); }
.stage-strip { display: flex; gap: 0.5rem; flex-wrap: wrap; margin: 1rem 0 2rem; }
.stage { padding: 0.25rem 0.5rem; border: 1px solid var(--line); border-radius: 4px; font-size: 12px; }
.stage.done { background: #eef6ee; border-color: #b8d6b8; }
.stage.running { background: #fff4cf; border-color: #d6c98a; }
.stage.error { background: #fde7e3; border-color: #d4948a; }
.finding { border: 1px solid var(--line); border-radius: 6px; margin-bottom: 0.75rem; padding: 0.75rem 1rem; background: white; }
.finding-head { display: flex; align-items: center; gap: 0.75rem; }
.finding-title { font-weight: 600; flex: 1; }
.sev-chip { font-size: 11px; padding: 2px 6px; border-radius: 3px; color: white; }
.sev-blocker { background: var(--blocker); }
.sev-high { background: var(--high); }
.sev-medium { background: var(--medium); }
.sev-low { background: var(--low); color: white; }
.finding-meta { font-size: 12px; color: var(--muted); margin-top: 0.25rem; }
.finding-desc { margin-top: 0.5rem; white-space: pre-wrap; font-size: 13px; }
.finding-diff, .finding-suggestion { margin-top: 0.5rem; font: 12px/1.4 ui-monospace, Menlo, monospace; background: #f4f1eb; padding: 0.5rem; border-radius: 4px; overflow-x: auto; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-left: 0.25rem; }
.badge.posted { background: #d6ecd6; color: #2d6a2d; }
.badge.failed { background: #f4cfcf; color: #802626; }
.submit-bar { position: sticky; bottom: 0; background: var(--bg); padding: 1rem 0; border-top: 1px solid var(--line); }
.submit-btn { padding: 0.5rem 1rem; background: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer; }
```

- [ ] **Step 2: Write the failing tests**

`skills/pylon-pr-review/scripts/__tests__/render-progress.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import { renderProgressHtml } from '../render-progress.ts'

test('renderProgressHtml shows all stages with status classes', () => {
  const html = renderProgressHtml({
    prNumber: 1234,
    headSha: 'deadbeef',
    branch: 'feature-x',
    stages: {
      setup: 'done',
      context: 'done',
      specialists: 'running',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: { security: 2, bugs: 0, performance: 0, 'code-smells': 0, architecture: 0 },
  })
  expect(html).toContain('#1234')
  expect(html).toContain('feature-x')
  expect(html).toContain('class="stage done">setup')
  expect(html).toContain('class="stage running">specialists')
  expect(html).toContain('security: 2')
})
```

`skills/pylon-pr-review/scripts/__tests__/render-findings.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import type { ReviewFinding } from '../types.ts'
import { renderFindingsHtml } from '../render-findings.ts'

function f(p: Partial<ReviewFinding> & { id: string; title: string }): ReviewFinding {
  return {
    id: p.id,
    file: p.file ?? 'src/a.ts',
    line: p.line ?? 1,
    severity: p.severity ?? 'medium',
    risk: p.risk ?? {
      impact: 'medium',
      likelihood: 'possible',
      confidence: 'medium',
      action: 'should-fix',
    },
    title: p.title,
    description: p.description ?? '',
    suggestion: p.suggestion,
    domain: p.domain ?? 'bugs',
    mergedFrom: p.mergedFrom,
  }
}

test('empty findings renders an explicit empty state', () => {
  const html = renderFindingsHtml({ findings: [], postStatus: {} })
  expect(html).toContain('No findings')
})

test('renders one finding with severity chip and submit button', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'null deref', severity: 'high' })],
    postStatus: {},
  })
  expect(html).toContain('null deref')
  expect(html).toContain('sev-high')
  expect(html).toContain('data-finding-id="a"')
  expect(html).toContain('data-action="submit"')
})

test('shows posted badge when present in postStatus', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: { a: 'posted' },
  })
  expect(html).toContain('class="badge posted"')
})

test('shows failed badge with message', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: { a: { status: 'failed', message: 'rate limit' } },
  })
  expect(html).toContain('class="badge failed"')
  expect(html).toContain('rate limit')
})

test('renders suggestion block when present', () => {
  const html = renderFindingsHtml({
    findings: [
      f({
        id: 'a',
        title: 'x',
        suggestion: { body: 'if (!y) return', startLine: 10, endLine: 11 },
      }),
    ],
    postStatus: {},
  })
  expect(html).toContain('if (!y) return')
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd skills/pylon-pr-review && bun test scripts/__tests__/render-progress.test.ts scripts/__tests__/render-findings.test.ts
```
Expected: FAIL with module resolution errors.

- [ ] **Step 4: Write `skills/pylon-pr-review/scripts/render-progress.ts`**

```typescript
import { readFile } from 'node:fs/promises'

const STAGES = ['setup', 'context', 'specialists', 'dedupe', 'critic', 'peer-review', 'report', 'post'] as const
export type StageId = (typeof STAGES)[number]
export type StageStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export type RenderProgressInput = {
  prNumber: number
  headSha: string
  branch: string
  stages: Record<StageId, StageStatus>
  specialistCounts: Record<string, number>
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

export function renderProgressHtml(input: RenderProgressInput): string {
  const stages = STAGES.map(
    (s) => `<span class="stage ${input.stages[s]}">${s}</span>`,
  ).join('')
  const counts = Object.entries(input.specialistCounts)
    .map(([k, v]) => `<li>${escape(k)}: ${v}</li>`)
    .join('')
  const STYLES_PATH = new URL('../templates/styles.css', import.meta.url).pathname
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review #${input.prNumber}</title><link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE"></head><body>
<h1>PR #${input.prNumber}: ${escape(input.branch)}</h1>
<p class="subtle">head ${escape(input.headSha)}</p>
<div class="stage-strip">${stages}</div>
<h2>Specialists</h2>
<ul>${counts}</ul>
</body></html>`
}
```

(Inline styles will be substituted at run-time by reading the CSS and base64-encoding. To keep the test deterministic and avoid mtime/order issues, we substitute the actual content in `renderToDisk` below; the template above keeps a literal placeholder so test snapshots are stable.)

Add at the bottom of `render-progress.ts`:

```typescript
export async function renderProgressToDisk(
  input: RenderProgressInput,
  outPath: string,
): Promise<void> {
  const stylesPath = new URL('../templates/styles.css', import.meta.url).pathname
  const css = await readFile(stylesPath, 'utf8')
  const html = renderProgressHtml(input).replace(
    'data:text/css;base64,STYLES_INLINE',
    `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
  )
  await Bun.write(outPath, html)
}
```

- [ ] **Step 5: Write `skills/pylon-pr-review/scripts/render-findings.ts`**

```typescript
import { readFile } from 'node:fs/promises'
import type { ReviewFinding } from './types.ts'

export type PostStatusEntry = 'posted' | { status: 'failed'; message: string }
export type PostStatusMap = Record<string, PostStatusEntry>

export type RenderFindingsInput = {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

function badge(id: string, status: PostStatusEntry | undefined): string {
  if (!status) return ''
  if (status === 'posted') return '<span class="badge posted">posted</span>'
  return `<span class="badge failed">failed: ${escape(status.message)}</span>`
}

function findingCard(f: ReviewFinding, status: PostStatusEntry | undefined): string {
  const sev = f.severity
  const checked = status === 'posted' ? 'checked disabled' : ''
  const suggestion = f.suggestion
    ? `<pre class="finding-suggestion">${escape(f.suggestion.body)}</pre>`
    : ''
  return `<div class="finding" id="finding-${escape(f.id)}">
  <div class="finding-head">
    <input type="checkbox" data-finding-id="${escape(f.id)}" ${checked} />
    <span class="sev-chip sev-${sev}">${sev}</span>
    <span class="finding-title">${escape(f.title)}</span>
    ${badge(f.id, status)}
  </div>
  <div class="finding-meta">${escape(f.file)}${f.line != null ? `:${f.line}` : ''} <span class="subtle">(${escape((f.domain as string) ?? 'unknown')})</span></div>
  <div class="finding-desc">${escape(f.description)}</div>
  ${suggestion}
</div>`
}

export function renderFindingsHtml(input: RenderFindingsInput): string {
  const { findings, postStatus } = input
  if (findings.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review</title><link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE"></head><body>
<h1>No findings</h1>
<p class="subtle">All specialists returned cleanly and nothing survived the pipeline.</p>
</body></html>`
  }
  const cards = findings.map((f) => findingCard(f, postStatus[f.id])).join('\n')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review</title><link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE"></head><body>
<h1>Findings</h1>
<p class="subtle">Select findings to post; then reply <code>post</code> in the terminal.</p>
${cards}
<div class="submit-bar"><button class="submit-btn" data-action="submit">Post selected</button></div>
</body></html>`
}

export async function renderFindingsToDisk(
  input: RenderFindingsInput,
  outPath: string,
): Promise<void> {
  const stylesPath = new URL('../templates/styles.css', import.meta.url).pathname
  const css = await readFile(stylesPath, 'utf8')
  const html = renderFindingsHtml(input).replace(
    'data:text/css;base64,STYLES_INLINE',
    `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
  )
  await Bun.write(outPath, html)
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
cd skills/pylon-pr-review && bun test scripts/__tests__/render-progress.test.ts scripts/__tests__/render-findings.test.ts
```
Expected: PASS, 6 tests total.

- [ ] **Step 7: Commit**

```bash
git add skills/pylon-pr-review/templates/styles.css skills/pylon-pr-review/scripts/render-progress.ts skills/pylon-pr-review/scripts/render-findings.ts skills/pylon-pr-review/scripts/__tests__/render-progress.test.ts skills/pylon-pr-review/scripts/__tests__/render-findings.test.ts
git commit -m "feat(pr-review-skill): render progress and findings HTML"
```

---

### Task 15: `render` subcommand and newest-file naming

**Files:**
- Create: `skills/pylon-pr-review/scripts/render-cmd.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/render-cmd.test.ts`
- Modify: `skills/pylon-pr-review/bin/pr-review.ts`

`render` writes to `screen/<page>-vN.html` where N is the next available integer. The server picks newest by mtime, so this guarantees a fresh paint.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/render-cmd.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRender } from '../render-cmd.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-render-'))
  await mkdir(join(runDir, 'screen'), { recursive: true })
  await mkdir(join(runDir, 'state'), { recursive: true })
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 1234,
      headRefName: 'feature-x',
      headRefOid: 'deadbeef',
    }),
  )
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('progress render writes screen/progress.html on first call', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  const exit = await runRender(runDir, 'progress')
  expect(exit).toBe(0)
  const files = await readdir(join(runDir, 'screen'))
  expect(files).toContain('progress.html')
})

test('subsequent progress renders use -v2, -v3 names', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  await runRender(runDir, 'progress')
  await runRender(runDir, 'progress')
  await runRender(runDir, 'progress')
  const files = await readdir(join(runDir, 'screen'))
  expect(files.sort()).toEqual(['progress-v2.html', 'progress-v3.html', 'progress.html'])
})

test('findings render reads findings.final.json if present', async () => {
  await writeFile(
    join(runDir, 'findings.final.json'),
    JSON.stringify([
      {
        id: 'a',
        file: 'src/x.ts',
        line: 1,
        severity: 'high',
        risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        title: 'tsst',
        description: 'd',
        domain: 'bugs',
      },
    ]),
  )
  const exit = await runRender(runDir, 'findings')
  expect(exit).toBe(0)
  const html = await Bun.file(join(runDir, 'screen', 'findings.html')).text()
  expect(html).toContain('tsst')
})

test('findings render with no findings json shows empty state', async () => {
  const exit = await runRender(runDir, 'findings')
  expect(exit).toBe(0)
  const html = await Bun.file(join(runDir, 'screen', 'findings.html')).text()
  expect(html).toContain('No findings')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/render-cmd.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/render-cmd.ts`**

```typescript
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderProgressToDisk } from './render-progress.ts'
import { renderFindingsToDisk, type PostStatusMap } from './render-findings.ts'
import { parseFinding, FOCUS_IDS } from './types.ts'

async function nextVersionedPath(screenDir: string, base: string): Promise<string> {
  const entries = await readdir(screenDir).catch(() => [])
  if (!entries.includes(`${base}.html`)) return join(screenDir, `${base}.html`)
  let n = 2
  while (entries.includes(`${base}-v${n}.html`)) n++
  return join(screenDir, `${base}-v${n}.html`)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return (await Bun.file(path).json()) as T
  } catch {
    return fallback
  }
}

async function readLog(runDir: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(runDir, 'log.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        return { stage: 'unknown', status: 'parse-error' } as Record<string, unknown>
      }
    })
}

function summarizeStages(log: Array<Record<string, unknown>>): {
  stages: Record<string, 'pending' | 'running' | 'done' | 'error' | 'skipped'>
  specialistCounts: Record<string, number>
} {
  const stages: Record<string, 'pending' | 'running' | 'done' | 'error' | 'skipped'> = {
    setup: 'pending',
    context: 'pending',
    specialists: 'pending',
    dedupe: 'pending',
    critic: 'pending',
    'peer-review': 'pending',
    report: 'pending',
    post: 'pending',
  }
  const specialistCounts: Record<string, number> = {
    security: 0,
    bugs: 0,
    performance: 0,
    'code-smells': 0,
    architecture: 0,
  }
  for (const entry of log) {
    const stage = entry.stage as string
    const status = entry.status as string
    if (stage in stages && status === 'done') stages[stage] = 'done'
    if (stage in stages && status === 'running') stages[stage] = 'running'
    if (stage in stages && status === 'error') stages[stage] = 'error'
    if (stage in stages && status === 'skipped') stages[stage] = 'skipped'
    if (stage === 'specialist' && typeof entry.focus === 'string') {
      if (entry.focus in specialistCounts && typeof entry.findings === 'number') {
        specialistCounts[entry.focus] = entry.findings
      }
    }
  }
  return { stages, specialistCounts }
}

export async function runRender(runDir: string, page: 'progress' | 'findings'): Promise<number> {
  const screenDir = join(runDir, 'screen')
  if (page === 'progress') {
    const prJson = await readJson<Record<string, unknown>>(join(runDir, 'pr.json'), {
      number: 0,
      headRefName: '?',
      headRefOid: '?',
    })
    const log = await readLog(runDir)
    const summary = summarizeStages(log)
    const outPath = await nextVersionedPath(screenDir, 'progress')
    await renderProgressToDisk(
      {
        prNumber: Number(prJson.number ?? 0),
        headSha: String(prJson.headRefOid ?? '?'),
        branch: String(prJson.headRefName ?? '?'),
        stages: summary.stages as never,
        specialistCounts: summary.specialistCounts,
      },
      outPath,
    )
    return 0
  }

  const findings = (await readJson<unknown[]>(join(runDir, 'findings.final.json'), []))
    .concat(
      (await readJson<unknown[]>(join(runDir, 'findings.kept.json'), []))
        .concat(await readJson<unknown[]>(join(runDir, 'findings.deduped.json'), []))
        .slice(0, 0),
    )
    .map((raw) => parseFinding(raw))
  const postStatus = await readJson<PostStatusMap>(join(runDir, 'post-status.json'), {})
  const outPath = await nextVersionedPath(screenDir, 'findings')
  await renderFindingsToDisk({ findings, postStatus }, outPath)
  return 0
}
```

- [ ] **Step 4: Wire into CLI**

Edit `skills/pylon-pr-review/bin/pr-review.ts`. Replace `render: async () => 0,` with:

```typescript
  render: async (args) => {
    const runDir = args[0]
    const page = args[1]
    if (!runDir || (page !== 'progress' && page !== 'findings')) {
      process.stderr.write('render: missing <run-dir> <progress|findings>\n')
      return 2
    }
    const { runRender } = await import('../scripts/render-cmd.ts')
    return runRender(runDir, page)
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/render-cmd.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/scripts/render-cmd.ts skills/pylon-pr-review/scripts/__tests__/render-cmd.test.ts skills/pylon-pr-review/bin/pr-review.ts
git commit -m "feat(pr-review-skill): wire render subcommand with versioned filenames"
```

---

## Phase 6: Cleanup and housekeeping

### Task 16: `cleanup` subcommand

**Files:**
- Create: `skills/pylon-pr-review/scripts/cleanup-cmd.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/cleanup-cmd.test.ts`
- Modify: `skills/pylon-pr-review/bin/pr-review.ts`

`cleanup` removes the worktree, kills the server (via SIGTERM to the pid in `state/server-info`), and renames the run-dir to `<run-dir>.archived-<timestamp>`. The skill never auto-deletes; archival keeps logs for postmortem.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/cleanup-cmd.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { runCleanup } from '../cleanup-cmd.ts'

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`${cmd.join(' ')} exit ${exit}`)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'prskill-cleanup-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-cleanup-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'worktree', 'add', '--detach', join(runDir, 'worktree'), 'HEAD')
  await mkdir(join(runDir, 'state'), { recursive: true })
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true }).catch(() => {})
})

test('cleanup removes worktree and archives run dir', async () => {
  const exit = await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })
  expect(exit).toBe(0)
  const original = await Bun.file(join(runDir, 'worktree', 'a.txt')).exists()
  expect(original).toBe(false)
  const parent = dirname(runDir)
  const entries = await readdir(parent)
  const archived = entries.find((e) => e.startsWith(`${basename(runDir)}.archived-`))
  expect(archived).toBeDefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/cleanup-cmd.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/cleanup-cmd.ts`**

```typescript
import { readFile, rename, stat } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { removeWorktree } from './worktree.ts'

export type RunCleanupInput = {
  runDir: string
  repoPath: string
  gitBin: string
}

export async function runCleanup(input: RunCleanupInput): Promise<number> {
  const worktreePath = join(input.runDir, 'worktree')
  const worktreeExists = await stat(worktreePath).then(() => true).catch(() => false)
  if (worktreeExists) {
    await removeWorktree({
      gitBin: input.gitBin,
      repoPath: input.repoPath,
      worktreePath,
    })
  }

  const infoPath = join(input.runDir, 'state', 'server-info')
  try {
    const info = JSON.parse(await readFile(infoPath, 'utf8')) as { pid?: number }
    if (info.pid && info.pid !== process.pid) {
      try {
        process.kill(info.pid, 'SIGTERM')
      } catch {}
    }
  } catch {}

  const target = `${input.runDir}.archived-${Date.now()}`
  await rename(input.runDir, target)
  process.stdout.write(`archived to ${target}\n`)
  return 0
}
```

- [ ] **Step 4: Wire into CLI**

Edit `skills/pylon-pr-review/bin/pr-review.ts`. Replace `cleanup: async () => 0,` with:

```typescript
  cleanup: async (args) => {
    const runDir = args[0]
    const repoFlag = args.indexOf('--repo')
    if (!runDir) {
      process.stderr.write('cleanup: missing <run-dir> [--repo <path>]\n')
      return 2
    }
    const repoPath = repoFlag !== -1 ? args[repoFlag + 1] : process.cwd()
    const { runCleanup } = await import('../scripts/cleanup-cmd.ts')
    return runCleanup({ runDir, repoPath, gitBin: process.env.PR_REVIEW_GIT_BIN || 'git' })
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/cleanup-cmd.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/scripts/cleanup-cmd.ts skills/pylon-pr-review/scripts/__tests__/cleanup-cmd.test.ts skills/pylon-pr-review/bin/pr-review.ts
git commit -m "feat(pr-review-skill): cleanup subcommand archives run dir"
```

---

### Task 17: `status` subcommand

**Files:**
- Create: `skills/pylon-pr-review/scripts/status-cmd.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/status-cmd.test.ts`
- Modify: `skills/pylon-pr-review/bin/pr-review.ts`

`status` reads `log.jsonl` and prints the highest completed stage as JSON. The orchestrating agent uses this for resumption.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/status-cmd.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runStatus } from '../status-cmd.ts'

let runDir: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-status-'))
})

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('reports last completed stage', async () => {
  await writeFile(
    join(runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'setup', status: 'done' })}\n${JSON.stringify({ stage: 'context', status: 'done' })}\n${JSON.stringify({ stage: 'specialists', status: 'running' })}\n`,
  )
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('context')
  expect(result.next).toBe('specialists')
})

test('empty log reports nothing completed', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBeNull()
  expect(result.next).toBe('setup')
})

test('error stage halts progression', async () => {
  await writeFile(
    join(runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'setup', status: 'done' })}\n${JSON.stringify({ stage: 'context', status: 'error' })}\n`,
  )
  const result = await runStatus(runDir)
  expect(result.lastCompleted).toBe('setup')
  expect(result.error).toBe('context')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/status-cmd.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/status-cmd.ts`**

```typescript
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ORDER = [
  'setup',
  'context',
  'specialists',
  'dedupe',
  'critic',
  'peer-review',
  'report',
  'post',
] as const

export type StatusResult = {
  lastCompleted: (typeof ORDER)[number] | null
  next: (typeof ORDER)[number] | 'cleanup'
  error: string | null
}

export async function runStatus(runDir: string): Promise<StatusResult> {
  const text = await readFile(join(runDir, 'log.jsonl'), 'utf8').catch(() => '')
  let lastCompleted: StatusResult['lastCompleted'] = null
  let error: string | null = null
  for (const line of text.split('\n').filter(Boolean)) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const stage = entry.stage as string
    const status = entry.status as string
    if (status === 'error') {
      error = stage
      break
    }
    if (status === 'done' && (ORDER as readonly string[]).includes(stage)) {
      lastCompleted = stage as StatusResult['lastCompleted']
    }
  }
  const idx = lastCompleted ? ORDER.indexOf(lastCompleted) : -1
  const next = idx + 1 < ORDER.length ? ORDER[idx + 1] : 'cleanup'
  return { lastCompleted, next, error }
}
```

- [ ] **Step 4: Wire into CLI**

Edit `skills/pylon-pr-review/bin/pr-review.ts`. Replace `status: async () => 0,` with:

```typescript
  status: async (args) => {
    const runDir = args[0]
    if (!runDir) {
      process.stderr.write('status: missing <run-dir>\n')
      return 2
    }
    const { runStatus } = await import('../scripts/status-cmd.ts')
    const result = await runStatus(runDir)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/status-cmd.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/scripts/status-cmd.ts skills/pylon-pr-review/scripts/__tests__/status-cmd.test.ts skills/pylon-pr-review/bin/pr-review.ts
git commit -m "feat(pr-review-skill): status subcommand reads log.jsonl"
```

---

### Task 18: `--list-runs` and `--cleanup-run` housekeeping

**Files:**
- Create: `skills/pylon-pr-review/scripts/housekeeping-cmd.ts`
- Create: `skills/pylon-pr-review/scripts/__tests__/housekeeping-cmd.test.ts`
- Modify: `skills/pylon-pr-review/bin/pr-review.ts`

Housekeeping lives outside any specific run-dir. It scans `~/.pylon-review/` (or `$PYLON_REVIEW_HOME` override) for run directories and archived runs.

- [ ] **Step 1: Write the failing test**

`skills/pylon-pr-review/scripts/__tests__/housekeeping-cmd.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listRuns, cleanupRun } from '../housekeeping-cmd.ts'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'prskill-home-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

test('listRuns picks up active and archived runs', async () => {
  await mkdir(join(home, 'pr-1-100'))
  await mkdir(join(home, 'pr-2-200.archived-300'))
  await mkdir(join(home, 'unrelated'))
  const runs = await listRuns(home)
  const ids = runs.map((r) => r.id).sort()
  expect(ids).toEqual(['pr-1-100', 'pr-2-200.archived-300'])
})

test('cleanupRun deletes the matching directory', async () => {
  await mkdir(join(home, 'pr-1-100'))
  const exit = await cleanupRun(home, 'pr-1-100')
  expect(exit).toBe(0)
  const dirs = await listRuns(home)
  expect(dirs).toEqual([])
})

test('cleanupRun on unknown id returns non-zero', async () => {
  const exit = await cleanupRun(home, 'does-not-exist')
  expect(exit).not.toBe(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/housekeeping-cmd.test.ts`
Expected: FAIL with module resolution error.

- [ ] **Step 3: Write `skills/pylon-pr-review/scripts/housekeeping-cmd.ts`**

```typescript
import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ACTIVE_PATTERN = /^pr-\d+-\d+$/
const ARCHIVED_PATTERN = /^pr-\d+-\d+\.archived-\d+$/

export function reviewHome(): string {
  return process.env.PYLON_REVIEW_HOME ?? join(homedir(), '.pylon-review')
}

export type RunInfo = { id: string; archived: boolean; path: string }

export async function listRuns(home?: string): Promise<RunInfo[]> {
  const root = home ?? reviewHome()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const runs: RunInfo[] = []
  for (const id of entries) {
    const path = join(root, id)
    const s = await stat(path).catch(() => null)
    if (!s || !s.isDirectory()) continue
    if (ACTIVE_PATTERN.test(id)) {
      runs.push({ id, archived: false, path })
    } else if (ARCHIVED_PATTERN.test(id)) {
      runs.push({ id, archived: true, path })
    }
  }
  return runs
}

export async function cleanupRun(home: string | undefined, id: string): Promise<number> {
  const root = home ?? reviewHome()
  const target = join(root, id)
  const exists = await stat(target).then(() => true).catch(() => false)
  if (!exists) {
    process.stderr.write(`cleanup-run: ${id} not found in ${root}\n`)
    return 1
  }
  await rm(target, { recursive: true, force: true })
  return 0
}
```

- [ ] **Step 4: Wire into CLI**

Edit `skills/pylon-pr-review/bin/pr-review.ts`. Replace both housekeeping stubs:

```typescript
  '--list-runs': async () => {
    const { listRuns } = await import('../scripts/housekeeping-cmd.ts')
    const runs = await listRuns()
    for (const r of runs) {
      process.stdout.write(`${r.id}\t${r.archived ? 'archived' : 'active'}\t${r.path}\n`)
    }
    return 0
  },
  '--cleanup-run': async (args) => {
    const id = args[0]
    if (!id) {
      process.stderr.write('--cleanup-run: missing <id>\n')
      return 2
    }
    const { cleanupRun } = await import('../scripts/housekeeping-cmd.ts')
    return cleanupRun(undefined, id)
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/housekeeping-cmd.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/scripts/housekeeping-cmd.ts skills/pylon-pr-review/scripts/__tests__/housekeeping-cmd.test.ts skills/pylon-pr-review/bin/pr-review.ts
git commit -m "feat(pr-review-skill): list-runs and cleanup-run housekeeping"
```

---

## Phase 7: Pipeline integration test

### Task 19: End-to-end deterministic stages test

**Files:**
- Create: `skills/pylon-pr-review/scripts/__tests__/pipeline-e2e.test.ts`

This test wires setup (with fake `gh`) into dedupe, render-progress, render-findings, and cleanup. It bakes pre-existing `findings/<focus>.json` files into the run dir, simulating what the specialist subagents would have produced.

- [ ] **Step 1: Write the test**

`skills/pylon-pr-review/scripts/__tests__/pipeline-e2e.test.ts`:

```typescript
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { runSetup } from '../setup-cmd.ts'
import { runDedupe } from '../dedupe-cmd.ts'
import { runRender } from '../render-cmd.ts'
import { runCleanup } from '../cleanup-cmd.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`${cmd.join(' ')} exit ${exit}`)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'prskill-e2e-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-e2e-run-'))
  await rm(runDir, { recursive: true, force: true })
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'branch', 'feature-x')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  // run-dir is renamed to .archived-* by cleanup; remove any leftover.
  await rm(runDir, { recursive: true, force: true }).catch(() => {})
})

test('setup -> dedupe -> render(progress) -> render(findings) -> cleanup composes', async () => {
  const setupExit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(setupExit).toBe(0)

  await writeFile(
    join(runDir, 'findings', 'bugs.json'),
    JSON.stringify([
      {
        id: 'a',
        file: 'a.txt',
        line: 1,
        severity: 'high',
        risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        title: 'first bug',
        description: 'd',
        domain: 'bugs',
      },
    ]),
  )

  expect(await runDedupe(runDir)).toBe(0)
  await writeFile(
    join(runDir, 'findings.final.json'),
    await Bun.file(join(runDir, 'findings.deduped.json')).text(),
  )

  expect(await runRender(runDir, 'progress')).toBe(0)
  expect(await runRender(runDir, 'findings')).toBe(0)

  const screen = await readdir(join(runDir, 'screen'))
  expect(screen).toContain('progress.html')
  expect(screen).toContain('findings.html')

  expect(await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })).toBe(0)
  const parent = dirname(runDir)
  const entries = await readdir(parent)
  expect(entries.find((e) => e.startsWith(`${basename(runDir)}.archived-`))).toBeDefined()
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/pipeline-e2e.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: Run the full skill test suite**

Run: `cd skills/pylon-pr-review && bun test`
Expected: All tests pass. Note total count.

- [ ] **Step 4: Run lint and typecheck**

Run: `cd skills/pylon-pr-review && bun run lint`
Expected: Exits 0.

Run: `cd skills/pylon-pr-review && bun run typecheck`
Expected: Exits 0.

- [ ] **Step 5: Commit**

```bash
git add skills/pylon-pr-review/scripts/__tests__/pipeline-e2e.test.ts
git commit -m "test(pr-review-skill): end-to-end deterministic stages integration"
```

---

## Phase 8: SKILL.md content

### Task 20: Port specialist prompts

**Files:**
- Modify: `skills/pylon-pr-review/SKILL.md`
- Create: `skills/pylon-pr-review/scripts/__tests__/skill-lint.test.ts`

Port the five specialist prompts (security, bugs, performance, code-smells, architecture) from `src/main/pr-review-manager.ts:75`. Each prompt is inlined inside a fenced block tagged `pr-review-specialist-<focus>` so the lint script can extract them.

- [ ] **Step 1: Write the failing lint test**

`skills/pylon-pr-review/scripts/__tests__/skill-lint.test.ts`:

```typescript
import { test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'

const SKILL = new URL('../../SKILL.md', import.meta.url).pathname
const FOCUSES = ['security', 'bugs', 'performance', 'code-smells', 'architecture'] as const

test('SKILL.md has a specialist block for every focus', async () => {
  const text = await readFile(SKILL, 'utf8')
  for (const focus of FOCUSES) {
    const tag = `pr-review-specialist-${focus}`
    expect(text).toContain('```' + tag)
    const start = text.indexOf('```' + tag)
    const end = text.indexOf('```', start + tag.length + 3)
    const block = text.slice(start, end)
    expect(block).toContain('write findings to')
    expect(block).toContain(focus)
  }
})

test('SKILL.md has the critic and peer-review blocks', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('```pr-review-critic')
  expect(text).toContain('```pr-review-peer-review')
})

test('SKILL.md has the stage walkthrough', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('## Stage walkthrough')
  expect(text).toMatch(/pr-review setup/)
  expect(text).toMatch(/pr-review serve/)
  expect(text).toMatch(/pr-review dedupe/)
  expect(text).toMatch(/pr-review render/)
  expect(text).toMatch(/pr-review cleanup/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/skill-lint.test.ts`
Expected: FAIL on all three tests (skeleton has no content yet).

- [ ] **Step 3: Open `src/main/pr-review-manager.ts` and copy the prompts**

The prompts live in `DEFAULT_AGENT_PROMPTS` at line 75. For each focus, copy the array of strings, join them with `\n`, and embed each in `SKILL.md` as a fenced block.

For each focus key (security at line 76, bugs at line 135, performance at line 192, code-smells at line 245, architecture at line 347), copy the full string array verbatim into SKILL.md inside a fenced block. Below each prompt, prepend the output-contract sentence:

```
Output contract: write findings to <run-dir>/findings/<focus>.json before returning. Return a one-line summary as your tool result.
```

- [ ] **Step 4: Edit `skills/pylon-pr-review/SKILL.md`**

Replace the `## Specialist prompts` section with five subsections (one per focus). Use this template per focus, replacing `<focus>` and `<prompt-body>`:

````markdown
### <focus>

```pr-review-specialist-<focus>
<prompt-body>

## Output Contract
Write findings to <run-dir>/findings/<focus>.json before returning. Each entry must match the schema in scripts/types.ts. Return a single-line summary as your tool result.
```
````

(Repeat for security, bugs, performance, code-smells, architecture. Each `<prompt-body>` is the literal string array from `pr-review-manager.ts`, joined with `\n`.)

- [ ] **Step 5: Run lint test to verify it passes**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/skill-lint.test.ts -t "specialist block"`
Expected: PASS on the specialist-block test. The other two tests still fail.

- [ ] **Step 6: Commit**

```bash
git add skills/pylon-pr-review/SKILL.md skills/pylon-pr-review/scripts/__tests__/skill-lint.test.ts
git commit -m "feat(pr-review-skill): port five specialist prompts into SKILL.md"
```

---

### Task 21: Port critic rubric

**Files:**
- Modify: `skills/pylon-pr-review/SKILL.md`

- [ ] **Step 1: Open `src/main/pr-review-critic.ts`**

Read the file. The exported function `buildCriticPrompt` constructs the prompt; the literal text is what we port. The verdict schema and parser logic in the same file describe the expected response format.

- [ ] **Step 2: Edit `skills/pylon-pr-review/SKILL.md`**

Replace `## Critic rubric` with the literal critic prompt body wrapped in a fenced block:

````markdown
## Critic rubric

The main agent runs this in-conversation against `findings.deduped.json` and writes the kept subset to `findings.kept.json`.

```pr-review-critic
<critic prompt body from pr-review-critic.ts buildCriticPrompt, verbatim>

## Output Contract
Return verdicts as a JSON array inside a fenced code block tagged "critic-verdicts". Each verdict: {"id": <finding-id>, "verdict": "keep" | "drop" | "downgrade", "newSeverity"?: "blocker"|"high"|"medium"|"low", "reason": <one-sentence>}.
```
````

- [ ] **Step 3: Run lint test for critic block**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/skill-lint.test.ts -t "critic and peer-review blocks"`
Expected: still FAIL because peer-review block is missing.

- [ ] **Step 4: Commit**

```bash
git add skills/pylon-pr-review/SKILL.md
git commit -m "feat(pr-review-skill): port critic rubric into SKILL.md"
```

---

### Task 22: Port peer-review prompt

**Files:**
- Modify: `skills/pylon-pr-review/SKILL.md`

- [ ] **Step 1: Open `src/main/pr-review-peer-review.ts`**

The peer-review prompt is built in `buildPeerReviewPrompt`. Port the literal text plus the verdict-template instruction (keep / drop / downgrade), so codex emits structured JSON.

- [ ] **Step 2: Edit `skills/pylon-pr-review/SKILL.md`**

Replace `## Peer-review prompt` with:

````markdown
## Peer-review prompt

The agent writes the kept-findings list and this prompt to `<run-dir>/peer-prompt.md`, then runs:

```
codex exec --file <run-dir>/peer-prompt.md > <run-dir>/peer.json
```

```pr-review-peer-review
<peer-review prompt body from pr-review-peer-review.ts buildPeerReviewPrompt, verbatim>

## Output Contract
Return verdicts as a JSON array inside a fenced code block tagged "peer-review-verdicts". Each verdict: {"id": <finding-id>, "verdict": "keep" | "drop" | "downgrade", "newSeverity"?: "blocker"|"high"|"medium"|"low", "reason": <one-sentence>}.
```
````

- [ ] **Step 3: Run lint test**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/skill-lint.test.ts -t "critic and peer-review"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/pylon-pr-review/SKILL.md
git commit -m "feat(pr-review-skill): port peer-review prompt into SKILL.md"
```

---

### Task 23: Stage walkthrough

**Files:**
- Modify: `skills/pylon-pr-review/SKILL.md`

The stage walkthrough is the agent-facing instruction manual: which Bash command to run for each stage, what to do with the output, when to ask the user for a response.

- [ ] **Step 1: Edit `skills/pylon-pr-review/SKILL.md`**

Replace `## Stage walkthrough` with:

````markdown
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

If exit is non-zero, surface stderr verbatim and stop. No partial state remains.

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

If the `mcp__code-intelligence__search_code` tool is available in this conversation, build the context bundle by calling code-intelligence MCP tools for each changed file and writing the result to `$RUN_DIR/pr-context.json`. The file's shape matches Pylon's `pr-context.json` (changed symbols with definitions, references capped at 20 per symbol, tests for each symbol). If MCP is not available, log `{stage: context, status: skipped, reason: mcp-unavailable}` to `$RUN_DIR/log.jsonl` and continue. Re-render progress.

### 4. Specialists

Dispatch the five specialist subagents in a single message using five Agent tool calls in parallel. For each focus in (security, bugs, performance, code-smells, architecture), the prompt is:

```
<specialist block for focus from this SKILL.md>

You are reviewing PR #<PR_NUMBER>.
Working directory: $RUN_DIR/worktree
Diff: $RUN_DIR/diff.patch
Code context (if exists): $RUN_DIR/pr-context.json

Output contract: write findings to $RUN_DIR/findings/<focus>.json before returning. Each entry must match the schema in scripts/types.ts (id, file, line, severity, risk, title, description, optional suggestion, domain="<focus>"). Return a one-line summary as your tool result.
```

After each subagent returns, append `{stage: specialist, focus: <focus>, status: done, findings: <count>}` to `$RUN_DIR/log.jsonl` and re-render progress.

If all five specialists fail (no findings files written), log `{stage: specialists, status: error}` and stop. Otherwise mark `{stage: specialists, status: done}`.

### 5. Dedupe

```
pr-review dedupe "$RUN_DIR"
```

Re-render progress.

### 6. Critic

Read `$RUN_DIR/findings.deduped.json`. Apply the critic rubric from this SKILL.md verbatim (one verdict per finding). Write the kept subset to `$RUN_DIR/findings.kept.json`. Append `{stage: critic, status: done}` and re-render progress.

### 7. Peer review

Write the peer-review prompt (from this SKILL.md) plus the contents of `findings.kept.json` to `$RUN_DIR/peer-prompt.md`. Then:

```
codex exec --file "$RUN_DIR/peer-prompt.md" > "$RUN_DIR/peer.json"
```

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

## Resuming a crashed run

If the user re-invokes the skill and a `$RUN_DIR/state/server-info` exists:

```
pr-review status "$RUN_DIR"
```

The JSON output tells you `lastCompleted` and `next`. Resume from `next`. If a specialist focus has no findings file but its sibling stages are done, re-dispatch only that focus.

## Aborting

If the user types `abort` mid-run, run `pr-review cleanup` immediately and exit.
````

- [ ] **Step 2: Run the SKILL.md lint suite**

Run: `cd skills/pylon-pr-review && bun test scripts/__tests__/skill-lint.test.ts`
Expected: PASS on all 3 tests.

- [ ] **Step 3: Commit**

```bash
git add skills/pylon-pr-review/SKILL.md
git commit -m "feat(pr-review-skill): stage walkthrough and resume/abort docs"
```

---

## Phase 9: Install and ship

### Task 24: install.sh

**Files:**
- Create: `skills/pylon-pr-review/install.sh`

The install script symlinks the skill directory into `~/.claude/skills/pylon-pr-review/` so Claude Code picks it up. Symlink (not copy) so iteration is immediate.

- [ ] **Step 1: Write the script**

`skills/pylon-pr-review/install.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$HOME/.claude/skills/pylon-pr-review"

if [ -e "$TARGET" ] && [ ! -L "$TARGET" ]; then
  echo "Refusing to overwrite non-symlink at $TARGET"
  echo "Remove or move it manually, then re-run."
  exit 1
fi

mkdir -p "$HOME/.claude/skills"
ln -snf "$SOURCE_DIR" "$TARGET"

echo "Installed pylon-pr-review skill at $TARGET"
echo ""
echo "Verify:"
echo "  ls -l $TARGET"
echo "  bun $TARGET/bin/pr-review.ts --help"
```

```bash
chmod +x skills/pylon-pr-review/install.sh
```

- [ ] **Step 2: Smoke-test**

Run: `skills/pylon-pr-review/install.sh`
Expected: prints "Installed pylon-pr-review skill at ~/.claude/skills/pylon-pr-review".

Run: `ls -l ~/.claude/skills/pylon-pr-review`
Expected: symlink target points at the repo path.

Run: `bun ~/.claude/skills/pylon-pr-review/bin/pr-review.ts --help`
Expected: prints the usage banner.

Run: `rm ~/.claude/skills/pylon-pr-review` (clean up after smoke test)

- [ ] **Step 3: Commit**

```bash
git add skills/pylon-pr-review/install.sh
git commit -m "feat(pr-review-skill): install script symlinks into ~/.claude/skills/"
```

---

### Task 25: README

**Files:**
- Create: `skills/pylon-pr-review/README.md`

- [ ] **Step 1: Write `skills/pylon-pr-review/README.md`**

```markdown
# pylon-pr-review

Interactive Claude Code skill that runs Pylon's PR review pipeline inside a Claude Code conversation.

## What it does

Given a GitHub PR number, dispatches five specialist subagents in parallel (security, bugs, performance, code-smells, architecture), dedupes their findings, applies a critic rubric, peer-reviews via `codex exec`, serves an interactive HTML report, and posts the findings you select via `gh`.

## Requirements

- `bun` on PATH (https://bun.sh)
- `gh` on PATH, authenticated (`gh auth status`)
- `codex` on PATH, authenticated
- `git` on PATH

## Install

```
./install.sh
```

This symlinks the skill directory into `~/.claude/skills/pylon-pr-review/`.

## Use

Inside Claude Code, ask: "Review PR 1234" (or paste a PR URL). The agent will follow the stage walkthrough in `SKILL.md`.

## Development

```
bun install           # No deps; placeholder for tooling parity
bun test              # Run all tests
bun run lint          # Biome check
bun run typecheck     # tsc --noEmit
```

## Layout

- `SKILL.md` is the slash-command file Claude Code loads.
- `bin/pr-review` is the CLI invoked by the agent during stages.
- `scripts/` holds the implementation (server, dedupe, render, setup, cleanup).
- `templates/styles.css` is the report stylesheet.
- `fixtures/` holds canned PR data for tests.

## Run directory layout

Each invocation creates `~/.pylon-review/pr-<n>-<ts>/` with `pr.json`, `diff.patch`, `findings/`, `findings.deduped.json`, `findings.kept.json`, `findings.final.json`, `screen/`, `state/`, `log.jsonl`. On completion the directory is renamed to `<run-dir>.archived-<timestamp>` rather than deleted, so logs survive for postmortem.
```

- [ ] **Step 2: Final full-suite verification**

Run (from project root):

```bash
bun run test:skills && bun run lint:skills && bun run typecheck:skills
```

Expected: All three pass.

- [ ] **Step 3: Commit**

```bash
git add skills/pylon-pr-review/README.md
git commit -m "docs(pr-review-skill): add README"
```

---

## Self-Review

### Spec coverage

Walking through `docs/plans/2026-05-14-pr-review-skill-design.md` section by section against the plan:

- **Architecture / pipeline stages** → Tasks 7-19 implement the deterministic stages (preflight, gh fetch, worktree, dedupe, render, cleanup); Task 23 documents how the main agent walks the interactive stages (specialists, context, critic, peer-review, report, post).
- **State location** (`~/.pylon-review/<run-id>/`) → Task 10 (setup), Task 16 (cleanup archives in place), Task 18 (housekeeping).
- **Run directory layout** → Task 10 creates `findings/`, `screen/`, `state/`; Task 6 writes `findings.deduped.json`; Task 23 documents `findings.kept.json` / `findings.final.json` / `post-status.json`.
- **Skill markdown** → Tasks 2 (skeleton) + 20-23 (prompts, rubric, peer-review, walkthrough).
- **Bundled scripts** → Tasks 3 (CLI), 4-5 (types/dedupe), 7-10 (setup), 11-13 (server/serve), 14-15 (render), 16 (cleanup), 17 (status), 18 (housekeeping).
- **Specialist subagents** → Task 23 (walkthrough) instructs the agent how to dispatch them via `Agent` tool with the focus-specific prompts from Task 20.
- **Critic stage** → Task 21 ports the rubric into SKILL.md; Task 23 step 6 documents how the main agent applies it.
- **Peer-review stage** → Task 22 ports the prompt; Task 23 step 7 documents the `codex exec` invocation and fallback prompt.
- **Report stage** → Tasks 14-15 (render) plus Task 23 step 8.
- **Post stage** → Task 23 step 9 (`gh` invocations and post-status tracking).
- **Resumption** → Task 17 (`status` subcommand) + Task 23's "Resuming a crashed run" section.
- **Abort** → Task 23's "Aborting" section, falls through to Task 16's cleanup.
- **Concurrent runs** → Task 12 (server binds to port 0); Task 10 (run-dir is per-invocation).
- **Error handling table** → Setup errors handled in Task 10 (atomic rollback); specialists in Task 6 (parse-error tolerance); peer-review fallback in Task 23 step 7; server lifecycle in Task 12.
- **Testing: dedupe** → Task 5.
- **Testing: render snapshots** → Task 14.
- **Testing: server integration** → Task 12.
- **Testing: setup mocked gh** → Task 8 + Task 10.
- **Testing: cleanup** → Task 16.
- **Testing: pipeline-level** → Task 19.
- **Testing: skill markdown lint** → Task 20 (and reused in Tasks 21-23).
- **Non-goal: incremental review** → not added (correct per spec).
- **Optional parity-check script** → not added; called out in the spec as "Not part of CI". A separate follow-up plan can introduce it.

No gaps.

### Placeholder scan

The plan uses `<run-dir>`, `<focus>`, `<owner>`, `<repo>`, etc. inside SKILL.md content blocks. These are template placeholders the agent fills in at runtime, not plan placeholders. Every code block, command, and file path is concrete. No "TBD" or "implement later" text.

### Type and signature consistency

Walked all cross-task references:

- `ReviewFinding`, `parseFinding`, `FOCUS_IDS` defined in Task 4 → used in Tasks 5, 6, 14, 15, 19.
- `deduplicateFindings`, `tokenize`, `diceCoefficient` defined in Task 5 → used in Task 6.
- `preflight`, `renderInstallHint`, `defaultDeps` defined in Task 7 → used in Task 10.
- `fetchPr` defined in Task 8 → used in Task 10.
- `createWorktree`, `removeWorktree` defined in Task 9 → used in Tasks 10, 16.
- `runDedupe` defined in Task 6 → used in CLI router (Task 6) and Task 19.
- `runSetup`, `runServe`, `runRender`, `runCleanup`, `runStatus`, `listRuns`, `cleanupRun` → defined and CLI-wired in their respective tasks, used in Task 19.
- `startServer` `ServerHandle` defined in Task 12 → used in Task 13.
- `renderProgressToDisk`, `renderFindingsToDisk` defined in Task 14 → used in Task 15.
- `PostStatusMap` defined in Task 14 (render-findings.ts) → consumed by Task 15 (read from `post-status.json`); written by Task 23's post stage as documented.

All consistent.

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-05-14-pr-review-skill-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
