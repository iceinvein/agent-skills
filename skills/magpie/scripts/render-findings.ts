import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseFindingDescription } from './finding-description.ts'
import { type ReviewFinding, SEVERITIES, type Severity } from './types.ts'

export type PostStatusEntry = 'posted' | { status: 'failed'; message: string }
export type PostStatusMap = Record<string, PostStatusEntry>

export type FindingsPrMeta = {
  number: number
  branch: string
  headSha: string
}

export type RenderFindingsInput = {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
  /** Stable id used as the localStorage selection key. Defaults to "unknown" for tests. */
  runId?: string
  /** Optional PR identity. When present, the rail shows PR #N, branch, sha. */
  pr?: FindingsPrMeta
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

const SEVERITY_GROUP_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const BRAND_MARK_SVG = `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none">
  <path d="M3 17.5 C 6.5 7.5, 13 6, 17.5 11 L 21 16.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11.5 12.5 L 21 16.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <circle class="magpie-eye" cx="6.5" cy="13.5" r="1.1"/>
</svg>`

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

  return `<section class="rail-section" aria-label="filter and search">
    <h3 class="rail-section-title">Filter</h3>
    <div class="filter-bar">
      <div class="search-row">
        <label class="search-field">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input
            type="search"
            data-role="search"
            placeholder="search title, file, description"
            aria-label="search findings"
            autocomplete="off"
            spellcheck="false"
          />
          <kbd class="search-hint">/</kbd>
        </label>
      </div>
      <div class="chip-row" data-role="filter-row" data-group="sev">
        ${sevChips}
      </div>
      <div class="chip-row" data-role="filter-row" data-group="domain">
        ${domainChips}
      </div>
      <div class="filter-state">
        <span data-role="filter-status">showing <span class="num" data-role="visible-count">${findings.length}</span> of <span class="num">${findings.length}</span></span>
        <button type="button" class="link-btn" data-action="clear-filters" hidden>clear filters</button>
      </div>
    </div>
  </section>`
}

function findingSections(description: string): string {
  const sections = parseFindingDescription(description)
  if (sections.length === 0) {
    return `<section class="finding-section finding-section-observation">
    <h4 class="finding-section-label">Observation</h4>
    <p class="finding-section-body">${escapeHtml(description.trim())}</p>
  </section>`
  }
  return sections
    .map(
      (s) => `<section class="finding-section finding-section-${s.kind}">
    <h4 class="finding-section-label">${escapeHtml(s.label)}</h4>
    <p class="finding-section-body">${escapeHtml(s.body)}</p>
  </section>`,
    )
    .join('\n  ')
}

const RISK_ACTION_GLYPH: Record<string, string> = {
  'must-fix': '✦',
  'should-fix': '◆',
  consider: '◇',
  optional: '·',
}

function findingRiskFooter(f: ReviewFinding): string {
  const actionGlyph = RISK_ACTION_GLYPH[f.risk.action] ?? '·'
  return `<dl class="finding-risk" aria-label="risk breakdown">
    <div class="risk-dim"><dt>Impact</dt> <strong>${escapeHtml(f.risk.impact)}</strong></div>
    <div class="risk-dim"><dt>Likelihood</dt> <strong>${escapeHtml(f.risk.likelihood)}</strong></div>
    <div class="risk-dim"><dt>Confidence</dt> <strong>${escapeHtml(f.risk.confidence)}</strong></div>
    <div class="risk-dim" title="action: ${escapeHtml(f.risk.action)}"><dt>Action</dt> <strong>${actionGlyph} ${escapeHtml(f.risk.action)}</strong></div>
  </dl>`
}

function findingSuggestion(f: ReviewFinding): string {
  if (!f.suggestion) return ''
  return `<section class="finding-suggestion-wrap">
    <h4 class="finding-section-label">Suggested change</h4>
    <pre class="finding-suggestion">${escapeHtml(f.suggestion.body)}</pre>
  </section>`
}

