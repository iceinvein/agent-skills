import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCheck } from '../check.ts'
import { writeConfig } from '../config.ts'
import { storePaths } from '../paths.ts'
import { savePhases } from '../phases.ts'
import { writeRows } from '../store.ts'
import type { Census, Element, Requirement } from '../types.ts'

let root: string
let source: string

const SURFACES = ['routes', 'tables']

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-check-'))
  source = join(root, 'legacy')
  await mkdir(join(root, '.migrate', 'queue'), { recursive: true })
  await mkdir(source, { recursive: true })
  await writeConfig(root, { sourcePath: source, scope: 'all', targetName: 'newapp' })
  // Narrow the declared sets so the fixture only has to satisfy two surfaces
  // and no closers.
  const cfgPath = storePaths(root).config
  const text = await Bun.file(cfgPath).text()
  await writeFile(
    cfgPath,
    text
      .replace(/^types = .*$/m, `types = ${JSON.stringify(SURFACES)}`)
      .replace(/^set = .*$/m, 'set = []'),
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const ELEMENT: Element = {
  id: 'route-get-api-users',
  surface: 'routes',
  element: 'GET /api/users',
  found_by: ['code'],
  disposition: { kind: 'mapped', fr: 'UM-001' },
  refs: [],
  lens: 'code',
  batch: 'b-1',
  notes: '',
}

const REQUIREMENT: Requirement = {
  id: 'UM-001',
  cap: 'user-management',
  requirement: 'List users',
  actors: 'User',
  objects: 'User',
  rules: '-',
  origin: 'intended',
  confidence: { kind: 'confirmed' },
  citations: [{ kind: 'ledger', id: 'route-get-api-users' }],
  parity: { kind: 'rubric', level: 'high' },
  batch: 'b-1',
}

function lensCensus(surface: string, total: number, inLedger: number): Census {
  return {
    kind: 'lens',
    surface,
    phase: 'enumerate',
    directions: { code: total },
    total,
    in_ledger: inLedger,
    added: 0,
    skipped: [],
    queued: [],
    batch: 'b-1',
  }
}

async function seedClean(): Promise<void> {
  const p = storePaths(root)
  await writeRows(p.elements, [ELEMENT], source)
  await writeRows(p.requirements, [REQUIREMENT], source)
  await writeRows(
    p.capabilities,
    [{ slug: 'user-management', title: 'Users', ns: 'UM', elements: [] }],
    source,
  )
  await writeRows(p.census, [lensCensus('routes', 1, 1), lensCensus('tables', 0, 0)], source)
}

// The run-state gate now checks whether the run actually happened, so a
// store seeded by writeRows alone (bypassing import/census's recordBatch)
// carries no evidence that probe or enumerate ran. Advancing phase state
// directly with savePhases (rather than via the CLI, since this suite talks
// to runCheck's own API) and bounding the check at --phase enumerate keeps
// this test about the nine other gates: it only has to prove enough phase
// history exists for run-state to agree the census batch it seeded was
// committed, not simulate the rest of a Milestone 2 run this fixture never
// performs.
async function markThroughEnumerate(): Promise<void> {
  await savePhases(
    root,
    {
      probe: { status: 'done', batches: [], pending: [] },
      enumerate: { status: 'done', batches: [{ id: 'b-1', count: 1 }], pending: [] },
      seam: { status: 'pending', batches: [], pending: [] },
      extract: { status: 'pending', batches: [], pending: [] },
      parity: { status: 'pending', batches: [], pending: [] },
      queue: { status: 'pending', batches: [], pending: [] },
      adjudicate: { status: 'pending', batches: [], pending: [] },
      handoff: { status: 'pending', batches: [], pending: [] },
    },
    source,
  )
}

test('a clean store passes with the summary line', async () => {
  await seedClean()
  await markThroughEnumerate()
  const result = await runCheck({ root, phase: 'enumerate' })
  expect(result.violations).toEqual([])
  expect(result.summary).toBe('1/1 mapped, 0 out-of-scope, 0 unaccounted')
})

test('an unaccounted element is a coverage violation naming its id', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).elements,
    [{ ...ELEMENT, disposition: { kind: 'unaccounted' } }],
    source,
  )
  const result = await runCheck({ root })
  expect(result.summary).toBe('0/1 mapped, 0 out-of-scope, 1 unaccounted')
  const coverage = result.violations.filter((v) => v.gate === 'coverage')
  expect(coverage).toHaveLength(1)
  expect(coverage[0]?.message).toContain('route-get-api-users')
})

