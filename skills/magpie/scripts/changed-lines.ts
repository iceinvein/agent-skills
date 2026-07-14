import { buildNewSideLineIndex, filePathMatches } from './diff-utils.ts'
import type { ReviewFinding } from './types.ts'

function lookup(index: Map<string, Set<number>>, file: string): Set<number> | undefined {
  const direct = index.get(file)
  if (direct) return direct
  for (const [key, set] of index) {
    if (filePathMatches(key, file)) return set
  }
  return undefined
}

/**
 * Annotate each finding with `onChangedLine`: whether its anchor falls on a line
 * this PR added or kept as context within a changed hunk.
 *
 * - `true`  — anchor is inside a changed hunk (plausibly introduced/triggered here).
 * - `false` — anchor is on code this PR did not touch (pre-existing / unrelated).
 * - `null`  — undecidable: the finding has no line anchor, or the diff is
 *   unavailable (e.g. archived-run replay).
 *
 * This is a deterministic input for the critic so it never has to eyeball
 * "was this introduced by the PR?" from prose alone.
 */
export function annotateChangedLines(findings: ReviewFinding[], diff: string): ReviewFinding[] {
  if (!diff.trim()) {
    return findings.map((f) => ({ ...f, onChangedLine: null }))
  }
  const index = buildNewSideLineIndex(diff)
  return findings.map((f) => {
    if (f.line == null || !f.file) return { ...f, onChangedLine: null }
    const set = lookup(index, f.file)
    if (!set) return { ...f, onChangedLine: false }
    return { ...f, onChangedLine: set.has(f.line) }
  })
}
