import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ReviewFinding } from './types.ts'

export type EvidenceDrop = {
  id: string
  reason: 'hallucinated-file' | 'invented-line'
  file: string
  line: number | null
}

export type VerifyEvidenceResult = {
  kept: ReviewFinding[]
  dropped: EvidenceDrop[]
  /** Set when the worktree itself was not available; verification was skipped. */
  skipped: boolean
}

function isReadableFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

async function lineCount(path: string): Promise<number> {
  const text = await readFile(path, 'utf8')
  if (text.length === 0) return 0
  let count = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count += 1
  }
  if (text.charCodeAt(text.length - 1) === 10) count -= 1
  return count
}

export async function verifyEvidence(
  findings: ReviewFinding[],
  worktreePath: string,
): Promise<VerifyEvidenceResult> {
  if (!existsSync(worktreePath)) {
    return { kept: findings, dropped: [], skipped: true }
  }
  const kept: ReviewFinding[] = []
  const dropped: EvidenceDrop[] = []
  const lineCounts = new Map<string, number>()

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
    let count = lineCounts.get(abs)
    if (count === undefined) {
      count = await lineCount(abs)
      lineCounts.set(abs, count)
    }
    if (f.line < 1 || f.line > count) {
      dropped.push({ id: f.id, reason: 'invented-line', file: f.file, line: f.line })
      continue
    }
    kept.push(f)
  }
  return { kept, dropped, skipped: false }
}