// Important finding 2: balanceOf only checks a census record's own numbers
// against each other; nothing tied in_ledger + added to elements.jsonl
// itself, so a lens record could claim any in_ledger/added split it liked
// as long as it balanced internally. `total` is self-reported and cannot be
// checked against anything, but in_ledger + added is a concrete claim about
// how many rows now exist in the ledger for that surface, and that claim is
// directly countable against elements.jsonl.
test('a lens census claiming elements that were never added to the ledger is a census violation', async () => {
  await seedClean()
  // Balances on its own (50 = 50 + 0 + 0 + 0) but elements.jsonl holds zero
  // rows for 'tables': the padding surface the report describes verbatim.
  await writeRows(
    storePaths(root).census,
    [lensCensus('routes', 1, 1), { ...lensCensus('tables', 50, 50) }],
    source,
  )
  const result = await runCheck({ root })
  const census = result.violations.filter((v) => v.gate === 'census')
  expect(census).toHaveLength(1)
  expect(census[0]?.message).toContain('tables')
  expect(census[0]?.message).toContain('50')
})

test('a lens census whose in_ledger + added matches the real ledger count passes', async () => {
  await seedClean()
  // routes: in_ledger 1 + added 0 = 1, and exactly one 'routes' element
  // exists in the seeded store, so this must not be flagged.
  const result = await runCheck({ root })
  const census = result.violations.filter((v) => v.gate === 'census')
  expect(census).toEqual([])
})

test('a declared surface with no census record is a census violation', async () => {
  await seedClean()
  await writeRows(storePaths(root).census, [lensCensus('routes', 1, 1)], source)
  const result = await runCheck({ root })
  const census = result.violations.filter((v) => v.gate === 'census')
  expect(census).toHaveLength(1)
  expect(census[0]?.message).toContain('tables')
})

test('a mapped disposition pointing at no requirement is a refs violation', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).elements,
    [{ ...ELEMENT, disposition: { kind: 'mapped', fr: 'UM-999' } }],
    source,
  )
  const result = await runCheck({ root })
  const refs = result.violations.filter((v) => v.gate === 'refs')
  expect(refs.some((v) => v.message.includes('UM-999'))).toBe(true)
})

test('a queued confidence with no queue file is a refs violation', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).requirements,
    [{ ...REQUIREMENT, confidence: { kind: 'queued', queue: 'q-missing' }, parity: null }],
    source,
  )
  const result = await runCheck({ root })
  expect(result.violations.some((v) => v.gate === 'refs' && v.message.includes('q-missing'))).toBe(
    true,
  )
})

test('a requirement with no parity plan is a parity violation', async () => {
  await seedClean()
  await writeRows(storePaths(root).requirements, [{ ...REQUIREMENT, parity: null }], source)
  const result = await runCheck({ root })
  expect(result.violations.some((v) => v.gate === 'parity' && v.message.includes('UM-001'))).toBe(
    true,
  )
})

test('an unsigned delta is a deltas violation', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).deltas,
    [
      {
        id: 'delta-multi-tenancy',
        scope: 'all tables',
        rationale: 'SaaS',
        parity_exclusion: 'ignore tenant id',
        validation: 'leak tests',
        owner_signed: null,
        batch: 'b-1',
      },
    ],
    source,
  )
  const result = await runCheck({ root })
  expect(
    result.violations.some((v) => v.gate === 'deltas' && v.message.includes('delta-multi-tenancy')),
  ).toBe(true)
})