function findingCard(f: ReviewFinding, status: PostStatusEntry | undefined, seq: number): string {
  const checked = status === 'posted' ? 'checked disabled' : ''
  const anchor = f.line != null ? `${escapeHtml(f.file)}:${f.line}` : escapeHtml(f.file)
  const domain = (f.domain as string) ?? 'unknown'
  const seqStr = String(seq).padStart(2, '0')
  return `<article class="finding" id="finding-${escapeHtml(f.id)}" tabindex="-1"
  data-severity="${f.severity}"
  data-domain="${escapeHtml(domain)}"
  data-file="${escapeHtml(f.file)}"
  data-search-text="${escapeHtml(`${f.title} ${f.description} ${f.file}`.toLowerCase())}">
  <span class="finding-seq" aria-hidden="true">${seqStr}</span>
  <header class="finding-head">
    <input type="checkbox" data-finding-id="${escapeHtml(f.id)}" ${checked} aria-label="select finding ${escapeHtml(f.id)}" />
    <span class="sev-chip sev-${f.severity}">${f.severity}</span>
    <h2 class="finding-title">${escapeHtml(f.title)}</h2>
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

/** Group findings by severity in the canonical severity order. Findings
 * inside a group keep their original incoming order (which is the order
 * the pipeline produced after the critic pass). */
function groupBySeverity(
  findings: ReviewFinding[],
): Array<{ sev: Severity; items: ReviewFinding[] }> {
  const buckets: Record<Severity, ReviewFinding[]> = {
    blocker: [],
    high: [],
    medium: [],
    low: [],
  }
  for (const f of findings) buckets[f.severity].push(f)
  return SEVERITIES.filter((s) => buckets[s].length > 0).map((sev) => ({
    sev,
    items: buckets[sev],
  }))
}

function findingsListMarkup(findings: ReviewFinding[], postStatus: PostStatusMap): string {
  const groups = groupBySeverity(findings)
  let seq = 0
  const sections = groups
    .map((g) => {
      const cards = g.items
        .map((f) => {
          seq += 1
          return findingCard(f, postStatus[f.id], seq)
        })
        .join('\n')
      const groupLabel = SEVERITY_GROUP_LABEL[g.sev]
      const count = g.items.length
      return `<section class="finding-group" data-group="${g.sev}">
    <header class="finding-group-head">
      <h2 class="finding-group-title">${groupLabel}</h2>
      <span class="finding-group-count"><strong>${count}</strong> finding${count === 1 ? '' : 's'}</span>
    </header>
    ${cards}
  </section>`
    })
    .join('\n  ')
  return sections
}

function railCounts(findings: ReviewFinding[]): string {
  const counts: Record<Severity, number> = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity] += 1
  const rows = SEVERITIES.filter((s) => counts[s] > 0)
    .map(
      (s) =>
        `<span class="count-row"><span class="count-label"><i class="sev-dot sev-${s}" aria-hidden="true"></i>${s}</span><span class="count-num">${counts[s]}</span></span>`,
    )
    .join('')
  return `<section class="rail-section rail-counts" aria-label="severity counts">
    <h3 class="rail-section-title">Findings</h3>
    <div class="rail-counts-total"><span class="num">${findings.length}</span><span class="label">total</span></div>
    <div class="rail-counts-breakdown">${rows}</div>
  </section>`
}

function railPrMeta(pr: FindingsPrMeta | undefined): string {
  if (!pr) return ''
  return `<section class="rail-section" aria-label="pull request">
    <div class="pr-meta">
      <span class="pr-number">PR #${pr.number}</span>
      <span class="pr-branch">${escapeHtml(pr.branch)}</span>
      <code>${escapeHtml(pr.headSha.slice(0, 12))}</code>
    </div>
  </section>`
}

function railProvenance(): string {
  // The findings page is the report stage's output; the full pipeline lives
  // on the progress page. Here we just show a one-line provenance footer
  // so the reviewer remembers where the cards came from.
  return `<section class="rail-section rail-provenance" aria-label="provenance">
    <h3 class="rail-section-title">Provenance</h3>
    <p class="provenance-line">Pipeline complete: five specialists, dedupe, critic, peer review.</p>
  </section>`
}

function railSubmit(): string {
  return `<section class="rail-section rail-submit submit-bar" aria-label="post controls">
    <h3 class="rail-section-title">Selection</h3>
    <span class="selected-count" data-role="selected-count"><span class="num">0</span> picked</span>
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
    <p class="submit-status" data-role="submit-status" role="status" aria-live="polite" hidden></p>
  </section>`
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

function brandBlock(): string {
  return `<div class="brand">${BRAND_MARK_SVG}<span class="brand-text">magpie</span></div>`
}

function pageHeader(findings: ReviewFinding[]): string {
  const total = findings.length
  const counts: Record<Severity, number> = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity] += 1
  const titleNoun = total === 1 ? 'finding' : 'findings'
  // Lead with the count as the headline, then a deck that quantifies the
  // most important groups so the reviewer knows the shape of the page
  // before scrolling.
  const blockerCount = counts.blocker
  const highCount = counts.high
  let lede: string
  if (blockerCount > 0 && highCount > 0) {
    lede = `<strong>${blockerCount}</strong> blocker${blockerCount === 1 ? '' : 's'} and <strong>${highCount}</strong> high${highCount === 1 ? '' : 's'} likely worth posting; the rest are judgment calls. Pick what you want and click <strong>Post to PR</strong>.`
  } else if (blockerCount > 0) {
    lede = `<strong>${blockerCount}</strong> blocker${blockerCount === 1 ? '' : 's'} likely worth posting; the rest are judgment calls. Pick what you want and click <strong>Post to PR</strong>.`
  } else if (highCount > 0) {
    lede = `<strong>${highCount}</strong> high-signal finding${highCount === 1 ? '' : 's'} surfaced. Pick what's worth raising and click <strong>Post to PR</strong>; the server runs <code>gh</code> for each.`
  } else {
    lede = `Pick what's worth raising and click <strong>Post to PR</strong>; the server runs <code>gh</code> for each and updates the badges in place.`
  }
  return `<header class="page-header">
    ${brandBlock()}
    <p class="eyebrow">curated review</p>
    <h1 class="page-title"><span class="accent">${total}</span> ${titleNoun} worth your attention.</h1>
    <p class="lede">${lede}</p>
  </header>`
}

