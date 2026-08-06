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

const STAGE_HINT: Record<StageId, string> = {
  setup: 'fetch PR and diff',
  context: 'index symbols',
  specialists: 'five reviewers in parallel',
  dedupe: 'merge overlaps',
  critic: 'keep the high-signal ones',
  'peer-review': 'independent second opinion',
  report: 'render this page',
  post: 'comment on the PR',
}

const STAGE_NOW_DOING: Record<StageId, string> = {
  setup: 'Fetching the PR and diff',
  context: 'Indexing repo symbols',
  specialists: 'Five reviewers reading the diff in parallel',
  dedupe: 'Merging overlapping findings',
  critic: 'Keeping only the high-signal ones',
  'peer-review': 'Getting an independent second opinion',
  report: 'Composing the report page',
  post: 'Ready to post; switch tabs to pick findings',
}

export type RenderProgressInput = {
  prNumber: number
  headSha: string
  branch: string
  stages: Record<StageId, StageStatus>
  specialistCounts: Record<string, number>
  /** Shard count from shards/manifest.json. Absent or 1 means unsharded. */
  shardCount?: number
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const m: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return m[c] ?? c
  })
}

function current(stages: Record<StageId, StageStatus>): { id: StageId; status: StageStatus } {
  const running = STAGES.find((s) => stages[s] === 'running')
  if (running) return { id: running, status: 'running' }
  const errored = STAGES.find((s) => stages[s] === 'error')
  if (errored) return { id: errored, status: 'error' }
  const pending = STAGES.find((s) => stages[s] === 'pending')
  if (pending) return { id: pending, status: 'pending' }
  return { id: 'post', status: stages.post ?? 'done' }
}

function specialistsLine(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) {
    return '<p class="specialists-line">awaiting specialist output</p>'
  }
  const total = entries.reduce((acc, [, n]) => acc + n, 0)
  const parts = entries
    .map(([k, v]) => `<span class="part">${esc(k)} <span class="count">${v}</span></span>`)
    .join('<span class="sep">·</span>')
  return `<p class="specialists-line"><span class="count">${total}</span> finding${total === 1 ? '' : 's'} <span class="sep">·</span> ${parts}</p>`
}

function progressPane(input: RenderProgressInput): string {
  const cur = current(input.stages)
  let lead: string
  if (cur.status === 'running') {
    lead =
      cur.id === 'specialists' && (input.shardCount ?? 1) > 1
        ? `Five reviewers across ${input.shardCount} shards`
        : STAGE_NOW_DOING[cur.id]
  } else if (cur.status === 'error') {
    lead = `${STAGE_NOW_DOING[cur.id]} stalled`
  } else if (cur.status === 'pending') {
    lead = `Paused before ${cur.id}`
  } else {
    lead = 'All eight stages complete'
  }
  const doneCount = STAGES.filter((s) => input.stages[s] === 'done').length
  const stagesHtml = STAGES.map((s) => {
    const status = input.stages[s] ?? 'pending'
    return `<li class="step ${status}" data-stage="${s}"><span class="dot"></span><span class="name">${s}</span><span class="hint">${esc(STAGE_HINT[s])}</span></li>`
  }).join('')
  return `<section class="progress-pane" data-role="progress-pane">
    <p class="now-doing">${esc(lead)}.</p>
    <ol class="pipeline" style="--done-count: ${doneCount}">${stagesHtml}</ol>
    ${specialistsLine(input.specialistCounts)}
  </section>`
}

const BRAND_MARK_SVG = `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M3 17.5 C 6.5 7.5, 13 6, 17.5 11 L 21 16.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 12.5 L 21 16.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle class="magpie-eye" cx="6.5" cy="13.5" r="1.1"/></svg>`

const ARCHIVED_BANNER = `<div class="archived-banner" role="note"><strong>Archived view.</strong> Live server is gone; this is a snapshot.</div>`

export function renderProgressHtml(input: RenderProgressInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie #${input.prNumber}</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-page="progress" data-view="files">
${ARCHIVED_BANNER}
<header class="pr-header">
  <div class="brand">${BRAND_MARK_SVG}<span class="brand-text">magpie</span></div>
  <div class="pr-meta"><span class="pr-number">PR #${input.prNumber}</span><span class="pr-branch">${esc(input.branch)}</span><code>${esc(input.headSha.slice(0, 12))}</code></div>
  <div class="header-spacer"></div>
  <div class="segmented" data-role="tabs">
    <button type="button" aria-pressed="true" disabled>Files</button>
    <button type="button" aria-pressed="false" disabled>All Issues</button>
  </div>
</header>
<main class="page-main">
  <div class="view files-view">
    <aside class="file-rail empty"><p class="empty-hint">Files appear once setup completes.</p></aside>
    <div class="diff-pane">${progressPane(input)}</div>
  </div>
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