test('citations run by default and are only skipped when explicitly disabled', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).requirements,
    [{ ...REQUIREMENT, citations: [{ kind: 'src', path: 'Ghost.cs' }] }],
    source,
  )
  const byDefault = await runCheck({ root })
  expect(byDefault.violations.some((v) => v.gate === 'citations')).toBe(true)
  const disabled = await runCheck({ root, citations: false })
  expect(disabled.violations.filter((v) => v.gate === 'citations')).toEqual([])
})

test('a dirty source checkout is a source violation', async () => {
  await seedClean()
  await Bun.spawn(['git', 'init', '-q'], { cwd: source }).exited
  await writeFile(join(source, 'dirty.txt'), 'uncommitted\n')
  const result = await runCheck({ root })
  expect(result.violations.some((v) => v.gate === 'source')).toBe(true)
})

// Review round: the refs gate must catch duplicate identities on its own,
// not assume some other gate (or another command) already ruled them out.
// `capabilities.jsonl` in particular has no import path at all yet, so
// hand-editing is currently the only way a row lands there, making a
// duplicate slug directly reachable today, not a hypothetical.

test('two requirements sharing an id both survive but are flagged as a refs violation naming the id and count', async () => {
  await seedClean()
  const dup: Requirement = { ...REQUIREMENT, requirement: 'List users, second copy' }
  await writeRows(storePaths(root).requirements, [REQUIREMENT, dup], source)
  const result = await runCheck({ root })
  const refs = result.violations.filter((v) => v.gate === 'refs')
  expect(
    refs.some((v) => v.message.includes('UM-001') && v.message.includes('appears 2 times')),
  ).toBe(true)
})

test('two capabilities sharing a slug are flagged as a refs violation naming the slug and count', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).capabilities,
    [
      { slug: 'user-management', title: 'Users', ns: 'UM', elements: [] },
      { slug: 'user-management', title: 'Users (duplicate)', ns: 'UM', elements: [] },
    ],
    source,
  )
  const result = await runCheck({ root })
  const refs = result.violations.filter((v) => v.gate === 'refs')
  expect(
    refs.some(
      (v) => v.message.includes('user-management') && v.message.includes('appears 2 times'),
    ),
  ).toBe(true)
})

test('two elements sharing an id are flagged as a refs violation naming the id and count', async () => {
  await seedClean()
  const dup: Element = { ...ELEMENT, element: 'GET /api/users, second copy' }
  await writeRows(storePaths(root).elements, [ELEMENT, dup], source)
  const result = await runCheck({ root })
  const refs = result.violations.filter((v) => v.gate === 'refs')
  expect(
    refs.some(
      (v) => v.message.includes('route-get-api-users') && v.message.includes('appears 2 times'),
    ),
  ).toBe(true)
})

test('ids that merely share a prefix are not confused with duplicates', async () => {
  await seedClean()
  const other: Requirement = {
    ...REQUIREMENT,
    id: 'UM-0010',
    citations: [{ kind: 'ledger', id: 'route-get-api-users' }],
  }
  await writeRows(storePaths(root).requirements, [REQUIREMENT, other], source)
  const result = await runCheck({ root })
  expect(result.violations.filter((v) => v.gate === 'refs')).toEqual([])
})

test('two citations of the same missing queue id on one requirement produce two distinguishable refs violations', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).requirements,
    [
      {
        ...REQUIREMENT,
        confidence: { kind: 'queued', queue: 'q-missing' },
        parity: { kind: 'rubric', level: 'moderate', queue: 'q-missing' },
      },
    ],
    source,
  )
  const result = await runCheck({ root })
  const refs = result.violations.filter((v) => v.gate === 'refs' && v.message.includes('q-missing'))
  expect(refs).toHaveLength(2)
  // Not deduplicated: both citations are real and both need fixing, so the
  // two violations must remain distinct entries with distinct messages,
  // each naming which field it came from.
  expect(new Set(refs.map((v) => v.message)).size).toBe(2)
  expect(refs.some((v) => v.message.includes('confidence.queue'))).toBe(true)
  expect(refs.some((v) => v.message.includes('parity.queue'))).toBe(true)
})
