import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
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
  const tmp = `${path}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, path)
}

export function upsertRows<T extends { id: string }>(
  existing: T[],
  incoming: T[],
): { rows: T[]; added: number; updated: number } {
  const rows = [...existing]
  const index = new Map<string, number>()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row) index.set(row.id, i)
  }
  let added = 0
  let updated = 0
  for (const row of incoming) {
    const at = index.get(row.id)
    if (at === undefined) {
      index.set(row.id, rows.length)
      rows.push(row)
      added++
    } else {
      const before = rows[at]
      rows[at] = row
      if (JSON.stringify(before) !== JSON.stringify(row)) updated++
    }
  }
  return { rows, added, updated }
}
