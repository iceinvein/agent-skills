import { beforeAll, describe, expect, test } from 'bun:test'
import type { Highlighter } from 'shiki'
import { getHighlighter } from '../highlight.ts'
import { renderIssuesList } from '../render-issues-list.ts'
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

let hl: Highlighter
beforeAll(async () => {
  hl = await getHighlighter()
})

describe('renderIssuesList', () => {
  test('renders an issue-card per finding', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
    })
    expect((html.match(/class="issue-card/g) ?? []).length).toBe(3)
  })

  test('renders severity filter pills with counts', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
    })
    expect(html).toContain('Blocker (1)')
    expect(html).toContain('High (1)')
    expect(html).toContain('Low (1)')
  })

  test('emits "N should review" with actionable count only', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
    })
    expect(html).toContain('2 should review')
  })

  test('emits "Show N suggestions" toggle when suggestions present', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
    })
    expect(html).toContain('Show 1 suggestion')
  })

  test('suggestion finding has data-suggestion="true"', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
    })
    expect(html).toMatch(
      /data-finding-id="3"[^>]*data-suggestion="true"|data-suggestion="true"[^>]*data-finding-id="3"/,
    )
  })
})
