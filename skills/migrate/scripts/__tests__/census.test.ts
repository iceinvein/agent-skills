import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { balanceOf, boundsOf, validateCensus } from '../census.ts'
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
  directions: {
    ddl: { count: 43, evidence: 'rg -n "CREATE TABLE" schema.sql | wc -l' },
    orm: { count: 40, evidence: 'rg -n "\\[Table\\(" --type cs | wc -l' },
  },
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
    phase: 'enumerate',
    directions: {
      ddl: { count: 14, evidence: 'rg -n "CREATE TABLE" schema.sql | wc -l' },
      entity: { count: 13, evidence: 'rg -n "\\[Table\\(" --type cs | wc -l' },
    },
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
    phase: 'extract',
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
    phase: 'extract',
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
    phase: 'enumerate',
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
    phase: 'extract',
    probes: 4,
    found: 2,
    as_requirements: 1,
    queued: ['q-1.'],
    batch: 'b-3',
  }
  const closer = {
    kind: 'closer',
    closer: 'read-write-symmetry',
    phase: 'extract',
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

// Round 3: skipped's duplicate check and the cross-list check both compared
// raw element-name strings, so a case or whitespace variant on the skipped
// side defeated both (queued was already fixed in round 2, but skipped was
// left alone). Fixed by normalizing (trim + case-fold) for comparison only;
// the stored value is always the author's original text.

test('a case-variant duplicate skipped element is rejected', () => {
  const bad: Census = {
    ...LENS,
    total: 47,
    skipped: [
      { element: 'orders', reason: 'a' },
      { element: 'ORDERS', reason: 'b' },
    ],
  }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('orders')
})

test('a whitespace-variant duplicate skipped element is rejected', () => {
  const bad: Census = {
    ...LENS,
    total: 47,
    skipped: [
      { element: 'orders', reason: 'a' },
      { element: ' orders ', reason: 'b' },
    ],
  }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('orders')
})

test('cross-list padding is rejected even with a case-variant on the skipped side', () => {
  // queued is already canonicalized ('q-1'), so this specifically checks
  // that the skipped side is normalized before the two are compared.
  const bad: Census = {
    ...LENS,
    total: 47,
    queued: ['q-1'],
    skipped: [{ element: 'Q-1', reason: 'x' }],
  }
  const result = validateCensus(bad)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join(' ')).toContain('Q-1')
})

// Normalization must stop at trim + case-fold: it must not newly reject
// legitimate records, including ones whose element names differ only in
// punctuation (which is left alone deliberately, since punctuation can be
// load-bearing in a free-text element name).

test('punctuation-only variants of an element name are accepted as distinct, not deduped', () => {
  const ok: Census = {
    ...LENS,
    total: 48,
    skipped: [
      { element: 'orders', reason: 'framework-owned' },
      { element: 'orders.', reason: 'legacy typo, kept verbatim' },
    ],
    queued: ['q-table-ownership'],
  }
  const result = validateCensus(ok)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.value).toEqual(ok)
})

test('legitimate records still validate for all four kinds', () => {
  const lens = validateCensus({
    ...LENS,
    total: 48,
    skipped: [
      { element: 'orders', reason: 'framework-owned' },
      { element: 'orders.', reason: 'legacy typo, kept verbatim' },
    ],
    queued: ['q-table-ownership'],
  })
  expect(lens.ok).toBe(true)

  const attribute = validateCensus({
    kind: 'attribute',
    surface: 'tables',
    subject: 'table-roster-days',
    phase: 'enumerate',
    directions: {
      ddl: { count: 14, evidence: 'rg -n "CREATE TABLE" schema.sql | wc -l' },
      entity: { count: 13, evidence: 'rg -n "\\[Table\\(" --type cs | wc -l' },
    },
    total: 15,
    behavioral: 7,
    explained: 6,
    queued: ['q-ros-007'],
    batch: 'b-2',
  })
  expect(attribute.ok).toBe(true)

  const ruleSweep = validateCensus({
    kind: 'rule-sweep',
    subject: 'user-management',
    phase: 'extract',
    probes: 4,
    found: 2,
    as_requirements: 2,
    queued: [],
    batch: 'b-3',
  })
  expect(ruleSweep.ok).toBe(true)

  const closer = validateCensus({
    kind: 'closer',
    closer: 'read-write-symmetry',
    phase: 'extract',
    checked: 34,
    findings: 3,
    fixed: 2,
    queued: ['q-sym-001'],
    batch: 'b-4',
  })
  expect(closer.ok).toBe(true)
})

