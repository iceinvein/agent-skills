import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCheck } from '../check.ts'
import { writeConfig } from '../config.ts'
import { storePaths } from '../paths.ts'
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

test('a clean store passes with the summary line', async () => {
  await seedClean()
  const result = await runCheck({ root })
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

test('citations are only resolved when asked', async () => {
  await seedClean()
  await writeRows(
    storePaths(root).requirements,
    [{ ...REQUIREMENT, citations: [{ kind: 'src', path: 'Ghost.cs' }] }],
    source,
  )
  expect((await runCheck({ root })).violations.filter((v) => v.gate === 'citations')).toEqual([])
  const withCitations = await runCheck({ root, citations: true })
  expect(withCitations.violations.some((v) => v.gate === 'citations')).toBe(true)
})

test('a dirty source checkout is a source violation', async () => {
  await seedClean()
  await Bun.spawn(['git', 'init', '-q'], { cwd: source }).exited
  await writeFile(join(source, 'dirty.txt'), 'uncommitted\n')
  const result = await runCheck({ root })
  expect(result.violations.some((v) => v.gate === 'source')).toBe(true)
})
