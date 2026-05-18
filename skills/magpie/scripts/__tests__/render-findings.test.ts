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

test('renders one finding with severity chip and post button', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'null deref', severity: 'high' })],
    postStatus: {},
  })
  expect(html).toContain('null deref')
  expect(html).toContain('sev-high')
  expect(html).toContain('data-finding-id="a"')
  expect(html).toContain('data-action="post"')
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

test('renders suggestion block when present, with a "Suggested change" caption', () => {
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
  expect(html).toContain('Suggested change')
  expect(html).toContain('class="finding-suggestion-wrap"')
})

test('parses labelled paragraphs into section headers', () => {
  const html = renderFindingsHtml({
    findings: [
      f({
        id: 'a',
        title: 'unsafe userId',
        description:
          'Observation: trusts client-supplied userId.\n\nWhy it matters: cross-tenant exposure.\n\nSuggested direction: read from auth context.',
      }),
    ],
    postStatus: {},
  })
  expect(html).toContain('class="finding-section finding-section-observation"')
  expect(html).toContain('class="finding-section finding-section-impact"')
  expect(html).toContain('class="finding-section finding-section-suggestion"')
  expect(html).toContain('>Observation</h4>')
  expect(html).toContain('>Why it matters</h4>')
  expect(html).toContain('>Suggested direction</h4>')
  expect(html).toContain('>trusts client-supplied userId.</p>')
})

test('renders the risk footer with Impact/Likelihood/Confidence/Action', () => {
  const html = renderFindingsHtml({
    findings: [
      f({
        id: 'a',
        title: 'x',
        risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'should-fix' },
      }),
    ],
    postStatus: {},
  })
  // The row is a <dl> of risk-dim cells so screen readers can read it as
  // term/definition pairs. Each cell carries the dimension as a <dt> and
  // the value as a <strong>; action also picks up a leading glyph that
  // signals must-fix vs should-fix vs consider at a glance.
  expect(html).toContain('class="finding-risk"')
  expect(html).toMatch(/<dt>Impact<\/dt>\s*<strong>high<\/strong>/)
  expect(html).toMatch(/<dt>Likelihood<\/dt>\s*<strong>likely<\/strong>/)
  expect(html).toMatch(/<dt>Confidence<\/dt>\s*<strong>high<\/strong>/)
  expect(html).toMatch(/<dt>Action<\/dt>\s*<strong>[^<]*should-fix<\/strong>/)
})

test('falls back to a single observation when description has no labels', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x', description: 'Just one sentence.' })],
    postStatus: {},
  })
  expect(html).toContain('finding-section-observation')
  expect(html).toContain('>Just one sentence.</p>')
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

test('post button starts disabled (enabled by helper.js after first select)', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(/<button[^>]*data-action="post"[^>]*disabled/)
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

test('post button label is "Post to PR" and triggers the confirm flow', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(/<button[^>]*data-action="post"[^>]*>Post to PR<\/button>/)
})

test('renders the inline confirm popup (hidden until user clicks Post to PR)', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  // It is anchored to the Post to PR button, not a separate row.
  expect(html).toContain('class="post-button-group"')
  expect(html).toMatch(/<div\s+class="confirm-popup"\s+data-role="confirm-bar"[^>]*hidden[^>]*>/)
  expect(html).toContain('data-action="cancel-post"')
  expect(html).toContain('data-action="confirm-post"')
})

test('lede explains the server-side post flow (not the terminal reply)', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).toMatch(/Post to PR/)
  expect(html).toMatch(/<code>gh<\/code>/)
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

test('renders PR meta in the page header when pr is provided', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
    pr: { number: 2048, branch: 'feature-x', headSha: '0123456789abdeadbeef' },
  })
  expect(html).toContain('class="pr-meta"')
  expect(html).toContain('PR #2048')
  expect(html).toContain('feature-x')
  // sha is truncated to 12 chars to match the progress page
  expect(html).toContain('0123456789ab')
  expect(html).not.toContain('deadbeef')
})

test('omits the pr-meta block when no pr is provided', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x' })],
    postStatus: {},
  })
  expect(html).not.toContain('class="pr-meta"')
})

test('finding titles render as h2 so the heading outline does not skip from h1', () => {
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'race in handler' })],
    postStatus: {},
  })
  expect(html).toMatch(/<h2[^>]*class="finding-title"[^>]*>race in handler<\/h2>/)
  // And the findings list has a visually-hidden h2 to bridge the outline.
  expect(html).toContain('class="findings-list-heading"')
})

test('falls back to the raw description when no labelled paragraphs are detected and description is empty-ish', () => {
  // parseFindingDescription returns [] only when the description is empty
  // after normalization. The renderer wraps that in a fallback Observation
  // section so the card never shows up with no prose between anchor and risk.
  const html = renderFindingsHtml({
    findings: [f({ id: 'a', title: 'x', description: '' })],
    postStatus: {},
  })
  expect(html).toContain('finding-section-observation')
})
