import { readFile } from 'node:fs/promises'
import type { ReviewFinding } from './types.ts'

export type PostStatusEntry = 'posted' | { status: 'failed'; message: string }
export type PostStatusMap = Record<string, PostStatusEntry>

export type RenderFindingsInput = {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

function badge(_id: string, status: PostStatusEntry | undefined): string {
  if (!status) return ''
  if (status === 'posted') return '<span class="badge posted">posted</span>'
  return `<span class="badge failed">failed: ${escapeHtml(status.message)}</span>`
}

function findingCard(f: ReviewFinding, status: PostStatusEntry | undefined): string {
  const sev = f.severity
  const checked = status === 'posted' ? 'checked disabled' : ''
  const suggestion = f.suggestion
    ? `<pre class="finding-suggestion">${escapeHtml(f.suggestion.body)}</pre>`
    : ''
  return `<div class="finding" id="finding-${escapeHtml(f.id)}">
  <div class="finding-head">
    <input type="checkbox" data-finding-id="${escapeHtml(f.id)}" ${checked} />
    <span class="sev-chip sev-${sev}">${sev}</span>
    <span class="finding-title">${escapeHtml(f.title)}</span>
    ${badge(f.id, status)}
  </div>
  <div class="finding-meta">${escapeHtml(f.file)}${f.line != null ? `:${f.line}` : ''} <span class="subtle">(${escapeHtml((f.domain as string) ?? 'unknown')})</span></div>
  <div class="finding-desc">${escapeHtml(f.description)}</div>
  ${suggestion}
</div>`
}

export function renderFindingsHtml(input: RenderFindingsInput): string {
  const { findings, postStatus } = input
  if (findings.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review</title><link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE"></head><body>
<h1>No findings</h1>
<p class="subtle">All specialists returned cleanly and nothing survived the pipeline.</p>
</body></html>`
  }
  const cards = findings.map((f) => findingCard(f, postStatus[f.id])).join('\n')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review</title><link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE"></head><body>
<h1>Findings</h1>
<p class="subtle">Select findings to post; then reply <code>post</code> in the terminal.</p>
${cards}
<div class="submit-bar"><button class="submit-btn" data-action="submit">Post selected</button></div>
</body></html>`
}

export async function renderFindingsToDisk(
  input: RenderFindingsInput,
  outPath: string,
): Promise<void> {
  const stylesPath = new URL('../templates/styles.css', import.meta.url).pathname
  const css = await readFile(stylesPath, 'utf8')
  const html = renderFindingsHtml(input).replace(
    'data:text/css;base64,STYLES_INLINE',
    `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
  )
  await Bun.write(outPath, html)
}
