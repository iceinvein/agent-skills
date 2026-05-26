import type { Highlighter } from 'shiki'
import { parseFindingDescription } from './finding-description.ts'
import { isSuggestion, type ReviewFinding } from './types.ts'

const DOMAIN_LABELS: Record<string, string> = {
  security: 'Security',
  bugs: 'Bugs',
  performance: 'Perf',
  'code-smells': 'Smells',
  architecture: 'Arch',
}

const SEVERITY_LABEL: Record<string, string> = {
  blocker: 'BLOCKER',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
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

export type RenderAnnotationOptions = {
  checked: boolean
  posted: boolean
  asCard: boolean
  /** When posting previously failed, surface the failure on the card. */
  failed?: { message: string }
  highlighter: Highlighter
}

function renderSections(description: string): string {
  const sections = parseFindingDescription(description)
  if (sections.length === 0) {
    return `<section class="section"><div class="section-label">Observation</div><div class="section-body">${esc(description.trim())}</div></section>`
  }
  return sections
    .map(
      (s) =>
        `<section class="section"><div class="section-label">${esc(s.label)}</div><div class="section-body">${esc(s.body)}</div></section>`,
    )
    .join('')
}

function renderSuggestion(f: ReviewFinding): string {
  if (!f.suggestion) return ''
  return `<section class="section"><div class="section-label">Suggested change</div><pre class="suggestion">${esc(f.suggestion.body)}</pre></section>`
}

function renderRisk(f: ReviewFinding): string {
  return `<div class="risk">Impact: <span class="tag">${esc(f.risk.impact)}</span> · Likelihood: <span class="tag">${esc(f.risk.likelihood)}</span> · Confidence: <span class="tag">${esc(f.risk.confidence)}</span> · Action: <span class="tag">${esc(f.risk.action)}</span></div>`
}

export function renderAnnotation(f: ReviewFinding, opts: RenderAnnotationOptions): string {
  const domain = (f.domain as string) ?? 'unknown'
  const domainLabel = DOMAIN_LABELS[domain] ?? domain
  const sevLabel = SEVERITY_LABEL[f.severity] ?? f.severity.toUpperCase()
  const containerClass = opts.asCard ? `issue-card sev-${f.severity}` : `annot sev-${f.severity}`
  const cbAttrs = opts.posted ? 'checked disabled' : opts.checked ? 'checked' : ''
  const suggestion = isSuggestion(f) ? 'true' : 'false'
  const postedAttr = opts.posted ? ' data-posted="true"' : ''
  const failedAttr = opts.failed ? ' data-failed="true"' : ''
  let statusChip: string
  if (opts.posted) {
    statusChip = '<span class="status-chip posted">POSTED</span>'
  } else if (opts.failed) {
    statusChip = `<span class="status-chip failed" title="${esc(opts.failed.message)}">FAILED: ${esc(opts.failed.message)}</span>`
  } else {
    statusChip = '<span class="status-chip new">NEW</span>'
  }
  return `<div class="${containerClass}" data-finding-id="${esc(f.id)}" data-severity="${f.severity}" data-domain="${esc(domain)}" data-suggestion="${suggestion}"${postedAttr}${failedAttr}>
  <div class="annot-row">
    <input type="checkbox" data-finding-id="${esc(f.id)}" ${cbAttrs} aria-label="select ${esc(f.id)}" />
    <div class="annot-body">
      <div class="annot-head">
        <span class="sev-label sev-${f.severity}">${sevLabel}</span>
        <span class="annot-title">${esc(f.title)}</span>
        <span class="domain-chip">${esc(domainLabel)}</span>
        ${statusChip}
      </div>
      ${renderSections(f.description)}
      ${renderSuggestion(f)}
      ${renderRisk(f)}
    </div>
    <button type="button" class="send-btn" data-action="post-one" data-finding-id="${esc(f.id)}" title="Post this finding" aria-label="post">▸</button>
  </div>
</div>`
}
