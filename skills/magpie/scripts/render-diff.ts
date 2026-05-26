import type { Highlighter } from 'shiki'
import { buildPairedLines, type DiffHunk, type DiffLine, type PairedLine } from './diff-utils.ts'
import { highlightDiffSide, languageFromPath } from './highlight.ts'
import { renderAnnotation } from './render-annotation.ts'
import type { PostStatusEntry, PostStatusMap, ReviewFinding } from './types.ts'

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

export type RenderDiffInput = {
  hunks: DiffHunk[]
  findings: ReviewFinding[]
  postStatus: PostStatusMap
  selectedIds: Set<string>
  highlighter: Highlighter
  /** File path used to detect language for highlighting. */
  file: string
}

function isPosted(status: PostStatusEntry | undefined): boolean {
  return status === 'posted'
}

function failedFrom(status: PostStatusEntry | undefined): { message: string } | undefined {
  if (status && typeof status === 'object' && status.status === 'failed') {
    return { message: status.message }
  }
  return undefined
}

function coloredLineRow(line: DiffLine, coloredContent: string): string {
  const cls = line.type === 'added' ? 'added' : line.type === 'removed' ? 'removed' : 'context'
  const lineNo = line.type === 'removed' ? line.oldLineNo : line.newLineNo
  const sign = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '
  return `<div class="diff-row ${cls}"><span class="gutter">${lineNo ?? ''}</span><span class="sign">${sign}</span><span class="content">${coloredContent}</span></div>`
}

function findingsByLine(findings: ReviewFinding[]): Map<number, ReviewFinding[]> {
  const m = new Map<number, ReviewFinding[]>()
  for (const f of findings) {
    if (f.line == null) continue
    const arr = m.get(f.line) ?? []
    arr.push(f)
    m.set(f.line, arr)
  }
  return m
}

export function renderUnifiedDiff(input: RenderDiffInput): string {
  const { hunks, findings, postStatus, selectedIds, highlighter, file } = input
  if (hunks.length === 0) return `<div class="diff-empty">No changes</div>`
  const byLine = findingsByLine(findings)
  const lang = languageFromPath(file)
  const parts: string[] = []
  hunks.forEach((h, hi) => {
    if (hi > 0) parts.push(`<div class="diff-hunk-sep">⋯</div>`)

    const oldLines: string[] = []
    const newLines: string[] = []
    const rowSide: Array<{ side: 'old' | 'new'; idx: number }> = []
    for (const line of h.lines) {
      if (line.type === 'removed') {
        rowSide.push({ side: 'old', idx: oldLines.length })
        oldLines.push(line.content)
      } else if (line.type === 'added') {
        rowSide.push({ side: 'new', idx: newLines.length })
        newLines.push(line.content)
      } else {
        rowSide.push({ side: 'new', idx: newLines.length })
        oldLines.push(line.content)
        newLines.push(line.content)
      }
    }
    const oldHighlighted = oldLines.length
      ? highlightDiffSide(highlighter, oldLines.join('\n'), lang)
      : []
    const newHighlighted = newLines.length
      ? highlightDiffSide(highlighter, newLines.join('\n'), lang)
      : []

    h.lines.forEach((line, i) => {
      const ref = rowSide[i]
      const colored =
        (ref?.side === 'old' ? oldHighlighted[ref.idx] : newHighlighted[ref?.idx ?? 0]) ??
        esc(line.content)
      parts.push(coloredLineRow(line, colored))
      const targetLine = line.newLineNo ?? null
      if (targetLine != null) {
        const fs = byLine.get(targetLine)
        if (fs) {
          for (const f of fs) {
            parts.push(
              renderAnnotation(f, {
                highlighter,
                checked: selectedIds.has(f.id),
                posted: isPosted(postStatus[f.id]),
                failed: failedFrom(postStatus[f.id]),
                asCard: false,
              }),
            )
          }
        }
      }
    })
  })
  return parts.join('\n')
}

function pairedRow(pair: PairedLine): string {
  const cellL =
    pair.left == null
      ? `<div class="diff-cell empty"></div>`
      : `<div class="diff-cell ${pair.left.type}"><span class="gutter">${pair.left.oldLineNo ?? pair.left.newLineNo ?? ''}</span><span class="sign">${pair.left.type === 'removed' ? '-' : ' '}</span><span class="content">${esc(pair.left.content)}</span></div>`
  const cellR =
    pair.right == null
      ? `<div class="diff-cell empty"></div>`
      : `<div class="diff-cell ${pair.right.type}"><span class="gutter">${pair.right.newLineNo ?? pair.right.oldLineNo ?? ''}</span><span class="sign">${pair.right.type === 'added' ? '+' : ' '}</span><span class="content">${esc(pair.right.content)}</span></div>`
  return `<div class="diff-row split">${cellL}${cellR}</div>`
}

export function renderSplitDiff(input: RenderDiffInput): string {
  const { hunks, findings, postStatus, selectedIds, highlighter } = input
  if (hunks.length === 0) return `<div class="diff-empty">No changes</div>`
  const byLine = findingsByLine(findings)
  const parts: string[] = []
  hunks.forEach((h, hi) => {
    if (hi > 0) parts.push(`<div class="diff-hunk-sep">⋯</div>`)
    const pairs = buildPairedLines([h])
    for (const pair of pairs) {
      parts.push(pairedRow(pair))
      const target = pair.right?.newLineNo ?? null
      if (target != null) {
        const fs = byLine.get(target)
        if (fs) {
          for (const f of fs) {
            parts.push(
              renderAnnotation(f, {
                checked: selectedIds.has(f.id),
                posted: isPosted(postStatus[f.id]),
                failed: failedFrom(postStatus[f.id]),
                asCard: false,
                highlighter,
              }),
            )
          }
        }
      }
    }
  })
  return parts.join('\n')
}
