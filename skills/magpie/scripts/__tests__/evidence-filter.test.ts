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
  const result = await verifyEvidence([finding({ line: 2 })], worktree)
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
  const findings = [finding({ id: 'a', line: 1 }), finding({ id: 'b', line: 3 })]
  const result = await verifyEvidence(findings, worktree)
  expect(result.kept.map((f) => f.id)).toEqual(['a', 'b'])
})

test('rejects directory paths', async () => {
  const result = await verifyEvidence([finding({ file: 'src', line: 1 })], worktree)
  expect(result.kept).toHaveLength(0)
  expect(result.dropped[0]?.reason).toBe('hallucinated-file')
})
