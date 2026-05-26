import { beforeAll, describe, expect, test } from 'bun:test'
import type { Highlighter } from 'shiki'
import { getHighlighter } from '../highlight.ts'
import { renderAnnotation } from '../render-annotation.ts'
import type { ReviewFinding } from '../types.ts'

const finding: ReviewFinding = {
  id: 'f-1',
  file: 'src/a.ts',
  line: 42,
  severity: 'high',
  title: 'Race in cache.refresh()',
  description: 'Observation: two refreshes overlap.\n\nWhy it matters: stale data.',
  risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'should-fix' },
  domain: 'bugs',
  suggestion: { body: 'await lock.acquire()', startLine: 42, endLine: 42 },
}

let hl: Highlighter
beforeAll(async () => {
  hl = await getHighlighter()
})

describe('renderAnnotation', () => {
  test('emits a div with data-finding-id and severity class', () => {
    const html = renderAnnotation(finding, {
      checked: false,
      posted: false,
      asCard: false,
      highlighter: hl,
    })
    expect(html).toContain(`data-finding-id="f-1"`)
    expect(html).toContain('annot')
    expect(html).toContain('data-severity="high"')
  })

  test('renders severity label, domain chip, and title', () => {
    const html = renderAnnotation(finding, {
      checked: false,
      posted: false,
      asCard: false,
      highlighter: hl,
    })
    expect(html).toContain('HIGH')
    expect(html).toContain('Bugs')
    expect(html).toContain('Race in cache.refresh()')
  })

  test('renders parsed description sections', () => {
    const html = renderAnnotation(finding, {
      checked: false,
      posted: false,
      asCard: false,
      highlighter: hl,
    })
    expect(html).toContain('Observation')
    expect(html).toContain('two refreshes overlap')
    expect(html).toContain('Why it matters')
  })

  test('renders the suggestion code block when present', () => {
    const html = renderAnnotation(finding, {
      checked: false,
      posted: false,
      asCard: false,
      highlighter: hl,
    })
    expect(html).toContain('<pre')
    // Shiki tokenizes identifiers into separate spans; check for a known token
    expect(html).toContain('acquire')
  })

  test('renders risk dimensions footer', () => {
    const html = renderAnnotation(finding, {
      checked: false,
      posted: false,
      asCard: false,
      highlighter: hl,
    })
    expect(html).toContain('Impact: <span class="tag">high</span>')
    expect(html).toContain('Likelihood: <span class="tag">likely</span>')
  })

  test('marks posted findings and disables checkbox', () => {
    const html = renderAnnotation(finding, {
      checked: true,
      posted: true,
      asCard: false,
      highlighter: hl,
    })
    expect(html).toContain('data-posted="true"')
    expect(html).toContain('checked disabled')
  })

  test('marks suggestion-only findings with data-suggestion="true"', () => {
    const suggestion: ReviewFinding = { ...finding, risk: { ...finding.risk, action: 'optional' } }
    const html = renderAnnotation(suggestion, {
      checked: false,
      posted: false,
      asCard: false,
      highlighter: hl,
    })
    expect(html).toContain('data-suggestion="true"')
  })

  test('asCard=true wraps in .issue-card', () => {
    const html = renderAnnotation(finding, {
      checked: false,
      posted: false,
      asCard: true,
      highlighter: hl,
    })
    expect(html).toContain('class="issue-card')
  })

  test('renders suggestion body with shiki highlighting', () => {
    const f: ReviewFinding = {
      id: 'f-1',
      file: 'scheduler.ts',
      line: 12,
      severity: 'high',
      title: 'unhandled rejection',
      description: 'Observation: scheduler drops errors.',
      risk: { impact: 'high', likelihood: 'possible', confidence: 'high', action: 'should-fix' },
      domain: 'bugs',
      suggestion: {
        body: 'const x: number = 1\nconsole.log(x)',
        startLine: 1,
        endLine: 2,
      },
    }
    const html = renderAnnotation(f, {
      highlighter: hl,
      checked: false,
      posted: false,
      asCard: true,
    })
    expect(html).toContain('class="suggestion shiki')
    expect(html).toContain('<span class="line">')
    // Shiki tokenizes identifiers separately, so check for the token text
    expect(html).toContain('console')
  })
})
