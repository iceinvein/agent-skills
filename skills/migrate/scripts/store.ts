import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { assertNotUnderSource } from './paths.ts'

export async function readRows<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) return []
  const text = await readFile(path, 'utf8')
  const rows: T[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue
    try {
      rows.push(JSON.parse(line) as T)
    } catch {
      throw new Error(`${path}: malformed JSON at line ${i + 1}`)
    }
  }
  return rows
}

// Temp-plus-rename so a crash mid-write cannot truncate the store. The temp
// file is a sibling, which keeps the rename on one filesystem and therefore
// atomic.
export async function writeRows<T>(path: string, rows: T[], sourcePath: string): Promise<void> {
  assertNotUnderSource(path, sourcePath)
  const body = rows.map((r) => JSON.stringify(r)).join('\n')
  const text = rows.length > 0 ? `${body}\n` : ''
  const random = randomBytes(8).toString('hex')
  const tmp = `${path}.${random}.tmp`
  try {
    await writeFile(tmp, text)
    await rename(tmp, path)
  } finally {
    try {
      await unlink(tmp)
    } catch {
      // Ignore cleanup errors, let original error propagate
    }
  }
}

function stableStringify(obj: unknown): string {
  if (obj === null) return 'null'
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`
  }
  const pairs: string[] = []
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  for (const key of keys) {
    const val = (obj as Record<string, unknown>)[key]
    pairs.push(`${JSON.stringify(key)}:${stableStringify(val)}`)
  }
  return `{${pairs.join(',')}}`
}

export function upsertRows<T extends { id: string }>(
  existing: T[],
  incoming: T[],
): { rows: T[]; added: number; updated: number } {
  const snapshot = new Map<string, string>()
  for (let i = 0; i < existing.length; i++) {
    const row = existing[i]
    if (row) snapshot.set(row.id, stableStringify(row))
  }
  const rows = [...existing]
  const index = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row) index.set(row.id, i)
  }
  for (const row of incoming) {
    const at = index.get(row.id)
    if (at === undefined) {
      index.set(row.id, rows.length)
      rows.push(row)
    } else {
      rows[at] = row
    }
  }
  let added = 0
  let updated = 0
  const finalIndex = new Map<string, string>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row) {
      const id = row.id
      const newStr = stableStringify(row)
      finalIndex.set(id, newStr)
      const oldStr = snapshot.get(id)
      if (oldStr === undefined) {
        added++
      } else if (oldStr !== newStr) {
        updated++
      }
    }
  }
  return { rows, added, updated }
}
