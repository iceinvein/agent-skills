import { readFile } from 'node:fs/promises'

const STAGES = [
  'setup',
  'context',
  'specialists',
  'dedupe',
  'critic',
  'peer-review',
  'report',
  'post',
] as const
export type StageId = (typeof STAGES)[number]
export type StageStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export type RenderProgressInput = {
  prNumber: number
  headSha: string
  branch: string
  stages: Record<StageId, StageStatus>
  specialistCounts: Record<string, number>
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

const STEP_GLYPH: Record<StageStatus, string> = {
  done: '●',
  running: '◐',
  pending: '○',
  error: '✕',
  skipped: '∅',
}

function pipelineHtml(stages: Record<StageId, StageStatus>): string {
  const steps = STAGES.map((s) => {
    const status = stages[s] ?? 'pending'
    return `<div class="step ${status}" data-stage="${s}">
      <span class="dot" aria-hidden="true">${STEP_GLYPH[status]}</span>
      <span class="name">${s}</span>
    </div>`
  }).join('')
  return `<div class="pipeline" role="list">${steps}</div>`
}

function specialistsLine(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) {
    return '<p class="specialists-line">awaiting specialist output</p>'
  }
  const total = entries.reduce((acc, [, n]) => acc + n, 0)
  const parts = entries
    .map(([k, v]) => `<span class="part">${escapeHtml(k)} <span class="count">${v}</span></span>`)
    .join('<span class="sep">·</span>')
  return `<p class="specialists-line"><span class="count">${total}</span> finding${total === 1 ? '' : 's'} <span class="sep">·</span> ${parts}</p>`
}

const ARCHIVED_BANNER = `<div class="archived-banner" role="note"><strong>Archived view.</strong> Live server is gone; this is a snapshot.</div>`

export function renderProgressHtml(input: RenderProgressInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>pr-review #${input.prNumber}</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body>
${ARCHIVED_BANNER}
<main class="page">
  <header class="page-header">
    <p class="eyebrow">pr-review · pipeline</p>
    <h1>PR #${input.prNumber}</h1>
    <p class="lede">${escapeHtml(input.branch)} <span class="subtle">at <code>${escapeHtml(input.headSha.slice(0, 12))}</code></span></p>
  </header>

  ${pipelineHtml(input.stages)}

  <h2>Specialists</h2>
  ${specialistsLine(input.specialistCounts)}
</main>
<script>HELPER_INLINE</script>
</body>
</html>`
}

export async function renderProgressToDisk(
  input: RenderProgressInput,
  outPath: string,
): Promise<void> {
  const stylesPath = new URL('../templates/styles.css', import.meta.url).pathname
  const helperPath = new URL('./helper.js', import.meta.url).pathname
  const css = await readFile(stylesPath, 'utf8')
  const helper = await readFile(helperPath, 'utf8')
  const html = renderProgressHtml(input)
    .replace(
      'data:text/css;base64,STYLES_INLINE',
      `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
    )
    .replace('HELPER_INLINE', helper)
  await Bun.write(outPath, html)
}
