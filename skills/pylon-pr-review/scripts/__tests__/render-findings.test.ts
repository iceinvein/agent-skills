import { expect, test } from 'bun:test'
import { renderFindingsHtml } from '../render-findings.ts'
import type { ReviewFinding } from '../types.ts'

function f(p: Partial<ReviewFinding> & { id: string; title: string }): ReviewFinding {
  return {
    id: p.id,
    file: p.file ?? 'src/a.ts',
    line: p.line ?? 1,
    severity: p.severity ?? 'medium',
    risk: p.risk ?? {
      impact: 'medium',
      likelihood: 'possible',
      confidence: 'medium',
      action: 'should-fix',
    },
    title: p.title,
    description: p.description ?? '',
    suggestion: p.suggestion,
    domain: p.domain ?? 'bugs',
    mergedFrom: p.mergedFrom,
  }
}

test('empty findings renders an explicit empty state', () => {
  const html = renderFindingsHtml({ findings: [], postStatus: {} })
  expect(html).toContain('No findings')
})

test('renders one finding with severity chip and submit button', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'null deref', severity: 'high' })],
    postStatus: {},
  })
  expect(html).toContain('null deref')
  expect(html).toContain('sev-high')
  expect(html).toContain('data-finding-id="a"')
  expect(html).toContain('data-action="submit"')
})

test('shows posted badge when present in postStatus', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: { a: 'posted' },
  })
  expect(html).toContain('class="badge posted"')
})

test('shows failed badge with message', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: { a: { status: 'failed', message: 'rate limit' } },
  })
  expect(html).toContain('class="badge failed"')
  expect(html).toContain('rate limit')
})

test('renders suggestion block when present', () => {
  const html = renderFindingsHtml({
    findings: [
      f({
        id: 'a',
        title: 'x',
        suggestion: { body: 'if (!y) return', startLine: 10, endLine: 11 },
      }),
    ],
    postStatus: {},
  })
  expect(html).toContain('if (!y) return')
})
