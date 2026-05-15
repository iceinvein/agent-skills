import { expect, test } from 'bun:test'
import type { FocusId, ReviewFinding } from '../types.ts'
import { FOCUS_IDS, parseFinding } from '../types.ts'

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
