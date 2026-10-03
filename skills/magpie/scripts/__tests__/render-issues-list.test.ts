import { beforeAll, describe, expect, test } from 'bun:test'
import type { Highlighter } from 'shiki'
import { getHighlighter } from '../highlight.ts'
import { renderIssuesList } from '../render-issues-list.ts'
import type { ReviewFinding, Risk } from '../types.ts'

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
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect((html.match(/class="issue-card/g) ?? []).length).toBe(3)
  })

  test('renders severity filter pills with counts', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
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
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect(html).toContain('2 should review')
  })

  test('emits "Show N suggestions" toggle when suggestions present', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect(html).toContain('Show 1 suggestion')
  })

  test('suggestion finding has data-suggestion="true"', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect(html).toMatch(
      /data-finding-id="3"[^>]*data-suggestion="true"|data-suggestion="true"[^>]*data-finding-id="3"/,
    )
  })

  test('marks only the cards whose ids are dismissed', () => {
    const html = renderIssuesList({
      findings,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map([['2', 'duplicate']]),
      topN: 10,
      highlighter: hl,
    })
    const marked = [...html.matchAll(/data-finding-id="([^"]+)"[^>]*data-dismissed="([^"]+)"/g)]
    expect(marked.map((m) => [m[1], m[2]])).toEqual([['2', 'duplicate']])
  })

  test('ranks the topN highest-scoring actionable findings as recommended, highest first', () => {
    const html = renderIssuesList({
      findings: ranked,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect(recommendedIds(html)).toEqual(['a', 'b', 'c', 'x', 'd', 'g', 'f', 'e', 'h', 'i'])
  })

  test('actionable findings past the topN sit inside the hidden more-findings block', () => {
    const html = renderIssuesList({
      findings: ranked,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    const foldAt = html.indexOf('<div class="more-findings" hidden>')
    expect(foldAt).toBeGreaterThan(-1)
    expect(cardIds(html.slice(foldAt))).toEqual(['j', 'k'])
  })

  test('the fold toggle names how many findings it hides', () => {
    const html = renderIssuesList({
      findings: ranked,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect(html).toMatch(/data-action="toggle-more"[^>]*>Show 2 more</)
  })

  test('a suggestion is never recommended, however high its risk', () => {
    const html = renderIssuesList({
      findings: [
        card('s', {
          impact: 'critical',
          likelihood: 'likely',
          confidence: 'high',
          action: 'consider',
        }),
        card('m', { impact: 'low', likelihood: 'unknown', confidence: 'low', action: 'must-fix' }),
      ],
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect(recommendedIds(html)).toEqual(['m'])
  })

  test('a dismissed finding is never recommended and moves into the fold', () => {
    const html = renderIssuesList({
      findings: ranked,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map([['a', 'wrong']]),
      topN: 10,
      highlighter: hl,
    })
    expect(recommendedIds(html)).toEqual(['b', 'c', 'x', 'd', 'g', 'f', 'e', 'h', 'i', 'j'])
    const foldAt = html.indexOf('<div class="more-findings" hidden>')
    expect(cardIds(html.slice(foldAt))).toEqual(['a', 'k'])
  })

  test('a posted finding ranks as recommended even when it was dismissed', () => {
    const html = renderIssuesList({
      findings: ranked,
      postStatus: { a: 'posted' },
      selectedIds: new Set(),
      dismissed: new Map([['a', 'wrong']]),
      topN: 10,
      highlighter: hl,
    })
    expect(recommendedIds(html)).toEqual(['a', 'b', 'c', 'x', 'd', 'g', 'f', 'e', 'h', 'i'])
  })

  test('renders no fold when every actionable finding fits in the topN', () => {
    const html = renderIssuesList({
      findings: ranked.slice(0, 4),
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: 10,
      highlighter: hl,
    })
    expect(html).not.toContain('data-action="toggle-more"')
    expect(html).not.toContain('more-findings')
  })

  test('a null topN keeps input order with no recommended marks and no fold', () => {
    const html = renderIssuesList({
      findings: ranked,
      postStatus: {},
      selectedIds: new Set(),
      dismissed: new Map(),
      topN: null,
      highlighter: hl,
    })
    expect(html).not.toContain('data-recommended')
    expect(html).not.toContain('more-findings')
    expect(cardIds(html)).toEqual(['k', 'e', 'a', 'j', 'g', 'x', 'i', 'c', 'h', 'b', 'f', 'd'])
  })
})

function card(id: string, risk: Risk): ReviewFinding {
  return {
    id,
    file: `${id}.ts`,
    line: 1,
    severity: 'medium',
    title: id,
    description: 'd',
    risk,
    domain: 'bugs',
  } as ReviewFinding
}

function risk(
  impact: Risk['impact'],
  likelihood: Risk['likelihood'],
  confidence: Risk['confidence'],
  action: Risk['action'],
): Risk {
  return { impact, likelihood, confidence, action }
}

// Scores worked by hand from the score.ts weights (impact .4, likelihood .25,
// confidence .2, action .15), listed in shuffled input order.
const ranked: ReviewFinding[] = [
  card('k', risk('low', 'edge-case', 'low', 'should-fix')), // 2.6
  card('e', risk('critical', 'edge-case', 'medium', 'should-fix')), // 6.8
  card('a', risk('critical', 'likely', 'high', 'must-fix')), // 10.0
  card('j', risk('low', 'likely', 'low', 'must-fix')), // 4.8
  card('g', risk('medium', 'likely', 'high', 'must-fix')), // 7.6
  card('x', risk('critical', 'unknown', 'high', 'must-fix')), // 8.5
  card('i', risk('medium', 'possible', 'low', 'must-fix')), // 5.0
  card('c', risk('high', 'likely', 'high', 'must-fix')), // 8.8
  card('h', risk('medium', 'possible', 'high', 'must-fix')), // 6.6
  card('b', risk('critical', 'possible', 'high', 'must-fix')), // 9.0
  card('f', risk('high', 'unknown', 'high', 'must-fix')), // 7.3
  card('d', risk('high', 'possible', 'high', 'must-fix')), // 7.8
]

function recommendedIds(html: string): string[] {
  return [...html.matchAll(/data-recommended="true"[^>]*>\s*<[^>]*data-finding-id="([^"]+)"/g)].map(
    (m) => m[1] ?? '',
  )
}

function cardIds(html: string): string[] {
  return [...html.matchAll(/class="[^"]*issue-card[^"]*" data-finding-id="([^"]+)"/g)].map(
    (m) => m[1] ?? '',
  )
}
