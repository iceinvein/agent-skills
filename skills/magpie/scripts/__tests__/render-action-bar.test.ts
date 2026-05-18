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
    const html = renderActionBar({ findings })
    expect(html).toContain('Post Recommended (2)')
  })

  test('initial Post Selected reads 0', () => {
    const html = renderActionBar({ findings })
    expect(html).toContain('Post Selected (')
    expect(html).toMatch(/data-role="selected-count">0</)
  })

  test('renders excluded suggestions hint when suggestions present', () => {
    const html = renderActionBar({ findings })
    expect(html).toContain('1 suggestion excluded')
  })

  test('renders severity selection pills with counts', () => {
    const html = renderActionBar({ findings })
    expect(html).toContain('data-action="select-sev"')
    expect(html).toContain('data-sev="blocker"')
    expect(html).toContain('data-sev="high"')
  })

  test('renders Select recommended link', () => {
    const html = renderActionBar({ findings })
    expect(html).toContain('data-action="select-recommended"')
  })
})
