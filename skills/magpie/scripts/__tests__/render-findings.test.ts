import { beforeAll, expect, test } from 'bun:test'
import type { Highlighter } from 'shiki'
import { getHighlighter } from '../highlight.ts'
import { renderFindingsHtml } from '../render-findings.ts'
import type { PrBrief, ReviewFinding } from '../types.ts'

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

const SAMPLE_FINDINGS: ReviewFinding[] = [
  f({ id: 'a', title: 'null deref', severity: 'high', file: 'src/a.ts', line: 2 }),
  f({
    id: 'b',
    title: 'magic number',
    severity: 'low',
    file: 'src/a.ts',
    line: 4,
    risk: { impact: 'low', likelihood: 'unknown', confidence: 'medium', action: 'optional' },
  }),
]

const SAMPLE_DIFF = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
+added
 line3
`

let hl: Highlighter
beforeAll(async () => {
  hl = await getHighlighter()
})

test('empty findings renders the page shell with an empty-state message', () => {
  const html = renderFindingsHtml({ findings: [], postStatus: {}, highlighter: hl })
  expect(html).toContain('class="pr-header"')
  expect(html).toContain('No findings')
})

test('emits the two-tab segmented control with Files and All Issues buttons', () => {
  const html = renderFindingsHtml({ findings: SAMPLE_FINDINGS, postStatus: {}, highlighter: hl })
  expect(html).toContain('data-action="set-view"')
  expect(html).toContain('data-view="files"')
  expect(html).toContain('data-view="all-issues"')
})

test('sets body data attributes for default view, diff-mode, and suggestions visibility', () => {
  const html = renderFindingsHtml({ findings: SAMPLE_FINDINGS, postStatus: {}, highlighter: hl })
  expect(html).toContain('data-page="findings"')
  expect(html).toContain('data-view="files"')
  expect(html).toContain('data-diff-mode="unified"')
  expect(html).toContain('data-show-suggestions="false"')
})

test('renders one file pane per PrFileEntry, hidden by default', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    files: [
      { path: 'src/a.ts', additions: 3, deletions: 1 },
      { path: 'src/b.ts', additions: 1, deletions: 0 },
    ],
    diff: SAMPLE_DIFF,
    highlighter: hl,
  })
  expect(html).toContain('data-file-pane="src/a.ts"')
  expect(html).toContain('data-file-pane="src/b.ts"')
  expect(html).toMatch(/data-file-pane="src\/a\.ts"[^>]*hidden/)
})

test('renders an Overview pane mapped to data-file-pane=""', () => {
  const html = renderFindingsHtml({ findings: SAMPLE_FINDINGS, postStatus: {}, highlighter: hl })
  expect(html).toContain('data-file-pane=""')
})

test('renders a per-file toolbar with breadcrumb, deltas, finding-nav and diff-mode toggle', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
    diff: SAMPLE_DIFF,
    highlighter: hl,
  })
  expect(html).toContain('+3')
  expect(html).toContain('-1')
  expect(html).toContain('data-action="prev-finding"')
  expect(html).toContain('data-action="next-finding"')
  expect(html).toContain('data-action="set-diff-mode"')
  expect(html).toContain('data-mode="unified"')
  expect(html).toContain('data-mode="split"')
})

test('renders both unified and split diff containers per file', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
    diff: SAMPLE_DIFF,
    highlighter: hl,
  })
  expect(html).toContain('data-diff-mode="unified"')
  expect(html).toContain('data-diff-mode="split"')
})

test('places an inline annotation at the affected diff line', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    files: [{ path: 'src/a.ts', additions: 3, deletions: 1 }],
    diff: SAMPLE_DIFF,
    highlighter: hl,
  })
  expect(html).toContain('data-finding-id="a"')
  expect(html).toContain('class="annot')
})

test('mounts the All Issues pane', () => {
  const html = renderFindingsHtml({ findings: SAMPLE_FINDINGS, postStatus: {}, highlighter: hl })
  expect(html).toContain('data-role="issues-list"')
})

test('mounts the action bar at the page bottom', () => {
  const html = renderFindingsHtml({ findings: SAMPLE_FINDINGS, postStatus: {}, highlighter: hl })
  expect(html).toContain('data-role="action-bar"')
  expect(html).toContain('Post Recommended')
})

test('marks posted findings with data-posted="true"', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: { a: 'posted' },
    highlighter: hl,
  })
  expect(html).toContain('data-posted="true"')
})

test('renders the suggestion code block in the annotation', () => {
  const html = renderFindingsHtml({
    findings: [
      f({
        id: 'x',
        title: 'with patch',
        suggestion: { body: 'if (!y) return', startLine: 10, endLine: 11 },
      }),
    ],
    postStatus: {},
    highlighter: hl,
  })
  // Shiki tokenizes identifiers into separate spans; check for a known token
  expect(html).toContain('return')
  expect(html).toContain('Suggested change')
})

test('parses labelled paragraphs into section headers', () => {
  const html = renderFindingsHtml({
    findings: [
      f({
        id: 'a',
        title: 'unsafe userId',
        description:
          'Observation: client picks userId.\n\nWhy it matters: leak risk.\n\nSuggested direction: drop arg.',
      }),
    ],
    postStatus: {},
    highlighter: hl,
  })
  expect(html).toContain('Observation')
  expect(html).toContain('Why it matters')
  expect(html).toContain('Suggested direction')
})

test('renders pr meta when supplied', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    pr: { number: 42, branch: 'feat/x', headSha: 'deadbeefdeadbeef0000111122223333' },
    highlighter: hl,
  })
  expect(html).toContain('PR #42')
  expect(html).toContain('feat/x')
  expect(html).toContain('deadbeefdead')
})

const SAMPLE_BRIEF: PrBrief = {
  purpose:
    'Adds bounded retries to the upload path so transient S3 failures stop surfacing to users.',
  changes: ['Wraps the S3 put in a bounded retry', 'Adds a jittered backoff helper'],
  subsystems: [
    { name: 'upload', role: 'owns the client-facing put path' },
    { name: 'storage-client', role: 'wraps the S3 SDK' },
  ],
  watchItems: ['The PR body claims idempotency but no request key is sent'],
  unclear: ['Whether the retry budget interacts with the outer request timeout'],
}

test('brief header renders purpose, changes, and subsystem chips', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    highlighter: hl,
    brief: SAMPLE_BRIEF,
  })
  expect(html).toContain('class="pr-brief"')
  expect(html).toContain('Adds bounded retries to the upload path')
  expect(html).toContain('Wraps the S3 put in a bounded retry')
  expect(html).toContain('class="brief-chip"')
  expect(html).toContain('>upload<')
  expect(html).toContain('>storage-client<')
})

test('brief header omits watchItems and unclear, which are prompt-only', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    highlighter: hl,
    brief: SAMPLE_BRIEF,
  })
  expect(html).not.toContain('no request key is sent')
  expect(html).not.toContain('outer request timeout')
})

test('no brief means no brief header at all', () => {
  const html = renderFindingsHtml({ findings: SAMPLE_FINDINGS, postStatus: {}, highlighter: hl })
  expect(html).not.toContain('class="pr-brief"')
})

test('an empty subsystem list renders no chip row', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    highlighter: hl,
    brief: { ...SAMPLE_BRIEF, subsystems: [] },
  })
  expect(html).toContain('class="pr-brief"')
  expect(html).not.toContain('brief-subsystems')
})

test('brief header renders on the empty-findings page too', () => {
  const html = renderFindingsHtml({
    findings: [],
    postStatus: {},
    highlighter: hl,
    brief: SAMPLE_BRIEF,
  })
  expect(html).toContain('No findings')
  expect(html).toContain('class="pr-brief"')
})

test('linked issues render as links when supplied', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    highlighter: hl,
    brief: SAMPLE_BRIEF,
    issues: [
      { number: 42, title: 'Uploads fail intermittently', url: 'https://example.test/issues/42' },
    ],
  })
  expect(html).toContain('https://example.test/issues/42')
  expect(html).toContain('#42')
})

test('brief content is HTML-escaped', () => {
  const html = renderFindingsHtml({
    findings: SAMPLE_FINDINGS,
    postStatus: {},
    highlighter: hl,
    brief: { ...SAMPLE_BRIEF, purpose: 'Fixes <script>alert(1)</script> handling' },
  })
  expect(html).not.toContain('<script>alert(1)</script>')
  expect(html).toContain('&lt;script&gt;')
})
