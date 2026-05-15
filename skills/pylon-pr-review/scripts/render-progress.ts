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
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

export function renderProgressHtml(input: RenderProgressInput): string {
  const stages = STAGES.map((s) => `<span class="stage ${input.stages[s]}">${s}</span>`).join('')
  const counts = Object.entries(input.specialistCounts)
    .map(([k, v]) => `<li>${escapeHtml(k)}: ${v}</li>`)
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review #${input.prNumber}</title><link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE"></head><body>
<h1>PR #${input.prNumber}: ${escapeHtml(input.branch)}</h1>
<p class="subtle">head ${escapeHtml(input.headSha)}</p>
<div class="stage-strip">${stages}</div>
<h2>Specialists</h2>
<ul>${counts}</ul>
</body></html>`
}

export async function renderProgressToDisk(
  input: RenderProgressInput,
  outPath: string,
): Promise<void> {
  const stylesPath = new URL('../templates/styles.css', import.meta.url).pathname
  const css = await readFile(stylesPath, 'utf8')
  const html = renderProgressHtml(input).replace(
    'data:text/css;base64,STYLES_INLINE',
    `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
  )
  await Bun.write(outPath, html)
}
