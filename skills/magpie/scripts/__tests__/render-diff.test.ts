import { beforeAll, describe, expect, test } from 'bun:test'
import type { Highlighter } from 'shiki'
import { parseUnifiedDiffToHunks } from '../diff-utils.ts'
import { getHighlighter } from '../highlight.ts'
import { renderSplitDiff, renderUnifiedDiff } from '../render-diff.ts'
import type { ReviewFinding } from '../types.ts'

const DIFF = `--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
+added
 line3
`

const finding: ReviewFinding = {
  id: 'f-1',
  file: 'x.ts',
  line: 2,
  severity: 'high',
  title: 't',
  description: 'd',
  risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'should-fix' },
  domain: 'bugs',
}

let hl: Highlighter
beforeAll(async () => {
  hl = await getHighlighter()
})

describe('renderUnifiedDiff', () => {
  test('emits one row per diff line', () => {
    const html = renderUnifiedDiff({
      hunks: parseUnifiedDiffToHunks(DIFF),
      findings: [],
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
      file: 'x.ts',
    })
    expect((html.match(/class="diff-row/g) ?? []).length).toBe(5)
  })

  test('places annotations after the matching new-line', () => {
    const hunks = parseUnifiedDiffToHunks(DIFF)
    const html = renderUnifiedDiff({
      hunks,
      findings: [finding],
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
      file: 'x.ts',
    })
    const idx = html.indexOf('data-finding-id="f-1"')
    const before = html.lastIndexOf('class="diff-row', idx)
    const newRowSnippet = html.slice(before, idx)
    expect(newRowSnippet).toContain('class="diff-row added"')
  })

  test('emits a "no diff" placeholder when hunks is empty', () => {
    const html = renderUnifiedDiff({
      hunks: [],
      findings: [],
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
      file: 'x.ts',
    })
    expect(html).toContain('No changes')
  })

  test('renders posted findings with data-posted="true"', () => {
    const html = renderUnifiedDiff({
      hunks: parseUnifiedDiffToHunks(DIFF),
      findings: [finding],
      postStatus: { 'f-1': 'posted' },
      selectedIds: new Set(),
      highlighter: hl,
      file: 'x.ts',
    })
    expect(html).toContain('data-posted="true"')
  })
})

test('emits shiki-highlighted line content in unified mode', () => {
  const diff = `--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,3 @@
 const a = 1
-const b = 2
+const b = 3
`
  const html = renderUnifiedDiff({
    hunks: parseUnifiedDiffToHunks(diff),
    findings: [],
    postStatus: {},
    selectedIds: new Set(),
    highlighter: hl,
    file: 'x.ts',
  })
  expect(html).toContain('const')
  expect(html).toContain('<span style=')
  expect(html).toContain('class="gutter"')
  expect(html).toContain('class="sign"')
})

test('keeps multi-line tokens consistent across diff rows', () => {
  const diff = `--- a/x.ts
+++ b/x.ts
@@ -1,5 +1,5 @@
 const x = \`first
 second
-third\`
+THIRD\`
 const y = 1
`
  const html = renderUnifiedDiff({
    hunks: parseUnifiedDiffToHunks(diff),
    findings: [],
    postStatus: {},
    selectedIds: new Set(),
    highlighter: hl,
    file: 'x.ts',
  })
  const rowCount = (html.match(/class="diff-row /g) || []).length
  expect(rowCount).toBe(5)
})

describe('renderSplitDiff', () => {
  test('emits left/right cells per row', () => {
    const html = renderSplitDiff({
      hunks: parseUnifiedDiffToHunks(DIFF),
      findings: [],
      postStatus: {},
      selectedIds: new Set(),
      highlighter: hl,
      file: 'x.ts',
    })
    expect((html.match(/diff-row split/g) ?? []).length).toBeGreaterThan(0)
    expect(html).toContain('diff-cell')
  })
})
