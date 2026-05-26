import type { Highlighter } from 'shiki'
import { renderAnnotation } from './render-annotation.ts'
import type { PostStatusMap } from './types.ts'
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

export type RenderIssuesListInput = {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
  selectedIds: Set<string>
  highlighter: Highlighter
}

function severityCounts(findings: ReviewFinding[]): Map<Severity, number> {
  const m = new Map<Severity, number>()
  for (const f of findings) m.set(f.severity, (m.get(f.severity) ?? 0) + 1)
  return m
}

export function renderIssuesList(input: RenderIssuesListInput): string {
  const { findings, postStatus, selectedIds, highlighter } = input
  const actionable = findings.filter((f) => !isSuggestion(f))
  const suggestions = findings.filter((f) => isSuggestion(f))
  const counts = severityCounts(findings)
  const pillsHtml = SEVERITIES.filter((s) => (counts.get(s) ?? 0) > 0)
    .map(
      (s) =>
        `<button type="button" class="filter-pill sev-${s}" data-action="filter-sev" data-sev="${s}" aria-pressed="true">${esc(SEVERITY_LABEL[s])} (${counts.get(s) ?? 0})</button>`,
    )
    .join('')
  const suggestionToggle =
    suggestions.length > 0
      ? `<button type="button" class="show-suggestions-toggle" data-action="toggle-suggestions" aria-pressed="false">Show ${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}</button>`
      : ''
  const cardsHtml = findings
    .map((f) => {
      const status = postStatus[f.id]
      const failed =
        status && typeof status === 'object' && status.status === 'failed'
          ? { message: status.message }
          : undefined
      return renderAnnotation(f, {
        checked: selectedIds.has(f.id),
        posted: status === 'posted',
        failed,
        asCard: true,
        highlighter,
      })
    })
    .join('\n')
  return `<section class="issues-pane" data-role="issues-list">
    <div class="issues-filter">
      <span class="lead">${actionable.length} should review</span>
      ${suggestionToggle}
      <span class="sep"></span>
      ${pillsHtml}
    </div>
    <div class="issues-list">
      ${cardsHtml}
    </div>
  </section>`
}
