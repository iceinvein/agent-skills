import { expect, test } from 'bun:test'
import { deduplicateFindings, diceCoefficient, tokenize } from '../dedupe.ts'
import type { ReviewFinding } from '../types.ts'

function f(partial: Partial<ReviewFinding> & { id: string; title: string }): ReviewFinding {
  return {
    id: partial.id,
    file: partial.file ?? 'src/a.ts',
    line: 'line' in partial ? (partial.line ?? null) : 1,
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
  expect(out[0]?.severity).toBe('blocker')
  expect(out[0]?.domain).toBe('security')
  expect(out[0]?.description).toContain('Also flagged by: code-smells')
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
  expect(out[0]?.suggestion?.body).toBe('if (!x) return')
})
