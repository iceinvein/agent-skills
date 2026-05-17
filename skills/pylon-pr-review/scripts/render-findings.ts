import { readFile } from 'node:fs/promises'
import type { ReviewFinding, Severity } from './types.ts'

export type PostStatusEntry = 'posted' | { status: 'failed'; message: string }
export type PostStatusMap = Record<string, PostStatusEntry>

export type RenderFindingsInput = {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
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
  const order: Severity[] = ['blocker', 'high', 'medium', 'low']
  const counts: Record<Severity, number> = { blocker: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) counts[f.severity] += 1
  return order
    .filter((k) => counts[k] > 0)
    .map((k) => `<span class="num">${counts[k]}</span>&nbsp;${k}`)
    .join(' &nbsp;·&nbsp; ')
}

function findingCard(f: ReviewFinding, status: PostStatusEntry | undefined): string {
  const checked = status === 'posted' ? 'checked disabled' : ''
  const suggestion = f.suggestion
    ? `<pre class="finding-suggestion">${escapeHtml(f.suggestion.body)}</pre>`
    : ''
  const anchor = f.line != null ? `${escapeHtml(f.file)}:${f.line}` : escapeHtml(f.file)
  const domain = (f.domain as string) ?? 'unknown'
  return `<article class="finding" id="finding-${escapeHtml(f.id)}">
  <header class="finding-head">
    <input type="checkbox" data-finding-id="${escapeHtml(f.id)}" ${checked} aria-label="select finding ${escapeHtml(f.id)}" />
    <span class="sev-chip sev-${f.severity}">${f.severity}</span>
    <h3 class="finding-title">${escapeHtml(f.title)}</h3>
    ${badge(status)}
  </header>
  <div class="finding-anchor"><span class="path">${anchor}</span><span class="domain">${escapeHtml(domain)}</span></div>
  <div class="finding-desc">${escapeHtml(f.description)}</div>
  ${suggestion}
</article>`
}

const ARCHIVED_BANNER = `<div class="archived-banner" role="note"><strong>Archived view.</strong> The live server is gone; selections are read-only. Run <code>pr-review serve &lt;run-dir&gt;</code> to bring it back.</div>`

export function renderFindingsHtml(input: RenderFindingsInput): string {
  const { findings, postStatus } = input

  if (findings.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>pr-review — no findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body>
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
<title>pr-review — findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body>
${ARCHIVED_BANNER}
<main class="page">
  <header class="page-header">
    <p class="eyebrow">pr-review · findings</p>
    <h1>Review</h1>
    <p class="lede">Select what to post, then reply <code>post</code> in the terminal.</p>
  </header>

  <section class="findings-summary" aria-label="summary">
    <div><span class="count">${findings.length}</span> <span class="subtle">finding${findings.length === 1 ? '' : 's'}</span></div>
    <div class="breakdown">${breakdown}</div>
  </section>

  ${cards}

  <div class="submit-bar">
    <span class="selected-count" data-role="selected-count"><span class="num">0</span> selected</span>
    <button class="submit-btn" data-action="submit" disabled>Post selected</button>
  </div>
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
  const html = renderFindingsHtml(input)
    .replace(
      'data:text/css;base64,STYLES_INLINE',
      `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
    )
    .replace('HELPER_INLINE', helper)
  await Bun.write(outPath, html)
}