test('a rule-sweep census without a phase is rejected by name', () => {
  const result = validateCensus({
    kind: 'rule-sweep',
    subject: 'pricing',
    batch: 'b-rules-001',
    probes: 4,
    found: 2,
    as_requirements: 2,
    queued: [],
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors).toContain('phase is required')
})

// Fix round 1, Finding 2: `phase` was free text on every kind, but check.ts's
// run-state gate only ever looks for a lens census's batch in
// phases.enumerate.batches and a closer census's batch in
// phases.extract.batches, both hardcoded, never read off the record's own
// `phase`. A lens or closer record declaring any other phase could have
// census-cmd.ts commit its batch under that other phase and the gate would
// then report it as never committed, even though it was. validateCensus now
// rejects that mismatch at write time instead of leaving it for the gate to
// discover after the fact.

test('a lens census declaring a phase other than enumerate is rejected by name', () => {
  const result = validateCensus(lens({ phase: 'extract' }))
  expect(result.ok).toBe(false)
  if (!result.ok) {
    const joined = result.errors.join('\n')
    expect(joined).toContain('lens census must declare phase "enumerate"')
    expect(joined).toContain('found "extract"')
  }
})

test('a closer census declaring a phase other than extract is rejected by name', () => {
  const result = validateCensus({
    kind: 'closer',
    closer: 'read-write-symmetry',
    phase: 'enumerate',
    checked: 34,
    findings: 3,
    fixed: 2,
    queued: ['q-sym-001'],
    batch: 'b-4',
  })
  expect(result.ok).toBe(false)
  if (!result.ok) {
    const joined = result.errors.join('\n')
    expect(joined).toContain('closer census must declare phase "extract"')
    expect(joined).toContain('found "enumerate"')
  }
})

test('an attribute census may declare any phase, since the gate never cross-checks it against a batch list', () => {
  const result = validateCensus({
    kind: 'attribute',
    surface: 'tables',
    subject: 'table-roster-days',
    phase: 'seam',
    directions: {
      ddl: { count: 14, evidence: 'rg -n "CREATE TABLE" schema.sql | wc -l' },
      entity: { count: 13, evidence: 'rg -n "\\[Table\\(" --type cs | wc -l' },
    },
    total: 15,
    behavioral: 7,
    explained: 6,
    queued: ['q-ros-007'],
    batch: 'b-2',
  })
  expect(result.ok).toBe(true)
})

// Critical finding 1 (shared with import-cmd.ts and queue-cmd.ts): a store
// whose configured source.path resolves to include the store's own target
// path must not crash. assertNotUnderSource throws by design (writeRows's
// own contract, see store.test.ts); census-cmd.ts must catch that throw and
// report a clean diagnostic with a deliberate exit code instead of letting
// it escape as an uncaught stack trace. See the report for the full
// argument for exit code 2 over 1.

test('runCensus refuses to write when the store sits inside its own configured source tree, as a clean usage error (2), not a crash', async () => {
  await writeConfig(root, { sourcePath: root, scope: 'all', targetName: 'newapp' })
  const file = join(root, 'c.json')
  await writeFile(file, JSON.stringify(LENS))
  expect(await runCensus({ root, file })).toBe(2)
  expect(await readRows(storePaths(root).census)).toEqual([])
})

function lens(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'lens',
    surface: 'tables',
    phase: 'enumerate',
    directions: {
      ddl: { count: 43, evidence: 'rg -n "CREATE TABLE" schema.sql | wc -l' },
      orm: { count: 40, evidence: 'rg -n "\\[Table\\(" --type cs | wc -l' },
    },
    total: 45,
    in_ledger: 45,
    added: 0,
    skipped: [],
    queued: [],
    batch: 'b-tables-census-001',
    ...overrides,
  }
}

test('a well-formed two-direction record with evidence validates', () => {
  const result = validateCensus(lens())
  expect(result.ok).toBe(true)
})

test('a bare-count direction is rejected with the shape it needs', () => {
  const result = validateCensus(lens({ directions: { ddl: 43, orm: 40 } }))
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.errors.join('\n')).toContain('old bare-count shape')
    expect(result.errors.join('\n')).toContain('"count": 43')
  }
})

test('a direction with an empty evidence string is rejected by name', () => {
  const result = validateCensus(
    lens({
      directions: {
        ddl: { count: 43, evidence: 'rg CREATE TABLE' },
        orm: { count: 40, evidence: '   ' },
      },
    }),
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join('\n')).toContain('directions.orm.evidence is required')
})

test('a single direction is rejected against the lens contract', () => {
  const result = validateCensus(
    lens({ directions: { ddl: { count: 45, evidence: 'rg CREATE TABLE' } } }),
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.errors.join('\n')).toContain('at least two independent directions')
})

