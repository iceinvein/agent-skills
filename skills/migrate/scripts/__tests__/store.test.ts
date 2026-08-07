import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRawRows, readRows, upsertRows, writeRows } from '../store.ts'

let root: string
const NO_SOURCE = '/nonexistent-source'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-store-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('readRows returns empty for a missing file', async () => {
  expect(await readRows(join(root, 'nope.jsonl'))).toEqual([])
})

test('write then read round-trips and ignores blank lines', async () => {
  const path = join(root, 'x.jsonl')
  await writeRows(
    path,
    [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
    ],
    NO_SOURCE,
  )
  const text = await readFile(path, 'utf8')
  expect(text.endsWith('\n')).toBe(true)
  expect(await readRows(path)).toEqual([
    { id: 'a', n: 1 },
    { id: 'b', n: 2 },
  ])
})

test('readRows names the offending line on malformed JSON', async () => {
  const path = join(root, 'bad.jsonl')
  await writeFile(path, '{"id":"a"}\nnot json\n')
  await expect(readRows(path)).rejects.toThrow(/line 2/)
})

// readRawRows is readRows's own foundation now, but check.ts is the only
// caller that needs the line number rather than just the parsed value, so
// this pins that contract directly instead of leaving it to be exercised
// only indirectly through check.ts's gate tests. A blank line shifts every
// line number after it, which is exactly the case a 1-based index computed
// from the filtered array (rather than the original split) would get wrong.
test('readRawRows pairs each parsed value with its 1-based line number, including across a blank line', async () => {
  const path = join(root, 'y.jsonl')
  await writeFile(path, '{"id":"a"}\n\n{"id":"b"}\n')
  expect(await readRawRows(path)).toEqual([
    { line: 1, raw: { id: 'a' } },
    { line: 3, raw: { id: 'b' } },
  ])
})

test('readRawRows returns empty for a missing file', async () => {
  expect(await readRawRows(join(root, 'nope.jsonl'))).toEqual([])
})

test('upsertRows replaces by id in place and counts', () => {
  const existing = [
    { id: 'a', n: 1 },
    { id: 'b', n: 2 },
  ]
  const result = upsertRows(existing, [
    { id: 'b', n: 99 },
    { id: 'c', n: 3 },
  ])
  expect(result.rows).toEqual([
    { id: 'a', n: 1 },
    { id: 'b', n: 99 },
    { id: 'c', n: 3 },
  ])
  expect(result.added).toBe(1)
  expect(result.updated).toBe(1)
})

test('re-importing an identical batch is idempotent', () => {
  const batch = [{ id: 'a', n: 1 }]
  const once = upsertRows([], batch)
  const twice = upsertRows(once.rows, batch)
  expect(twice.rows).toEqual(once.rows)
  expect(twice.added).toBe(0)
})

test('writeRows refuses a path inside the source tree', async () => {
  const source = join(root, 'legacy')
  await expect(writeRows(join(source, 'x.jsonl'), [], source)).rejects.toThrow(/source/)
})

test('upsertRows handles repeated ids in incoming batch', () => {
  const existing = [{ id: 'a', n: 0 }]
  const result = upsertRows(existing, [
    { id: 'a', n: 1 },
    { id: 'a', n: 2 },
  ])
  expect(result.rows).toEqual([{ id: 'a', n: 2 }])
  expect(result.added).toBe(0)
  expect(result.updated).toBe(1)
})

test('updated count is insensitive to key order', () => {
  const existing = [{ id: 'a', x: 1, y: 2 }]
  const result = upsertRows(existing, [{ id: 'a', y: 2, x: 1 }])
  expect(result.rows).toEqual([{ id: 'a', y: 2, x: 1 }])
  expect(result.added).toBe(0)
  expect(result.updated).toBe(0)
})

test('concurrent writes to same path do not collide', async () => {
  const path = join(root, 'concurrent.jsonl')
  await Promise.all([
    writeRows(path, [{ id: 'a', n: 1 }], NO_SOURCE),
    writeRows(path, [{ id: 'b', n: 2 }], NO_SOURCE),
  ])
  const rows = await readRows(path)
  expect(rows.length).toBe(1)
})

test('writeRows cleans up temp file on failure', async () => {
  const dir = join(root, 'target-dir')
  await mkdir(dir)
  await expect(writeRows(dir, [{ id: 'a', n: 1 }], NO_SOURCE)).rejects.toThrow()
  const files = await readdir(root)
  const tmpFiles = files.filter((f) => f.endsWith('.tmp'))
  expect(tmpFiles.length).toBe(0)
})
