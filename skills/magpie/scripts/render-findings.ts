import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseFindingDescription } from './finding-description.ts'
import { type ReviewFinding, SEVERITIES, type Severity } from './types.ts'

export type PostStatusEntry = 'posted' | { status: 'failed'; message: string }
export type PostStatusMap = Record<string, PostStatusEntry>

export type RenderFindingsInput = {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
  /** Stable id used as the localStorage selection key. Defaults to "unknown" for tests. */
  runId?: string
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const m: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return m[c] as string
  })
}

function badge(status: PostStatusEntry | undefined): string {
  if (!status) return ''
  if (status === 'posted') return '<span class="badge posted">posted</span>'
  return `<span class="badge failed">failed: ${escapeHtml(status.message)}</span>`
}

function severityBreakdown(findings: ReviewFinding[]): string {
  const counts: Record<Severity, number> = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity] += 1
  return SEVERITIES.filter((k) => counts[k] > 0)
    .map((k) => `<span class="num">${counts[k]}</span>&nbsp;${k}`)
    .join(' &nbsp;·&nbsp; ')
}

function countBy<T extends string>(
  findings: ReviewFinding[],
  pick: (f: ReviewFinding) => T,
): Map<T, number> {
  const m = new Map<T, number>()
  for (const f of findings) {
    const k = pick(f)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

function filterChip(
  group: 'sev' | 'domain',
  value: string,
  count: number,
  label: string,
  severity?: Severity,
): string {
  const sevAttr = severity ? ` data-severity="${severity}"` : ''
  return `<button type="button" class="filter-chip" data-filter-group="${group}" data-filter-value="${escapeHtml(value)}"${sevAttr} aria-pressed="false">
    <span class="filter-chip-label">${escapeHtml(label)}</span>
    <span class="filter-chip-count">${count}</span>
  </button>`
}

function filterBar(findings: ReviewFinding[]): string {
  const sevCounts = countBy(findings, (f) => f.severity)
  const domainCounts = countBy(findings, (f) => (f.domain as string) ?? 'unknown')
  const sevChips = SEVERITIES.filter((s) => (sevCounts.get(s) ?? 0) > 0)
    .map((s) => filterChip('sev', s, sevCounts.get(s) ?? 0, s, s))
    .join('')
  const domainChips = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => filterChip('domain', d, n, d))
    .join('')

  return `<section class="filter-bar" aria-label="filter and search">
    <div class="search-row">
      <label class="search-field">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          data-role="search"
          placeholder="search title, file, or description"
          aria-label="search findings"
          autocomplete="off"
          spellcheck="false"
        />
        <kbd class="search-hint">/</kbd>
      </label>
    </div>
    <div class="chip-row" data-role="filter-row" data-group="sev">
      <span class="chip-row-label">severity</span>
      ${sevChips}
    </div>
    <div class="chip-row" data-role="filter-row" data-group="domain">
      <span class="chip-row-label">domain</span>
      ${domainChips}
    </div>
    <div class="filter-state">
      <span data-role="filter-status">showing all <span class="num" data-role="visible-count">${findings.length}</span> of <span class="num">${findings.length}</span></span>
      <button type="button" class="link-btn" data-action="clear-filters" hidden>clear filters</button>
    </div>
  </section>`
}

function findingSections(description: string): string {
  const sections = parseFindingDescription(description)
  if (sections.length === 0) return ''
  return sections
    .map(
      (s) => `<section class="finding-section finding-section-${s.kind}">
    <h4 class="finding-section-label">${escapeHtml(s.label)}</h4>
    <p class="finding-section-body">${escapeHtml(s.body)}</p>
  </section>`,
    )
    .join('\n  ')
}

function findingRiskFooter(f: ReviewFinding): string {
  return `<footer class="finding-risk" aria-label="risk breakdown">
    <span>Impact <strong>${escapeHtml(f.risk.impact)}</strong></span>
    <span>Likelihood <strong>${escapeHtml(f.risk.likelihood)}</strong></span>
    <span>Confidence <strong>${escapeHtml(f.risk.confidence)}</strong></span>
    <span>Action <strong>${escapeHtml(f.risk.action)}</strong></span>
  </footer>`
}

function findingSuggestion(f: ReviewFinding): string {
  if (!f.suggestion) return ''
  return `<section class="finding-suggestion-wrap">
    <h4 class="finding-section-label">Suggested change</h4>
    <pre class="finding-suggestion">${escapeHtml(f.suggestion.body)}</pre>
  </section>`
}

function findingCard(f: ReviewFinding, status: PostStatusEntry | undefined): string {
  const checked = status === 'posted' ? 'checked disabled' : ''
  const anchor = f.line != null ? `${escapeHtml(f.file)}:${f.line}` : escapeHtml(f.file)
  const domain = (f.domain as string) ?? 'unknown'
  return `<article class="finding" id="finding-${escapeHtml(f.id)}" tabindex="-1"
  data-severity="${f.severity}"
  data-domain="${escapeHtml(domain)}"
  data-file="${escapeHtml(f.file)}"
  data-search-text="${escapeHtml(`${f.title} ${f.description} ${f.file}`.toLowerCase())}">
  <header class="finding-head">
    <input type="checkbox" data-finding-id="${escapeHtml(f.id)}" ${checked} aria-label="select finding ${escapeHtml(f.id)}" />
    <span class="sev-chip sev-${f.severity}">${f.severity}</span>
    <h3 class="finding-title">${escapeHtml(f.title)}</h3>
    ${badge(status)}
  </header>
  <div class="finding-anchor"><span class="path">${anchor}</span><span class="domain">${escapeHtml(domain)}</span></div>
  <div class="finding-body">
    ${findingSections(f.description)}
    ${findingSuggestion(f)}
  </div>
  ${findingRiskFooter(f)}
</article>`
}

const ARCHIVED_BANNER = `<div class="archived-banner" role="note"><strong>Archived view.</strong> The live server is gone; selections are read-only. Run <code>magpie serve &lt;run-dir&gt;</code> to bring it back.</div>`

const SHORTCUTS_HINT = `<aside class="kbd-hint" aria-label="keyboard shortcuts">
  <kbd>j</kbd>/<kbd>k</kbd> navigate
  <kbd>x</kbd> toggle
  <kbd>a</kbd> all visible
  <kbd>n</kbd> clear
  <kbd>/</kbd> search
  <kbd>Esc</kbd> reset
</aside>`

export function renderFindingsHtml(input: RenderFindingsInput): string {
  const { findings, postStatus } = input
  const runId = input.runId ?? 'unknown'

  if (findings.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie — no findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-run-id="${escapeHtml(runId)}">
${ARCHIVED_BANNER}
<main class="page">
  <section class="empty-state">
    <h1>No findings</h1>
    <p class="lede">All specialists returned cleanly and nothing survived the pipeline.</p>
  </section>
</main>
<script>HELPER_INLINE</script>
</body>
</html>`
  }

  const cards = findings.map((f) => findingCard(f, postStatus[f.id])).join('\n')
  const breakdown = severityBreakdown(findings)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie — findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-run-id="${escapeHtml(runId)}">
${ARCHIVED_BANNER}
<main class="page">
  <header class="page-header">
    <p class="eyebrow">magpie · findings</p>
    <h1>Review</h1>
    <p class="lede">Pick what's worth posting and click <strong>Post to PR</strong>. The server runs <code>gh</code> for each selected finding and updates the badges in place.</p>
  </header>

  <section class="findings-summary" aria-label="summary">
    <div><span class="count">${findings.length}</span> <span class="subtle">finding${findings.length === 1 ? '' : 's'}</span></div>
    <div class="breakdown">${breakdown}</div>
  </section>

  ${filterBar(findings)}

  <section class="findings-list" data-role="findings-list">
    ${cards}
    <div class="no-matches" data-role="no-matches" hidden>No findings match the current filters.</div>
  </section>

  ${SHORTCUTS_HINT}

  <div class="submit-bar">
    <span class="selected-count" data-role="selected-count"><span class="num">0</span> selected</span>
    <div class="bulk-actions">
      <button type="button" class="link-btn" data-action="select-visible">all visible</button>
      <button type="button" class="link-btn" data-action="select-priority">blockers + highs</button>
      <button type="button" class="link-btn" data-action="select-none">clear</button>
    </div>
    <div class="post-button-group">
      <button class="submit-btn" data-action="post" disabled>Post to PR</button>
      <div class="confirm-popup" data-role="confirm-bar" role="dialog" aria-label="confirm post" hidden>
        <p class="confirm-text" data-role="confirm-text"></p>
        <div class="confirm-actions">
          <button type="button" class="link-btn" data-action="cancel-post">Cancel</button>
          <button type="button" class="submit-btn confirm-btn" data-action="confirm-post">Confirm post</button>
        </div>
      </div>
    </div>
  </div>
  <p class="submit-status" data-role="submit-status" role="status" aria-live="polite" hidden></p>
</main>
<script>HELPER_INLINE</script>
</body>
</html>`
}

export async function renderFindingsToDisk(
  input: RenderFindingsInput,
  outPath: string,
): Promise<void> {
  const stylesPath = new URL('../templates/styles.css', import.meta.url).pathname
  const helperPath = new URL('./helper.js', import.meta.url).pathname
  const css = await readFile(stylesPath, 'utf8')
  const helper = await readFile(helperPath, 'utf8')
  // Derive runId from the screen output path when caller didn't supply one.
  // out path is .../<runId>/screen/findings*.html — three segments up = runId.
  const derived = basename(outPath.replace(/\/screen\/.+$/, ''))
  const html = renderFindingsHtml({ ...input, runId: input.runId ?? derived })
    .replace(
      'data:text/css;base64,STYLES_INLINE',
      `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
    )
    .replace('HELPER_INLINE', helper)
  await Bun.write(outPath, html)
}
