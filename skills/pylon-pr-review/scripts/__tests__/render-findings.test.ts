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

test('includes the archived-mode banner element so file:// view can self-degrade', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toContain('archived-banner')
  expect(html).toContain('Archived view')
})

test('renders a severity-breakdown summary line', () => {
  const html = renderFindingsHtml({
    findings: [
      f({ id: 'a', title: 't1', severity: 'high' }),
      f({ id: 'b', title: 't2', severity: 'high' }),
      f({ id: 'c', title: 't3', severity: 'low' }),
    ],
    postStatus: {},
  })
  expect(html).toContain('findings-summary')
  expect(html).toContain('2</span>&nbsp;high')
  expect(html).toContain('1</span>&nbsp;low')
})

test('submit button starts disabled (enabled by helper.js after first select)', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(/<button[^>]*data-action="submit"[^>]*disabled/)
})

test('renders a filter bar with severity and domain chips when findings exist', () => {
  const html = renderFindingsHtml({
    findings: [
      f({ id: 'a', title: 't1', severity: 'high', domain: 'bugs' }),
      f({ id: 'b', title: 't2', severity: 'high', domain: 'security' }),
      f({ id: 'c', title: 't3', severity: 'low', domain: 'bugs' }),
    ],
    postStatus: {},
  })
  // The bar
  expect(html).toContain('class="filter-bar"')
  // Search input
  expect(html).toMatch(/<input[^>]+type="search"[^>]+data-role="search"/)
  // Severity chips with counts
  expect(html).toMatch(/data-filter-group="sev"[^>]+data-filter-value="high"/)
  expect(html).toMatch(/data-filter-group="sev"[^>]+data-filter-value="low"/)
  // Domain chips
  expect(html).toMatch(/data-filter-group="domain"[^>]+data-filter-value="bugs"/)
  expect(html).toMatch(/data-filter-group="domain"[^>]+data-filter-value="security"/)
  // Each chip carries its current count
  expect(html).toMatch(/<span class="filter-chip-count">2<\/span>/) // high count
  expect(html).toMatch(/<span class="filter-chip-count">1<\/span>/) // low count
})

test('exposes bulk select actions and a keyboard-shortcut hint', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(/data-action="select-visible"/)
  expect(html).toMatch(/data-action="select-priority"/)
  expect(html).toMatch(/data-action="select-none"/)
  expect(html).toContain('class="kbd-hint"')
  expect(html).toContain('<kbd>j</kbd>')
  expect(html).toContain('<kbd>/</kbd>')
})

test('threads runId into a data-run-id attribute on body', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
    runId: 'pr-42-1700000000',
  })
  expect(html).toMatch(/<body[^>]+data-run-id="pr-42-1700000000"/)
})

test('each finding card carries severity/domain/file/search-text data attrs for client-side filtering', () => {
  const html = renderFindingsHtml({
    findings: [
      f({
        id: 'a',
        title: 'race in handler',
        severity: 'high',
        domain: 'bugs',
        file: 'src/main.ts',
        description: 'fire-and-forget promise',
      }),
    ],
    postStatus: {},
  })
  expect(html).toMatch(/data-severity="high"/)
  expect(html).toMatch(/data-domain="bugs"/)
  expect(html).toMatch(/data-file="src\/main\.ts"/)
  expect(html).toMatch(/data-search-text="[^"]*race in handler[^"]*fire-and-forget promise/)
})

test('submit button label conveys queue-then-confirm semantics, not direct posting', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  // The button doesn't post directly; it queues an event for the terminal agent.
  expect(html).toMatch(/<button[^>]*data-action="submit"[^>]*>Queue for posting<\/button>/)
})

test('lede instructs the user to reply `post` in the terminal', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(/<code>post<\/code> in the terminal/)
})

test('renders a polite submit-status region for transient queue/error feedback', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(
    /<p\s+class="submit-status"\s+data-role="submit-status"\s+role="status"\s+aria-live="polite"\s+hidden>/,
  )
})

test('renders a no-matches placeholder for the client-side filter to reveal', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(/data-role="no-matches"[^>]+hidden/)
})
