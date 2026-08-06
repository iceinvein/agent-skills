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
  // A null row is not shaped like a census record at all (no envelope exists
  // to distinguish this from the balance check the way import-cmd.ts's
  // {batch, phase, rows} envelope does), so this is a usage error (2), not
  // an operation failure (1).
  expect(await runCensus({ root, file })).toBe(2)
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

// Finding 1: skipped and queued are counted by .length, so a duplicate entry
// pads the balance arithmetic without changing anything real. A duplicate
// must be refused, not silently deduped, and never allowed to make an
// otherwise-imbalanced record look balanced.

test('a duplicate queued id is rejected even though it would make the sum balance', () => {
  // in_ledger 44 + added 1 + skipped 0 + queued.length 2 = 47 = total: this
  // would pass balanceOf's arithmetic if the duplicate were silently counted.
  const padded: Census = { ...LENS, total: 47, queued: ['q-1', 'q-1'] }
  const result = validateCensus(padded)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('q-1')
})

test('a duplicate skipped element is rejected even though it would make the sum balance', () => {
  const padded: Census = {
    ...LENS,
    total: 47,
    skipped: [
      { element: 'X', reason: 'a' },
      { element: 'X', reason: 'b' },
    ],
  }
  const result = validateCensus(padded)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('X')
})

test('runCensus refuses a record padded with a duplicate queued id', async () => {
  const file = join(root, 'padded.json')
  const padded = { ...LENS, total: 47, queued: ['q-1', 'q-1'] }
  await writeFile(file, JSON.stringify(padded))
  expect(await runCensus({ root, file })).toBe(2)
  expect(await readRows(storePaths(root).census)).toEqual([])
})

// Finding 2: list() only checked that skipped/queued were arrays, never that
// their elements matched Skipped / string. Each element must be validated,
// naming the offending index.

test('a skipped entry that is not an object is rejected, naming the index', () => {
  const bad = { ...LENS, skipped: ['not-an-object'] }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('skipped[0]')
})

test('a skipped entry missing a reason is rejected, naming the index', () => {
  const bad = { ...LENS, skipped: [{ element: 'foo' }] }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('skipped[0]')
})

test('a queued entry that is not a string is rejected, naming the index', () => {
  const bad = { ...LENS, queued: [123] }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('queued[0]')
})

// Finding 3: a shape failure (missing/mistyped fields, unknown kind, a
// duplicate) is a usage error (2); only a balance failure on an otherwise
// well-formed record is an operation failure (1). The two must be
// distinguishable without parsing stderr text.

test('a record missing required fields is a usage error (2), not an operation failure', async () => {
  const file = join(root, 'incomplete.json')
  await writeFile(file, JSON.stringify({ kind: 'lens' }))
  expect(await runCensus({ root, file })).toBe(2)
  expect(await readRows(storePaths(root).census)).toEqual([])
})

test('a well-formed but unbalanced record is an operation failure (1), not a usage error', async () => {
  const file = join(root, 'unbalanced.json')
  await writeFile(file, JSON.stringify({ ...LENS, total: 99 }))
  expect(await runCensus({ root, file })).toBe(1)
  expect(await readRows(storePaths(root).census)).toEqual([])
})

// Finding 4: validateCensus's own error strings must not carry a 'census: '
// prefix, since runCensus prepends one when printing; a message that was
// already prefixed produced 'census: census: ...' on a real CLI run.

test('validateCensus error messages are not pre-prefixed with census:', () => {
  const result = validateCensus(null)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    for (const e of result.errors) expect(e.startsWith('census:')).toBe(false)
  }
})

// Finding 1, round 2: exact-string uniqueness was defeated by cosmetically
// distinct but semantically identical entries (wrong case, a trailing
// space, trailing punctuation), and cross-list padding (the same value
// reused in both queued and skipped) was never checked at all. Queue ids
// are now validated against a real format (ids.ts's isValidSlug) instead of
// merely checked pairwise for uniqueness, so a cosmetic variant is rejected
// on its own merits rather than needing to be recognized as a duplicate.

test('an uppercase queued id is rejected as malformed, not treated as a fresh distinct id', () => {
  const bad = { ...LENS, total: 46, queued: ['Q-1'] }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('queued[0]')
})

test('a queued id with trailing whitespace is rejected, not silently trimmed and accepted', () => {
  const bad = { ...LENS, total: 46, queued: ['q-1 '] }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('queued[0]')
})

test('a queued id with trailing punctuation is rejected as malformed', () => {
  const bad = { ...LENS, total: 46, queued: ['q-1.'] }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('queued[0]')
})

test('a repeated well-formed queued id is rejected as a duplicate', () => {
  const bad = { ...LENS, total: 47, queued: ['q-table-ownership', 'q-table-ownership'] }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('q-table-ownership')
})

test('cross-list padding: the same value in both queued and skipped is rejected', () => {
  // in_ledger 44 + added 1 + skipped.length 1 + queued.length 1 = 47 = total:
  // this would balance if the shared value 'q-1' were allowed to pad both
  // lists at once.
  const bad: Census = {
    ...LENS,
    total: 47,
    queued: ['q-1'],
    skipped: [{ element: 'q-1', reason: 'x' }],
  }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('q-1')
})

test('queued id format validation applies to attribute, rule-sweep and closer, not only lens', () => {
  const attribute = {
    kind: 'attribute',
    surface: 'tables',
    subject: 'table-roster-days',
    directions: {},
    total: 15,
    behavioral: 7,
    explained: 6,
    queued: ['Q-1'],
    batch: 'b-2',
  }
  const ruleSweep = {
    kind: 'rule-sweep',
    subject: 'user-management',
    probes: 4,
    found: 2,
    as_requirements: 1,
    queued: ['q-1.'],
    batch: 'b-3',
  }
  const closer = {
    kind: 'closer',
    closer: 'read-write-symmetry',
    checked: 34,
    findings: 3,
    fixed: 2,
    queued: ['q-1 '],
    batch: 'b-4',
  }
  for (const bad of [attribute, ruleSweep, closer]) {
    const result = validateCensus(bad)
    expect(result.ok).toBe(false)
  }
})
