import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyEvidence } from '../evidence-filter.ts'
import type { ReviewFinding } from '../types.ts'

let worktree: string

function finding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return {
    id: 'x-1',
    file: 'src/a.ts',
    line: 1,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: 't',
    description: 'd',
    domain: 'bugs',
    ...overrides,
  }
}

beforeEach(async () => {
  worktree = await mkdtemp(join(tmpdir(), 'magpie-evidence-'))
  await mkdir(join(worktree, 'src'), { recursive: true })
  await writeFile(join(worktree, 'src/a.ts'), 'line1\nline2\nline3\n')
})

afterEach(async () => {
  await rm(worktree, { recursive: true, force: true })
})

test('keeps finding with valid file and line', async () => {
  const result = await verifyEvidence([finding({ line: 2, evidence: 'line2' })], worktree)
  expect(result.kept).toHaveLength(1)
  expect(result.dropped).toHaveLength(0)
  expect(result.skipped).toBe(false)
})

test('drops finding referencing missing file', async () => {
  const result = await verifyEvidence([finding({ file: 'src/ghost.ts', line: 1 })], worktree)
  expect(result.kept).toHaveLength(0)
  expect(result.dropped[0]?.reason).toBe('hallucinated-file')
})

test('drops finding when line exceeds file length', async () => {
  const result = await verifyEvidence([finding({ line: 999 })], worktree)
  expect(result.kept).toHaveLength(0)
  expect(result.dropped[0]?.reason).toBe('invented-line')
})

test('drops finding when line is < 1', async () => {
  const result = await verifyEvidence([finding({ line: 0 })], worktree)
  expect(result.kept).toHaveLength(0)
  expect(result.dropped[0]?.reason).toBe('invented-line')
})

test('keeps unanchored finding (line=null) without checking file', async () => {
  const result = await verifyEvidence([finding({ file: 'src/ghost.ts', line: null })], worktree)
  expect(result.kept).toHaveLength(1)
  expect(result.dropped).toHaveLength(0)
})

test('skips verification when worktree is missing', async () => {
  await rm(worktree, { recursive: true, force: true })
  const result = await verifyEvidence([finding({ line: 999 })], worktree)
  expect(result.skipped).toBe(true)
  expect(result.kept).toHaveLength(1)
  expect(result.dropped).toHaveLength(0)
})

test('caches line counts across findings in the same file', async () => {
  const findings = [
    finding({ id: 'a', line: 1, evidence: 'line1' }),
    finding({ id: 'b', line: 3, evidence: 'line3' }),
  ]
  const result = await verifyEvidence(findings, worktree)
  expect(result.kept.map((f) => f.id)).toEqual(['a', 'b'])
})

test('rejects directory paths', async () => {
  const result = await verifyEvidence([finding({ file: 'src', line: 1 })], worktree)
  expect(result.kept).toHaveLength(0)
  expect(result.dropped[0]?.reason).toBe('hallucinated-file')
})

// Hand-written so each test can point at a known line: the auth check spans
// lines 5-6, `readToken` appears once at line 30, `retry()` twice at 12 and 35.
const SOURCE_LINES = [
  '// header',
  "import { deny } from './auth'",
  '',
  'export function guard(user) {',
  '  if (user  ==  null) {',
  '    return deny()',
  '  }',
  '}',
  '// filler 9',
  '// filler 10',
  '// filler 11',
  'retry()',
  '// filler 13',
  '// filler 14',
  '// filler 15',
  '// filler 16',
  '// filler 17',
  '// filler 18',
  '// filler 19',
  '// filler 20',
  '// filler 21',
  '// filler 22',
  '// filler 23',
  '// filler 24',
  '// filler 25',
  '// filler 26',
  '// filler 27',
  '// filler 28',
  '// filler 29',
  'const token = readToken()',
  '// filler 31',
  '// filler 32',
  '// filler 33',
  '// filler 34',
  'retry()',
  '// filler 36',
]

