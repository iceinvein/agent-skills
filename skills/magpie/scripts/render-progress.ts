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
  'peer-review': 'second opinion via codex',
  report: 'render this page',
  post: 'comment on the PR',
}

const STAGE_NOW_DOING: Record<StageId, string> = {
  setup: 'Fetching the PR and diff',
  context: 'Indexing repo symbols',
  specialists: 'Five reviewers reading the diff in parallel',
  dedupe: 'Merging overlapping findings',
  critic: 'Keeping only the high-signal ones',
  'peer-review': 'Asking a second opinion via codex',
  report: 'Composing the report page',
  post: 'Ready to post; open the findings tab',
}

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

const BRAND_MARK_SVG = `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none">
  <path d="M3 17.5 C 6.5 7.5, 13 6, 17.5 11 L 21 16.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11.5 12.5 L 21 16.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <circle class="magpie-eye" cx="6.5" cy="13.5" r="1.1"/>
</svg>`

function pipelineMarkup(stages: Record<StageId, StageStatus>): string {
  const steps = STAGES.map((s) => {
    const status = stages[s] ?? 'pending'
    return `<li class="step ${status}" data-stage="${s}">
      <span class="dot" aria-hidden="true">${STEP_GLYPH[status]}</span>
      <span class="name">${s}<span class="hint">${escapeHtml(STAGE_HINT[s])}</span></span>
    </li>`
  }).join('')
  const doneCount = STAGES.filter((s) => stages[s] === 'done').length
  return `<section class="rail-section rail-pipeline" aria-label="pipeline">
    <h3 class="rail-section-title">Pipeline</h3>
    <ol class="pipeline" style="--done-count: ${doneCount}">${steps}</ol>
  </section>`
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

function currentStage(stages: Record<StageId, StageStatus>): { id: StageId; status: StageStatus } {
  // Prefer the running stage; otherwise the first error; otherwise the first
  // pending; otherwise the last done. This drives the "now doing" headline.
  const running = STAGES.find((s) => stages[s] === 'running')
  if (running) return { id: running, status: 'running' }
  const errored = STAGES.find((s) => stages[s] === 'error')
  if (errored) return { id: errored, status: 'error' }
  const pending = STAGES.find((s) => stages[s] === 'pending')
  if (pending) return { id: pending, status: 'pending' }
  return { id: 'post', status: stages.post ?? 'done' }
}

function runStatement(stages: Record<StageId, StageStatus>): string {
  const cur = currentStage(stages)
  const doneCount = STAGES.filter((s) => stages[s] === 'done').length
  const totalSteps = STAGES.length
  let lead: string
  let hint: string
  if (cur.status === 'running') {
    lead = `<span class="accent">${escapeHtml(STAGE_NOW_DOING[cur.id])}</span>.`
    hint = STAGE_HINT[cur.id]
  } else if (cur.status === 'error') {
    lead = `<strong>${escapeHtml(STAGE_NOW_DOING[cur.id])}</strong> stalled. The pipeline hit an error.`
    hint = `check the run log for details`
  } else if (cur.status === 'pending' && doneCount === 0) {
    lead = `Warming up.`
    hint = STAGE_HINT[cur.id]
  } else if (cur.status === 'pending' && cur.id === 'post' && stages.report === 'done') {
    // The report stage has produced findings; the page should encourage
    // the reviewer to switch tabs rather than dwell here.
    lead = `<strong>Findings are ready.</strong> Open the findings tab to pick what to post.`
    hint = `report rendered; post is your call`
  } else if (cur.status === 'pending') {
    lead = `Paused before <strong>${escapeHtml(cur.id)}</strong>.`
    hint = STAGE_HINT[cur.id]
  } else {
    lead = `<strong>All eight stages complete.</strong>`
    hint = `findings posted to the PR`
  }
  const stepLabel = `step ${Math.min(doneCount + (cur.status === 'running' ? 1 : 0), totalSteps)} of ${totalSteps}`
  return `<section class="run-statement">
    <p class="now-doing">${lead}</p>
    <p class="run-statement-hint">${stepLabel} · ${escapeHtml(hint)}</p>
  </section>`
}

function railPrMeta(input: RenderProgressInput): string {
  return `<section class="rail-section" aria-label="pull request">
    <div class="pr-meta">
      <span class="pr-number">PR #${input.prNumber}</span>
      <span class="pr-branch">${escapeHtml(input.branch)}</span>
      <code>${escapeHtml(input.headSha.slice(0, 12))}</code>
    </div>
  </section>`
}

const ARCHIVED_BANNER = `<div class="archived-banner" role="note"><strong>Archived view.</strong> Live server is gone; this is a snapshot.</div>`

function brandBlock(): string {
  return `<div class="brand">${BRAND_MARK_SVG}<span class="brand-text">magpie</span></div>`
}

export function renderProgressHtml(input: RenderProgressInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie #${input.prNumber}</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-page="progress">
${ARCHIVED_BANNER}
<div class="curator-shell">
  <main class="page-main">
    <header class="page-header">
      ${brandBlock()}
      <p class="eyebrow">pipeline</p>
      <h1 class="page-title">Reviewing <span class="accent">PR #${input.prNumber}</span>.</h1>
      <p class="lede">Eight stages: five specialists, then dedupe, critic, and a peer review. Watch the rail; the findings page opens itself when the report is ready.</p>
    </header>

    ${runStatement(input.stages)}

    <section class="progress-specialists">
      <h2>Specialists</h2>
      ${specialistsLine(input.specialistCounts)}
    </section>
  </main>

  <aside class="page-rail" aria-label="run details">
    ${railPrMeta(input)}
    ${pipelineMarkup(input.stages)}
  </aside>
</div>
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
