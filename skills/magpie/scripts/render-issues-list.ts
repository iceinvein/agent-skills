import type { Highlighter } from 'shiki'
import { renderAnnotation } from './render-annotation.ts'
import { scoreRisk } from './score.ts'
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
  /** Finding id to dismiss reason, folded from state/events. */
  dismissed: Map<string, string>
  /**
   * How many actionable findings to mark recommended before folding the rest.
   * Null keeps input order with no marks and no fold, for the lists embedded in
   * the file view, which must show every finding where it sits.
   */
  topN: number | null
  highlighter: Highlighter
}

export const DEFAULT_TOP_N = 10

/**
 * Splits the actionable findings into the recommended set (the topN highest
 * risk scores, not dismissed) and the rest, both ordered by score descending.
 * The action bar counts the same set the issues list marks, so both use this.
 */
export function rankActionable(
  findings: ReviewFinding[],
  dismissed: Map<string, string>,
  topN: number,
): { recommended: ReviewFinding[]; folded: ReviewFinding[] } {
  // Array.prototype.sort is stable, so equal scores keep input order.
  const sorted = findings
    .filter((f) => !isSuggestion(f))
    .sort((a, b) => scoreRisk(b.risk) - scoreRisk(a.risk))
  const recommended = sorted.filter((f) => !dismissed.has(f.id)).slice(0, topN)
  const picked = new Set(recommended)
  return { recommended, folded: sorted.filter((f) => !picked.has(f)) }
}

function severityCounts(findings: ReviewFinding[]): Map<Severity, number> {
  const m = new Map<Severity, number>()
  for (const f of findings) m.set(f.severity, (m.get(f.severity) ?? 0) + 1)
  return m
}

export function renderIssuesList(input: RenderIssuesListInput): string {
  const { findings, postStatus, selectedIds, dismissed, topN, highlighter } = input
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
  const renderCard = (f: ReviewFinding): string => {
    const status = postStatus[f.id]
    const failed =
      status && typeof status === 'object' && status.status === 'failed'
        ? { message: status.message }
        : undefined
    return renderAnnotation(f, {
      checked: selectedIds.has(f.id),
      posted: status === 'posted',
      failed,
      dismissed: dismissed.get(f.id),
      asCard: true,
      highlighter,
    })
  }
  let cardsHtml: string
  if (topN === null) {
    cardsHtml = findings.map(renderCard).join('\n')
  } else {
    const { recommended, folded } = rankActionable(findings, dismissed, topN)
    const recommendedHtml = recommended
      .map((f) => `<div class="recommended-slot" data-recommended="true">${renderCard(f)}</div>`)
      .join('\n')
    const foldHtml =
      folded.length > 0
        ? `<button type="button" class="show-more-toggle" data-action="toggle-more" data-count="${folded.length}" aria-expanded="false">Show ${folded.length} more</button>
      <div class="more-findings" hidden>
      ${folded.map(renderCard).join('\n')}
      </div>`
        : ''
    cardsHtml = [recommendedHtml, foldHtml, suggestions.map(renderCard).join('\n')].join('\n')
  }
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