async function writeSource(): Promise<void> {
  await writeFile(join(worktree, 'src/guard.ts'), `${SOURCE_LINES.join('\n')}\n`)
}

function guardFinding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return finding({ file: 'src/guard.ts', ...overrides })
}

test('keeps a finding whose evidence sits at its exact line', async () => {
  await writeSource()
  const result = await verifyEvidence(
    [guardFinding({ line: 5, evidence: 'if (user == null) {' })],
    worktree,
  )
  expect(result.kept.map((f) => f.line)).toEqual([5])
  expect(result.dropped).toEqual([])
})

test('keeps a finding whose evidence is two lines off without moving its line', async () => {
  await writeSource()
  const result = await verifyEvidence(
    [guardFinding({ line: 7, evidence: 'if (user == null) {' })],
    worktree,
  )
  expect(result.kept.map((f) => f.line)).toEqual([7])
  expect(result.reanchored).toEqual([])
})

test('re-anchors a finding whose evidence appears once far from its line', async () => {
  await writeSource()
  const result = await verifyEvidence(
    [
      guardFinding({
        id: 'tok',
        line: 10,
        evidence: 'const token = readToken()',
        suggestion: { body: 'const token = await readToken()', startLine: 10, endLine: 11 },
      }),
    ],
    worktree,
  )
  expect(result.kept[0]?.line).toBe(30)
  expect(result.kept[0]?.suggestion).toEqual({
    body: 'const token = await readToken()',
    startLine: 30,
    endLine: 31,
  })
  expect(result.reanchored).toEqual([{ id: 'tok', file: 'src/guard.ts', from: 10, to: 30 }])
})

test('drops a finding whose evidence appears twice outside the window', async () => {
  await writeSource()
  const result = await verifyEvidence([guardFinding({ line: 22, evidence: 'retry()' })], worktree)
  expect(result.kept).toEqual([])
  expect(result.dropped[0]?.reason).toBe('evidence-not-found')
})

test('drops a finding whose evidence is not in the file', async () => {
  await writeSource()
  const result = await verifyEvidence(
    [guardFinding({ line: 5, evidence: 'eval(userInput)' })],
    worktree,
  )
  expect(result.kept).toEqual([])
  expect(result.dropped[0]?.reason).toBe('evidence-not-found')
})

test('drops an anchored finding that quotes no evidence', async () => {
  await writeSource()
  const result = await verifyEvidence([guardFinding({ line: 5 })], worktree)
  expect(result.kept).toEqual([])
  expect(result.dropped[0]?.reason).toBe('missing-evidence')
})

test('keeps an unanchored finding that quotes no evidence', async () => {
  await writeSource()
  const result = await verifyEvidence([guardFinding({ line: null })], worktree)
  expect(result.kept).toHaveLength(1)
  expect(result.dropped).toEqual([])
})

test('matches evidence ignoring outer whitespace and runs of inner whitespace', async () => {
  await writeSource()
  const result = await verifyEvidence(
    [guardFinding({ line: 5, evidence: '\t if (user ==\t   null)   {  ' })],
    worktree,
  )
  expect(result.kept.map((f) => f.line)).toEqual([5])
})

test('matches multi-line evidence against consecutive file lines', async () => {
  await writeSource()
  const result = await verifyEvidence(
    [guardFinding({ line: 5, evidence: 'if (user == null) {\n  return deny()' })],
    worktree,
  )
  expect(result.kept.map((f) => f.line)).toEqual([5])
})

test('drops multi-line evidence whose lines exist but not consecutively', async () => {
  await writeSource()
  const result = await verifyEvidence(
    [guardFinding({ line: 5, evidence: 'if (user == null) {\nconst token = readToken()' })],
    worktree,
  )
  expect(result.kept).toEqual([])
  expect(result.dropped[0]?.reason).toBe('evidence-not-found')
})
