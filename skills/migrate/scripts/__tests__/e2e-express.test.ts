import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')
const FIXTURE = join(import.meta.dir, '..', '..', 'fixtures', 'tiny-express')

let target: string
let source: string

async function migrate(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd: target, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? -1, out, err }
}

async function write(name: string, value: unknown): Promise<string> {
  const path = join(target, name)
  await writeFile(path, JSON.stringify(value))
  return path
}

async function writeText(name: string, text: string): Promise<string> {
  const path = join(target, name)
  await writeFile(path, text)
  return path
}

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), 'migrate-e2e-express-'))
  source = join(target, 'legacy')
  await cp(FIXTURE, source, { recursive: true })
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

// GROUND-TRUTH.md is the single source of what this fixture contains. Reading
// and parsing it here, rather than hand-copying its rows into this file, is
// the point: a row added to the fixture without a matching update here (or
// vice versa) cannot silently drift, because the batches below are built from
// whatever the table on disk actually says.
type GroundTruthRow = { surface: string; id: string; element: string }

async function parseGroundTruth(path: string): Promise<GroundTruthRow[]> {
  const text = await readFile(path, 'utf8')
  const rows: GroundTruthRow[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())
    if (cells.length !== 3) continue
    const surface = cells[0] ?? ''
    const id = cells[1] ?? ''
    const element = cells[2] ?? ''
    if (surface === 'surface' && id === 'id') continue // header row
    if (cells.every((c) => /^-+$/.test(c))) continue // separator row
    rows.push({ surface, id, element })
  }
  return rows
}

function groupBySurface(rows: GroundTruthRow[]): Map<string, GroundTruthRow[]> {
  const groups = new Map<string, GroundTruthRow[]>()
  for (const row of rows) {
    const list = groups.get(row.surface) ?? []
    list.push(row)
    groups.set(row.surface, list)
  }
  return groups
}

// Express has no recipe pack in references/recipes/ (only aspnet.md exists),
// so enumerate.md's contract-only mode applies: two independently-derived
// directions per surface, supplied by the agent instead of a recipe file.
// Both directions below find exactly the fixture's own elements, since this
// is a fixture small enough that a real agent's two directions would too.
// Every evidence string below names a command actually re-run against the
// fixture (not merely a plausible-sounding description) to confirm it
// produces the count this surface's rows carry; nothing downstream executes
// these strings, so an unverified one would sit undetected the same way a
// stale src citation's line range does.
//
// Six of the eight (routes, jobs, reports, screens, integrations, workflows)
// have both directions read the same single file; only tables and settings
// cross-reference a second one. That is a property of a fixture this small,
// not evidence of stronger independent triangulation than it actually
// carries, and nobody should cite it as the latter.
const DIRECTIONS: Record<string, [string, string]> = {
  routes: ['grep "app.(get|post)" across app.js', 'manual walk of route registrations in app.js'],
  tables: [
    'grep "CREATE TABLE" across schema.sql',
    'manual review of table names referenced in app.js, cron.js and reports/',
  ],
  jobs: ['grep "cron.schedule" across cron.js', 'manual review of cron.js'],
  reports: ['ls reports/*.json', 'manual review of report definitions under reports/'],
  screens: ['ls views/*.html', 'manual review of templates under views/'],
  integrations: ['grep "fetch(" across app.js', 'manual review of outbound HTTP calls in app.js'],
  workflows: [
    'manual review of state stored and later consumed across app.js handlers',
    'grep "pendingWelcomes" across app.js',
  ],
  settings: [
    'grep "settings\\." across app.js, excluding the require line',
    'manual review of settings.json keys',
  ],
}

const QUEUE_ID = 'q-tiny-express-enumerate-scaffold'

const QUEUE_ITEM = `---
id: ${QUEUE_ID}
severity: minor
status: open
---

## Evidence

This run only drives probe and enumerate; extract never ran, so no
requirement exists yet for any element to map to.

## Options

(a) Leave every element unaccounted and accept that \`check --phase
enumerate\` cannot exit 0 while any element lacks a terminal disposition,
since the coverage gate reads the whole store regardless of \`--phase\`.
(b) Give every element a placeholder out-of-scope disposition citing this
item, so the enumerate-only slice of the run can still be asserted clean.

## Recommendation

Recommend (b); it isolates the census and run-state assertions this test
exists to make from the coverage gate, and citing this item keeps the
placeholder itself auditable rather than silent.
`