export function renderFindingsHtml(input: RenderFindingsInput): string {
  const { findings, postStatus, pr } = input
  const runId = input.runId ?? 'unknown'

  if (findings.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie · no findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-run-id="${escapeHtml(runId)}" data-page="findings">
${ARCHIVED_BANNER}
<div class="curator-shell">
  <main class="page-main">
    ${brandBlock()}
    <section class="empty-state">
      <h1>No findings</h1>
      <p class="lede">All specialists returned cleanly and nothing survived the pipeline.</p>
    </section>
  </main>
</div>
<script>HELPER_INLINE</script>
</body>
</html>`
  }

  const list = findingsListMarkup(findings, postStatus)
  const breakdown = severityBreakdown(findings)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie · findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-run-id="${escapeHtml(runId)}" data-page="findings">
${ARCHIVED_BANNER}
<div class="curator-shell">
  <main class="page-main">
    ${pageHeader(findings)}

    <section class="findings-summary" aria-label="summary">
      <div><span class="count">${findings.length}</span> <span class="subtle">finding${findings.length === 1 ? '' : 's'}</span></div>
      <div class="breakdown">${breakdown}</div>
    </section>

    <section class="findings-list" data-role="findings-list" aria-labelledby="findings-list-heading">
      <h2 id="findings-list-heading" class="findings-list-heading">Findings</h2>
      ${list}
      <div class="no-matches" data-role="no-matches" hidden>No findings match the current filters.</div>
    </section>

    ${SHORTCUTS_HINT}
  </main>

  <aside class="page-rail" aria-label="run details">
    ${railPrMeta(pr)}
    ${railSubmit()}
    ${railCounts(findings)}
    ${filterBar(findings)}
    ${railProvenance()}
  </aside>
</div>
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
  const derived = basename(outPath.replace(/\/screen\/.+$/, ''))
  const html = renderFindingsHtml({ ...input, runId: input.runId ?? derived })
    .replace(
      'data:text/css;base64,STYLES_INLINE',
      `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
    )
    .replace('HELPER_INLINE', helper)
  await Bun.write(outPath, html)
}
