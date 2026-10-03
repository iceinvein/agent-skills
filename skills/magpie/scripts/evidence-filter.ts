import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReviewFinding } from './types.ts'

export type EvidenceDrop = {
  id: string
  reason: 'hallucinated-file' | 'invented-line' | 'missing-evidence' | 'evidence-not-found'
  file: string
  line: number | null
}

export type EvidenceReanchor = {
  id: string
  file: string
  from: number
  to: number
}

export type VerifyEvidenceResult = {
  kept: ReviewFinding[]
  dropped: EvidenceDrop[]
  reanchored: EvidenceReanchor[]
  /** Set when the worktree itself was not available; verification was skipped. */
  skipped: boolean
}

/** How far the quoted evidence may sit from the reported line before it counts as misplaced. */
const EVIDENCE_WINDOW = 3

function isReadableFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

async function readLines(path: string): Promise<string[]> {
  const text = await readFile(path, 'utf8')
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (text.endsWith('\n')) lines.pop()
  return lines
}

// Reviewers re-indent and reflow what they quote, so only the characters are compared.
function normalise(line: string): string {
  return line.trim().replace(/\s+/g, ' ')
}

/** True when `snippet` matches the file lines starting at 1-based line `start`. */
function matchesAt(fileLines: string[], snippet: string[], start: number): boolean {
  if (start < 1 || start - 1 + snippet.length > fileLines.length) return false
  return snippet.every((s, i) => normalise(fileLines[start - 1 + i] ?? '') === s)
}

/**
 * Where the evidence anchors: the reported line when it sits within the window,
 * otherwise the single place in the file it appears. Null when it is absent or
 * ambiguous.
 */
function locateEvidence(fileLines: string[], snippet: string[], line: number): number | null {
  for (let start = line - EVIDENCE_WINDOW; start <= line + EVIDENCE_WINDOW; start++) {
    if (matchesAt(fileLines, snippet, start)) return line
  }
  const matches: number[] = []
  for (let start = 1; start <= fileLines.length; start++) {
    if (matchesAt(fileLines, snippet, start)) matches.push(start)
  }
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export async function verifyEvidence(
  findings: ReviewFinding[],
  worktreePath: string,
): Promise<VerifyEvidenceResult> {
  if (!existsSync(worktreePath)) {
    return { kept: findings, dropped: [], reanchored: [], skipped: true }
  }
  const kept: ReviewFinding[] = []
  const dropped: EvidenceDrop[] = []
  const reanchored: EvidenceReanchor[] = []
  const fileLinesCache = new Map<string, string[]>()

  for (const f of findings) {
    if (f.line === null || !f.file) {
      kept.push(f)
      continue
    }
    const abs = join(worktreePath, f.file)
    if (!isReadableFile(abs)) {
      dropped.push({ id: f.id, reason: 'hallucinated-file', file: f.file, line: f.line })
      continue
    }
    let fileLines = fileLinesCache.get(abs)
    if (fileLines === undefined) {
      fileLines = await readLines(abs)
      fileLinesCache.set(abs, fileLines)
    }
    if (f.line < 1 || f.line > fileLines.length) {
      dropped.push({ id: f.id, reason: 'invented-line', file: f.file, line: f.line })
      continue
    }
    const evidence = f.evidence?.trim() ?? ''
    if (evidence.length === 0) {
      dropped.push({ id: f.id, reason: 'missing-evidence', file: f.file, line: f.line })
      continue
    }
    const anchor = locateEvidence(fileLines, evidence.split('\n').map(normalise), f.line)
    if (anchor === null) {
      dropped.push({ id: f.id, reason: 'evidence-not-found', file: f.file, line: f.line })
      continue
    }
    if (anchor === f.line) {
      kept.push(f)
      continue
    }
    const delta = anchor - f.line
    kept.push({
      ...f,
      line: anchor,
      ...(f.suggestion
        ? {
            suggestion: {
              ...f.suggestion,
              startLine: f.suggestion.startLine + delta,
              endLine: f.suggestion.endLine + delta,
            },
          }
        : {}),
    })
    reanchored.push({ id: f.id, file: f.file, from: f.line, to: anchor })
  }
  return { kept, dropped, reanchored, skipped: false }
}
