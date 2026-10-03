import { rankActionable } from './render-issues-list.ts'
import { isSuggestion, type ReviewFinding, SEVERITIES, type Severity } from './types.ts'

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
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

export type RenderActionBarInput = {
  findings: ReviewFinding[]
  /** Finding id to dismiss reason, folded from state/events. */
  dismissed: Map<string, string>
  topN: number
}

export function renderActionBar(input: RenderActionBarInput): string {
  const actionable = input.findings.filter((f) => !isSuggestion(f))
  const { recommended } = rankActionable(input.findings, input.dismissed, input.topN)
  const excluded = input.findings.length - actionable.length
  const counts = new Map<Severity, number>()
  for (const f of actionable) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1)
  const pills = SEVERITIES.filter((s) => (counts.get(s) ?? 0) > 0)
    .map(
      (s) =>
        `<button type="button" class="action-pill sev-${s}" data-action="select-sev" data-sev="${s}" aria-pressed="false">${esc(SEVERITY_LABEL[s])} (${counts.get(s) ?? 0})</button>`,
    )
    .join('')
  const excludedHint =
    excluded > 0
      ? `<span class="excluded">${excluded} suggestion${excluded === 1 ? '' : 's'} excluded</span>`
      : ''
  return `<footer class="action-bar" data-role="action-bar">
    <button type="button" class="link-btn" data-action="select-recommended">Select recommended</button>
    <div class="pills">${pills}</div>
    <div class="spacer"></div>
    <button type="button" class="btn outline" data-action="post-selected" disabled>Post Selected (<span data-role="selected-count">0</span>)</button>
    <button type="button" class="btn primary" data-action="post-recommended">Post Recommended (${recommended.length})</button>
    ${excludedHint}
    <p class="post-status" data-role="post-status" role="status" aria-live="polite" hidden></p>
  </footer>`
}
