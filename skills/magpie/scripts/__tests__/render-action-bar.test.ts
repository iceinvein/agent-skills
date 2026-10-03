import { describe, expect, test } from 'bun:test'
import { renderActionBar } from '../render-action-bar.ts'
import type { ReviewFinding } from '../types.ts'

const findings: ReviewFinding[] = [
  {
    id: '1',
    file: 'a.ts',
    line: 1,
    severity: 'blocker',
    title: 'A',
    description: 'd',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
    domain: 'security',
  },
  {
    id: '2',
    file: 'b.ts',
    line: 1,
    severity: 'high',
    title: 'B',
    description: 'd',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'should-fix' },
    domain: 'bugs',
  },
  {
    id: '3',
    file: 'c.ts',
    line: 1,
    severity: 'low',
    title: 'C',
    description: 'd',
    risk: { impact: 'low', likelihood: 'unknown', confidence: 'medium', action: 'optional' },
    domain: 'code-smells',
  },
] as ReviewFinding[]

describe('renderActionBar', () => {
  test('Post Recommended count excludes suggestions', () => {
    const html = renderActionBar({ findings, postStatus: {}, dismissed: new Map(), topN: 10 })
    expect(html).toContain('Post Recommended (2)')
  })

  test('initial Post Selected reads 0', () => {
    const html = renderActionBar({ findings, postStatus: {}, dismissed: new Map(), topN: 10 })
    expect(html).toContain('Post Selected (')
    expect(html).toMatch(/data-role="selected-count">0</)
  })

  test('renders excluded suggestions hint when suggestions present', () => {
    const html = renderActionBar({ findings, postStatus: {}, dismissed: new Map(), topN: 10 })
    expect(html).toContain('1 suggestion excluded')
  })

  test('renders severity selection pills with counts', () => {
    const html = renderActionBar({ findings, postStatus: {}, dismissed: new Map(), topN: 10 })
    expect(html).toContain('data-action="select-sev"')
    expect(html).toContain('data-sev="blocker"')
    expect(html).toContain('data-sev="high"')
  })

  test('renders Select recommended link', () => {
    const html = renderActionBar({ findings, postStatus: {}, dismissed: new Map(), topN: 10 })
    expect(html).toContain('data-action="select-recommended"')
  })

  test('Post Recommended counts no more than topN when more actionable findings exist', () => {
    const html = renderActionBar({
      findings: actionable(12),
      postStatus: {},
      dismissed: new Map(),
      topN: 10,
    })
    expect(html).toContain('Post Recommended (10)')
  })

  test('Post Recommended counts every actionable finding when fewer than topN exist', () => {
    const html = renderActionBar({
      findings: actionable(4),
      postStatus: {},
      dismissed: new Map(),
      topN: 10,
    })
    expect(html).toContain('Post Recommended (4)')
  })

  test('Post Recommended leaves dismissed findings out of the count', () => {
    const dismissed = new Map([
      ['f0', 'wrong'],
      ['f1', 'style'],
      ['f2', 'duplicate'],
    ])
    const html = renderActionBar({ findings: actionable(12), postStatus: {}, dismissed, topN: 10 })
    expect(html).toContain('Post Recommended (9)')
  })

  test('Post Recommended counts a posted finding even when it was dismissed', () => {
    const dismissed = new Map([
      ['f0', 'wrong'],
      ['f1', 'style'],
      ['f2', 'duplicate'],
    ])
    const html = renderActionBar({
      findings: actionable(12),
      postStatus: { f0: 'posted' },
      dismissed,
      topN: 10,
    })
    expect(html).toContain('Post Recommended (10)')
  })
})

function actionable(n: number): ReviewFinding[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `f${i}`,
    file: 'a.ts',
    line: i + 1,
    severity: 'high',
    title: `T${i}`,
    description: 'd',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
    domain: 'bugs',
  })) as ReviewFinding[]
}