test('total below the largest direction count fails bounds', () => {
  const result = validateCensus(lens({ total: 40, in_ledger: 40 }))
  expect(result.ok).toBe(true)
  if (result.ok) {
    const message = boundsOf(result.value)
    expect(message).toContain('below the largest direction count 43')
  }
})

test('total above the sum of direction counts fails bounds', () => {
  const result = validateCensus(lens({ total: 90, in_ledger: 90 }))
  expect(result.ok).toBe(true)
  if (result.ok) {
    const message = boundsOf(result.value)
    expect(message).toContain('exceeds the 83 findings')
  }
})

test('total exactly at each bound passes', () => {
  for (const total of [43, 83]) {
    const result = validateCensus(lens({ total, in_ledger: total }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(boundsOf(result.value)).toBeNull()
  }
})

test('bounds apply to attribute records too', () => {
  const result = validateCensus({
    kind: 'attribute',
    surface: 'tables',
    subject: 'users',
    phase: 'enumerate',
    directions: {
      schema: { count: 12, evidence: 'psql \\d users' },
      code: { count: 9, evidence: 'rg "users\\." --type cs' },
    },
    total: 30,
    behavioral: 8,
    explained: 8,
    queued: [],
    batch: 'b-users-attr-001',
  })
  expect(result.ok).toBe(true)
  if (result.ok) expect(boundsOf(result.value)).toContain('exceeds the 21 findings')
})

test('bounds say nothing about kinds that carry no directions', () => {
  const result = validateCensus({
    kind: 'closer',
    closer: 'scope-injection',
    phase: 'extract',
    batch: 'b-closer-001',
    checked: 3,
    findings: 0,
    fixed: 0,
    queued: [],
  })
  expect(result.ok).toBe(true)
  if (result.ok) expect(boundsOf(result.value)).toBeNull()
})

// Review round 1, Finding 3: the two-direction minimum is counted on the raw
// keys of the input object, before any entry is filtered out for being
// malformed. Pinned here so a future refactor that switches to counting the
// validated output map instead cannot silently regress this: a record with
// one valid direction and one bare-count direction must still be rejected,
// and specifically for the bare-count shape, not for a spurious "needs at
// least two directions" message that would imply the fix is counting the
// wrong thing.
test('one valid direction plus one malformed direction is rejected for the malformed one, not treated as short of two', () => {
  const result = validateCensus(
    lens({
      directions: {
        ddl: { count: 43, evidence: 'rg -n "CREATE TABLE" schema.sql | wc -l' },
        orm: 40,
      },
    }),
  )
  expect(result.ok).toBe(false)
  if (!result.ok) {
    const joined = result.errors.join('\n')
    expect(joined).toContain('old bare-count shape')
    expect(joined).not.toContain('at least two independent directions')
  }
})

// Review round 1, Finding 1b: boundsOf's own type signature promises
// record.directions is well-formed, but a hand-edited census.jsonl can put
// anything there, and this function is the last line of defense once
// check.ts's gate-time validation exists (a future caller could always skip
// that and call boundsOf directly). Object.values(...).map(d => d.count) on
// a bare number silently produces undefined, and Math.max/reduce on
// undefined produce NaN, against which every comparison is false, so the
// bug this pins is a false negative: total 999 must never be judged "in
// bounds" just because one direction was malformed.
test('boundsOf names a malformed direction instead of silently treating it as in bounds', () => {
  const malformed = {
    kind: 'lens',
    surface: 'tables',
    phase: 'enumerate',
    directions: { ddl: 43, orm: { count: 40, evidence: 'rg -n "\\[Table\\(" --type cs' } },
    total: 999,
    in_ledger: 999,
    added: 0,
    skipped: [],
    queued: [],
    batch: 'b-1',
  } as unknown as Census
  const message = boundsOf(malformed)
  expect(message).toContain('ddl')
})

// Review round 1, Finding 2: all nine bounds tests above call validateCensus
// and boundsOf directly; none drives a bounds-violating record through the
// real command path, so census-cmd.ts's own
// `balanceOf(result.value) ?? boundsOf(result.value)` line has never been
// exercised end to end. This closes that gap for the exit code and the
// stderr message together.
test('runCensus refuses a record whose total is out of bounds, on stderr, as an operation failure (1)', async () => {
  const file = join(root, 'out-of-bounds.json')
  await writeFile(file, JSON.stringify(lens({ total: 90, in_ledger: 90 })))
  const original = process.stderr.write.bind(process.stderr)
  const out: string[] = []
  process.stderr.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stderr.write
  let code: number
  try {
    code = await runCensus({ root, file })
  } finally {
    process.stderr.write = original
  }
  expect(code).toBe(1)
  expect(out.join('')).toContain('exceeds the 83 findings')
  expect(await readRows(storePaths(root).census)).toEqual([])
})