test('contract-only enumerate over every declared surface, with a census reconciliation failure on mutation', async () => {
  const groundTruthPath = join(source, 'GROUND-TRUTH.md')
  const rows = await parseGroundTruth(groundTruthPath)
  expect(rows.length).toBeGreaterThan(0)
  const groups = groupBySurface(rows)

  // 1. migrate init.
  const init = await migrate([
    'init',
    '--source',
    source,
    '--scope',
    'the whole tiny app',
    '--name',
    'tiny-next',
    '--source-stack',
    'express',
  ])
  expect(init.code).toBe(0)

  // Express declares no closers-relevant work here; drop the closer set so
  // the census gate does not also demand extract-phase closer records this
  // run never produces. The default eight surface types are left exactly as
  // init wrote them, since this fixture's whole point is exercising all
  // eight.
  const cfgPath = join(target, '.migrate', 'config.toml')
  const cfg = await readFile(cfgPath, 'utf8')
  await writeFile(cfgPath, cfg.replace(/^set = .*$/m, 'set = []'))

  // 2. migrate phase probe --status done.
  expect((await migrate(['phase', 'probe', '--status', 'done'])).code).toBe(0)

  // File the queue item every element's placeholder disposition below cites.
  // See QUEUE_ITEM for why: coverage is a whole-store gate, so a clean check
  // bound at --phase enumerate (step 6) still needs every element disposed,
  // even though disposing elements is ordinarily extract's job.
  const queuePath = await writeText(`${QUEUE_ID}.md`, QUEUE_ITEM)
  expect((await migrate(['queue', 'add', queuePath])).code).toBe(0)

  // 3. migrate import elements, one batch per surface, rows from GROUND-TRUTH.md.
  for (const [surface, surfaceRows] of groups) {
    const batch = await write(`elements-${surface}.json`, {
      batch: `b-${surface}-elements-001`,
      phase: 'enumerate',
      rows: surfaceRows.map((row) => ({
        id: row.id,
        surface: row.surface,
        element: row.element,
        found_by: ['code'],
        disposition: { kind: 'out-of-scope', queue: QUEUE_ID },
        refs: [],
        lens: 'code',
        notes: '',
      })),
    })
    const result = await migrate(['import', 'elements', batch])
    expect(result.code).toBe(0)
  }

  // 4. migrate census, one balanced lens record per surface, two directions each.
  for (const [surface, surfaceRows] of groups) {
    const count = surfaceRows.length
    const [a, b] = DIRECTIONS[surface] ?? ['direction a', 'direction b']
    const record = await write(`census-${surface}.json`, {
      kind: 'lens',
      surface,
      phase: 'enumerate',
      directions: {
        grep: { count, evidence: a },
        manual: { count, evidence: b },
      },
      total: count,
      in_ledger: 0,
      added: count,
      skipped: [],
      queued: [],
      batch: `b-${surface}-census-001`,
    })
    const result = await migrate(['census', record])
    expect(result.code).toBe(0)
    expect(result.out).toContain(`census: recorded lens:${surface}`)
  }

  // 5. migrate phase enumerate --status done.
  expect((await migrate(['phase', 'enumerate', '--status', 'done'])).code).toBe(0)

  // 6. migrate check --phase enumerate exits 0 with no violations.
  const clean = await migrate(['check', '--phase', 'enumerate'])
  expect(clean.out).toContain(`0/${rows.length} mapped, ${rows.length} out-of-scope, 0 unaccounted`)
  expect(clean.out).not.toContain('Violations')
  expect(clean.code).toBe(0)

  // 7. Removing one element row breaks the census reconciliation for its
  // surface, and only that: `in_ledger + added` on the surviving census
  // record still claims the pre-mutation count, but elements.jsonl now has
  // one fewer row for that surface. This is what makes step 6's clean
  // assertion load-bearing rather than vacuous: if the reconciliation check
  // were missing or broken, this mutation would leave the check clean too.
  const mutatedSurface = 'tables'
  const mutatedRows = groups.get(mutatedSurface)
  if (!mutatedRows || mutatedRows.length < 2) {
    throw new Error(`fixture must declare at least two ${mutatedSurface} rows to mutate one away`)
  }
  const removedId = mutatedRows[mutatedRows.length - 1]?.id
  const elementsPath = join(target, '.migrate', 'elements.jsonl')
  const elementsText = await readFile(elementsPath, 'utf8')
  const survivingLines = elementsText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .filter((line) => (JSON.parse(line) as { id: string }).id !== removedId)
  await writeFile(elementsPath, `${survivingLines.join('\n')}\n`)

  const afterRemoval = await migrate(['check', '--phase', 'enumerate'])
  expect(afterRemoval.code).not.toBe(0)
  const claimed = mutatedRows.length
  const actual = mutatedRows.length - 1
  expect(afterRemoval.out).toContain(
    `lens census for ${mutatedSurface} claims in_ledger 0 + added ${claimed} = ${claimed} element(s) in the ledger, but elements.jsonl has ${actual}`,
  )
})
