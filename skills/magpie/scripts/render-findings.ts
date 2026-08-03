import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Highlighter } from 'shiki'
import { parseUnifiedDiffToHunks, splitDiffByFile } from './diff-utils.ts'
import { getHighlighter } from './highlight.ts'
import { renderActionBar } from './render-action-bar.ts'
import { renderSplitDiff, renderUnifiedDiff } from './render-diff.ts'
import { renderFileTree } from './render-file-tree.ts'
import { renderIssuesList } from './render-issues-list.ts'
import type { PostStatusMap, PrBrief, PrFileEntry, ReviewFinding } from './types.ts'

export type { PostStatusEntry, PostStatusMap } from './types.ts'

export type FindingsPrMeta = {
  number: number
  branch: string
  headSha: string
}

export type BriefIssue = {
  number: number
  title: string
  url: string
}

export type RenderFindingsInput = {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
  /** Stable id used as the localStorage selection key. Defaults to "unknown" for tests. */
  runId?: string
  /** Optional PR identity. When present, the header shows PR #N, branch, sha. */
  pr?: FindingsPrMeta
  /** Files changed in the PR, used to build the file tree and diff panes. */
  files?: PrFileEntry[]
  /** Raw unified diff text for the PR. */
  diff?: string
  /** Scout-produced PR summary. When absent, the report renders no brief header. */
  brief?: PrBrief
  /** Issues this PR closes, from pr.json's closingIssuesReferences. */
  issues?: BriefIssue[]
  /** Shiki highlighter, prepared by the caller. */
  highlighter: Highlighter
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

const BRAND_MARK_SVG = `<svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none">
  <path d="M3 17.5 C 6.5 7.5, 13 6, 17.5 11 L 21 16.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M11.5 12.5 L 21 16.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <circle class="magpie-eye" cx="6.5" cy="13.5" r="1.1"/>
</svg>`

function brandBlock(): string {
  return `<div class="brand">${BRAND_MARK_SVG}<span class="brand-text">magpie</span></div>`
}

function prHeader(input: RenderFindingsInput): string {
  const pr = input.pr
  const prMeta = pr
    ? `<div class="pr-meta">
        <span class="pr-number">PR #${pr.number}</span>
        <span class="pr-branch">${esc(pr.branch)}</span>
        <code>${esc(pr.headSha.slice(0, 12))}</code>
      </div>`
    : `<div class="pr-meta"></div>`
  const total = input.findings.length
  return `<header class="pr-header">
    ${brandBlock()}
    ${prMeta}
    <div class="header-spacer"></div>
    <div class="segmented" data-role="tabs">
      <button type="button" data-action="set-view" data-view="files" aria-pressed="true">Files</button>
      <button type="button" data-action="set-view" data-view="all-issues" aria-pressed="false">All Issues <span class="seg-count">(${total})</span></button>
    </div>
  </header>`
}

function briefBlock(brief: PrBrief | undefined, issues: BriefIssue[]): string {
  // Absent brief renders nothing: archived runs from before the scout stage
  // existed must still open cleanly.
  if (!brief) return ''
  const changes =
    brief.changes.length > 0
      ? `<ul class="brief-changes">${brief.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
      : ''
  const subsystems =
    brief.subsystems.length > 0
      ? `<div class="brief-subsystems">${brief.subsystems
          .map((s) => `<span class="brief-chip" title="${esc(s.role)}">${esc(s.name)}</span>`)
          .join('')}</div>`
      : ''
  const issueLinks =
    issues.length > 0
      ? `<div class="brief-issues">${issues
          .map(
            (i) =>
              `<a class="brief-issue" href="${esc(i.url)}" title="${esc(i.title)}">#${i.number}</a>`,
          )
          .join('')}</div>`
      : ''
  return `<details class="pr-brief" open>
    <summary class="brief-summary">What this PR is for</summary>
    <div class="brief-body">
      <p class="brief-purpose">${esc(brief.purpose)}</p>
      ${changes}
      ${subsystems}
      ${issueLinks}
    </div>
  </details>`
}

function filePane(opts: {
  file: PrFileEntry
  fileDiff: string
  findings: ReviewFinding[]
  postStatus: PostStatusMap
  selectedIds: Set<string>
  highlighter: Highlighter
}): string {
  const hunks = parseUnifiedDiffToHunks(opts.fileDiff)
  const unified = renderUnifiedDiff({
    hunks,
    findings: opts.findings,
    postStatus: opts.postStatus,
    selectedIds: opts.selectedIds,
    highlighter: opts.highlighter,
    file: opts.file.path,
  })
  const split = renderSplitDiff({
    hunks,
    findings: opts.findings,
    postStatus: opts.postStatus,
    selectedIds: opts.selectedIds,
    highlighter: opts.highlighter,
    file: opts.file.path,
  })
  const findingsCount = opts.findings.length
  // Findings can't be placed inline when (a) the file isn't in the diff at all
  // (gh truncated, or the diff endpoint didn't include it), or (b) the
  // finding's line doesn't fall inside any visible hunk. Surface them in a
  // banner above the diff so they don't silently vanish.
  const hunkNewLines = new Set<number>()
  for (const h of hunks)
    for (const l of h.lines) if (l.newLineNo != null) hunkNewLines.add(l.newLineNo)
  const unplaced = opts.findings.filter((f) => f.line == null || !hunkNewLines.has(f.line))
  const unplacedBanner =
    unplaced.length > 0
      ? `<div class="unplaced-banner" role="note">
          <div class="unplaced-banner-head">
            <span class="unplaced-banner-label">${unplaced.length} finding${unplaced.length === 1 ? '' : 's'} not anchored to the diff</span>
            <span class="unplaced-banner-hint">${hunks.length === 0 ? 'this file is not in the PR diff snapshot' : 'line falls outside the visible hunks'}</span>
          </div>
          ${renderIssuesList({ findings: unplaced, postStatus: opts.postStatus, selectedIds: opts.selectedIds, highlighter: opts.highlighter })}
        </div>`
      : ''
  return `<section class="file-pane" data-file-pane="${esc(opts.file.path)}" hidden>
    <div class="toolbar">
      <div class="crumb">${esc(opts.file.path)}</div>
      <span class="delta"><span class="add">+${opts.file.additions}</span> <span class="del">-${opts.file.deletions}</span></span>
      <div class="finding-nav" data-role="finding-nav" data-total="${findingsCount}">
        <button type="button" data-action="prev-finding" aria-label="previous finding">&#9650;</button>
        <span class="nav-num" data-role="nav-num">${findingsCount} findings</span>
        <button type="button" data-action="next-finding" aria-label="next finding">&#9660;</button>
      </div>
      <div class="diff-mode" data-role="diff-mode">
        <button type="button" data-action="set-diff-mode" data-mode="unified" aria-pressed="true">Unified</button>
        <button type="button" data-action="set-diff-mode" data-mode="split" aria-pressed="false">Split</button>
      </div>
    </div>
    ${unplacedBanner}
    <div class="diff-unified" data-diff-mode="unified">${unified}</div>
    <div class="diff-split" data-diff-mode="split" hidden>${split}</div>
  </section>`
}

function overviewPane(opts: {
  findings: ReviewFinding[]
  postStatus: PostStatusMap
  selectedIds: Set<string>
  highlighter: Highlighter
}): string {
  const general = opts.findings.filter((f) => !f.file)
  if (general.length === 0) {
    return `<section class="overview-pane" data-file-pane="">
      <div class="empty">No general findings. Pick a file from the rail.</div>
    </section>`
  }
  return `<section class="overview-pane" data-file-pane="">
    ${renderIssuesList({ findings: general, postStatus: opts.postStatus, selectedIds: opts.selectedIds, highlighter: opts.highlighter })}
  </section>`
}

export function renderFindingsHtml(input: RenderFindingsInput): string {
  const runId = input.runId ?? 'unknown'
  const files = input.files ?? []
  const diff = input.diff ?? ''
  const splitDiffs = splitDiffByFile(diff)
  const selectedIds = new Set<string>()
  const briefHtml = briefBlock(input.brief, input.issues ?? [])

  if (input.findings.length === 0) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie · no findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-run-id="${esc(runId)}" data-page="findings" data-view="files" data-diff-mode="unified" data-show-suggestions="false">
${prHeader(input)}
${briefHtml}
<main class="page-main">
  <div class="empty-state"><h1>No findings</h1><p>All specialists returned cleanly.</p></div>
</main>
<script>HELPER_INLINE</script>
</body>
</html>`
  }

  const filePanesHtml = files
    .map((file) => {
      const fileDiff = splitDiffs.get(file.path) ?? ''
      const findingsInFile = input.findings.filter((f) => f.file === file.path)
      return filePane({
        file,
        fileDiff,
        findings: findingsInFile,
        postStatus: input.postStatus,
        selectedIds,
        highlighter: input.highlighter,
      })
    })
    .join('\n')

  const overviewHtml = overviewPane({
    findings: input.findings,
    postStatus: input.postStatus,
    selectedIds,
    highlighter: input.highlighter,
  })
  const tree = renderFileTree({ files, findings: input.findings })
  const issues = renderIssuesList({
    findings: input.findings,
    postStatus: input.postStatus,
    selectedIds,
    highlighter: input.highlighter,
  })
  const actionBar = renderActionBar({ findings: input.findings })

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>magpie · findings</title>
<link rel="stylesheet" href="data:text/css;base64,STYLES_INLINE">
</head>
<body data-run-id="${esc(runId)}" data-page="findings" data-view="files" data-diff-mode="unified" data-show-suggestions="false">
${prHeader(input)}
${briefHtml}
<main class="page-main">
  <div class="view files-view">
    ${tree}
    <div class="diff-pane" data-role="diff-pane">
      ${overviewHtml}
      ${filePanesHtml}
    </div>
  </div>
  <div class="view issues-view">
    ${issues}
  </div>
</main>
${actionBar}
<script>HELPER_INLINE</script>
</body>
</html>`
}

export async function renderFindingsToDisk(
  input: Omit<RenderFindingsInput, 'highlighter'>,
  outPath: string,
): Promise<void> {
  const stylesPath = new URL('../templates/styles.css', import.meta.url).pathname
  const helperPath = new URL('./helper.js', import.meta.url).pathname
  const css = await readFile(stylesPath, 'utf8')
  const helper = await readFile(helperPath, 'utf8')
  const highlighter = await getHighlighter()
  const derived = basename(outPath.replace(/\/screen\/.+$/, ''))
  const html = renderFindingsHtml({ ...input, runId: input.runId ?? derived, highlighter })
    .replace(
      'data:text/css;base64,STYLES_INLINE',
      `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
    )
    .replace('HELPER_INLINE', helper)
  await Bun.write(outPath, html)
}
