export type DiffLine = {
  type: 'context' | 'added' | 'removed'
  content: string
  oldLineNo: number | null
  newLineNo: number | null
}

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/m
const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+)$/m

export function parseUnifiedDiffToHunks(diff: string): DiffHunk[] {
  if (!diff) return []
  const lines = diff.split('\n')
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0

  for (const raw of lines) {
    const m = raw.match(HUNK_HEADER)
    if (m) {
      current = {
        oldStart: Number(m[1]),
        oldLines: m[2] ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newLines: m[4] ? Number(m[4]) : 1,
        header: m[5] ?? '',
        lines: [],
      }
      oldNo = current.oldStart
      newNo = current.newStart
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (raw.startsWith('\\')) continue
    if (raw.startsWith('+++') || raw.startsWith('---')) continue
    if (raw.length === 0) continue
    const first = raw[0]
    if (first === '+') {
      current.lines.push({
        type: 'added',
        content: raw.slice(1),
        oldLineNo: null,
        newLineNo: newNo,
      })
      newNo += 1
    } else if (first === '-') {
      current.lines.push({
        type: 'removed',
        content: raw.slice(1),
        oldLineNo: oldNo,
        newLineNo: null,
      })
      oldNo += 1
    } else if (first === ' ') {
      current.lines.push({
        type: 'context',
        content: raw.slice(1),
        oldLineNo: oldNo,
        newLineNo: newNo,
      })
      oldNo += 1
      newNo += 1
    }
  }
  return hunks
}

export function splitDiffByFile(diff: string): Map<string, string> {
  const m = new Map<string, string>()
  if (!diff) return m
  const chunks = diff.split(/^(?=diff --git )/m)
  for (const chunk of chunks) {
    if (!chunk.startsWith('diff --git ')) continue
    const headerMatch = chunk.match(FILE_HEADER)
    if (!headerMatch || !headerMatch[2]) continue
    m.set(headerMatch[2], chunk)
  }
  return m
}

export function filePathMatches(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/^[ab]\//, '')
  return norm(a) === norm(b)
}

export type PairedLine = { left: DiffLine | null; right: DiffLine | null }

export function buildPairedLines(hunks: DiffHunk[]): PairedLine[] {
  const rows: PairedLine[] = []
  for (const h of hunks) {
    let i = 0
    while (i < h.lines.length) {
      const cur = h.lines[i]
      if (!cur) {
        i += 1
        continue
      }
      const next = h.lines[i + 1] ?? null
      if (cur.type === 'context') {
        rows.push({ left: cur, right: cur })
        i += 1
        continue
      }
      if (cur.type === 'removed' && next?.type === 'added') {
        rows.push({ left: cur, right: next })
        i += 2
        continue
      }
      if (cur.type === 'removed') {
        rows.push({ left: cur, right: null })
      } else {
        rows.push({ left: null, right: cur })
      }
      i += 1
    }
  }
  return rows
}
