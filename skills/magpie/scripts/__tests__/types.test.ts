import { describe, expect, test } from 'bun:test'
import type { FocusId, PrFileEntry, ReviewFinding } from '../types.ts'
import { FOCUS_IDS, isSuggestion, parseFinding } from '../types.ts'

test('FOCUS_IDS contains the five default focuses', () => {
  expect(FOCUS_IDS).toEqual(['security', 'bugs', 'performance', 'code-smells', 'architecture'])
})

test('parseFinding accepts a minimal finding', () => {
  const focus: FocusId = 'bugs'
  const raw = {
    id: 'f1',
    file: 'src/x.ts',
    line: 10,
    severity: 'high',
    risk: { impact: 'high', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: 'oops',
    description: 'detail',
    domain: focus,
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

describe('PrFileEntry', () => {
  test('shape is { path, additions, deletions }', () => {
    const f: PrFileEntry = { path: 'src/a.ts', additions: 10, deletions: 2 }
    expect(f.path).toBe('src/a.ts')
    expect(f.additions).toBe(10)
    expect(f.deletions).toBe(2)
  })
})

describe('isSuggestion', () => {
  const base = {
    id: '1',
    file: 'a.ts',
    line: 1,
    severity: 'low' as const,
    title: 't',
    description: 'd',
    risk: {
      impact: 'low' as const,
      likelihood: 'unknown' as const,
      confidence: 'medium' as const,
      action: 'optional' as const,
    },
    domain: 'security' as const,
  }
  test('returns true for action=optional', () => {
    expect(isSuggestion(parseFinding({ ...base }))).toBe(true)
  })
  test('returns true for action=consider', () => {
    expect(
      isSuggestion(parseFinding({ ...base, risk: { ...base.risk, action: 'consider' } })),
    ).toBe(true)
  })
  test('returns false for action=must-fix', () => {
    expect(
      isSuggestion(parseFinding({ ...base, risk: { ...base.risk, action: 'must-fix' } })),
    ).toBe(false)
  })
  test('returns false for action=should-fix', () => {
    expect(
      isSuggestion(parseFinding({ ...base, risk: { ...base.risk, action: 'should-fix' } })),
    ).toBe(false)
  })
})
