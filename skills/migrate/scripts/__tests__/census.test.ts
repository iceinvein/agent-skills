import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { balanceOf, validateCensus } from '../census.ts'
import { runCensus } from '../census-cmd.ts'
import { writeConfig } from '../config.ts'
import { storePaths } from '../paths.ts'
import { readRows } from '../store.ts'
import type { Census } from '../types.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-census-'))
  await mkdir(join(root, '.migrate'), { recursive: true })
  await writeConfig(root, { sourcePath: join(root, 'legacy'), scope: 'all', targetName: 'newapp' })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const LENS: Census = {
  kind: 'lens',
  surface: 'tables',
  phase: 'enumerate',
  directions: { ddl: 43, orm: 40 },
  total: 45,
  in_ledger: 44,
  added: 1,
  skipped: [],
  queued: [],
  batch: 'b-1',
}

test('a balanced lens census passes', () => {
  expect(balanceOf(LENS)).toBeNull()
})

test('an unbalanced lens census names the arithmetic', () => {
  const msg = balanceOf({ ...LENS, total: 46 })
  expect(msg).toContain('46')
  expect(msg).toContain('tables')
})

test('skipped and queued count toward the lens total', () => {
  const balanced: Census = {
    ...LENS,
    total: 47,
    skipped: [{ element: '__EFMigrationsHistory', reason: 'framework-owned' }],
    queued: ['q-table-ownership'],
  }
  expect(balanceOf(balanced)).toBeNull()
})

test('attribute balance is explained plus queued equals behavioral', () => {
  const base: Census = {
    kind: 'attribute',
    surface: 'tables',
    subject: 'table-roster-days',
    directions: { ddl: 14, entity: 13 },
    total: 15,
    behavioral: 7,
    explained: 6,
    queued: ['q-ros-007'],
    batch: 'b-2',
  }
  expect(balanceOf(base)).toBeNull()
  expect(balanceOf({ ...base, explained: 5 })).toContain('behavioral')
})

test('rule-sweep balance is found equals requirements plus queued', () => {
  const base: Census = {
    kind: 'rule-sweep',
    subject: 'user-management',
    probes: 4,
    found: 2,
    as_requirements: 2,
    queued: [],
    batch: 'b-3',
  }
  expect(balanceOf(base)).toBeNull()
  expect(balanceOf({ ...base, found: 3 })).toContain('found')
})

test('closer balance is findings equals fixed plus queued', () => {
  const base: Census = {
    kind: 'closer',
    closer: 'read-write-symmetry',
    checked: 34,
    findings: 3,
    fixed: 2,
    queued: ['q-sym-001'],
    batch: 'b-4',
  }
  expect(balanceOf(base)).toBeNull()
  expect(balanceOf({ ...base, fixed: 1 })).toContain('findings')
})

test('runCensus refuses to record an unbalanced record', async () => {
  const file = join(root, 'c.json')
  await writeFile(file, JSON.stringify({ ...LENS, total: 99 }))
  expect(await runCensus({ root, file })).toBe(1)
  expect(await readRows(storePaths(root).census)).toEqual([])
})

test('runCensus records a balanced record', async () => {
  const file = join(root, 'c.json')
  await writeFile(file, JSON.stringify(LENS))
  expect(await runCensus({ root, file })).toBe(0)
  expect(await readRows<Census>(storePaths(root).census)).toHaveLength(1)
})

test('re-recording the same subject replaces its record rather than stacking', async () => {
  const file = join(root, 'c.json')
  await writeFile(file, JSON.stringify(LENS))
  expect(await runCensus({ root, file })).toBe(0)
  const updated: Census = { ...LENS, in_ledger: 43, added: 2 }
  await writeFile(file, JSON.stringify(updated))
  expect(await runCensus({ root, file })).toBe(0)
  const rows = await readRows<Census>(storePaths(root).census)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toEqual(updated)
})

// Correction 1: a null, non-object, string, number or array row must come
// back from validateCensus as a normal { ok: false, errors } result and must
// never throw. Task 7's validate.ts hit this exact defect with a null row
// dumping a raw stack trace; census.ts must not repeat it.

test('validateCensus rejects a null row instead of throwing', () => {
  const result = validateCensus(null)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateCensus rejects a string row instead of throwing', () => {
  const result = validateCensus('not a row')
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateCensus rejects a number row instead of throwing', () => {
  const result = validateCensus(42)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('validateCensus rejects an array row instead of throwing', () => {
  const result = validateCensus([1, 2, 3])
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('object')
})

test('runCensus refuses a file whose top-level JSON is null, not thrown', async () => {
  const file = join(root, 'null.json')
  await writeFile(file, 'null')
  expect(await runCensus({ root, file })).toBe(1)
  expect(await readRows(storePaths(root).census)).toEqual([])
})

// Correction 2: a missing or unparseable census file must produce a clean
// diagnostic and exit code 2 via store.ts's readJsonFile, never an uncaught
// JSON.parse/readFile stack trace.

test('runCensus reports a missing file as a clean usage error', async () => {
  const file = join(root, 'does-not-exist.json')
  expect(await runCensus({ root, file })).toBe(2)
  expect(await readRows(storePaths(root).census)).toEqual([])
})

test('runCensus reports a malformed JSON file as a clean usage error', async () => {
  const file = join(root, 'malformed.json')
  await writeFile(file, '{ this is not json')
  expect(await runCensus({ root, file })).toBe(2)
  expect(await readRows(storePaths(root).census)).toEqual([])
})
