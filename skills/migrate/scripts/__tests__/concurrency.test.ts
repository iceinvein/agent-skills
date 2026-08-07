import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')

const SURFACES = [
  'routes',
  'tables',
  'jobs',
  'reports',
  'screens',
  'integrations',
  'workflows',
  'settings',
]

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

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), 'migrate-conc-'))
  source = join(target, 'legacy')
  await Bun.write(join(source, 'app.js'), '// legacy\n')
  const init = await migrate([
    'init',
    '--source',
    source,
    '--scope',
    'concurrency fixture',
    '--name',
    'target',
  ])
  expect(init.code).toBe(0)
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

// Eight concurrent importers, one per default surface type, because
// (surface x lens) is exactly the fan-out unit the orchestration rules
// mandate for phase 1. Before the store lock, each importer read the same
// base elements.jsonl and whichever renamed last discarded every other
// writer's rows, and each recordBatch clobbered the batch list the same way.
test('eight concurrent imports lose no rows and no batch entries', async () => {
  const files = await Promise.all(
    SURFACES.map(async (surface, i) => {
      const batch = `b-${surface}-code-00${i + 1}`
      const path = join(target, `${batch}.json`)
      await writeFile(
        path,
        JSON.stringify({
          batch,
          phase: 'enumerate',
          rows: [
            {
              id: `${surface.replace(/s$/, '')}-one`,
              surface,
              element: `${surface} one`,
              found_by: ['code'],
              disposition: { kind: 'unaccounted' },
              refs: [{ kind: 'src', path: 'app.js' }],
              lens: 'code',
              notes: '',
            },
            {
              id: `${surface.replace(/s$/, '')}-two`,
              surface,
              element: `${surface} two`,
              found_by: ['code'],
              disposition: { kind: 'unaccounted' },
              refs: [{ kind: 'src', path: 'app.js' }],
              lens: 'code',
              notes: '',
            },
          ],
        }),
      )
      return { batch, path }
    }),
  )

  const results = await Promise.all(files.map((f) => migrate(['import', 'elements', f.path])))
  for (const r of results) expect(r.code).toBe(0)

  const elements = (await readFile(join(target, '.migrate', 'elements.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim().length > 0)
  expect(elements.length).toBe(SURFACES.length * 2)

  const phases = JSON.parse(await readFile(join(target, '.migrate', 'phases.json'), 'utf8'))
  const recorded = new Set((phases.phases.enumerate.batches as { id: string }[]).map((b) => b.id))
  for (const f of files) expect(recorded.has(f.batch)).toBe(true)
})

test('a dead holder is refused with exit 3 and cleared by --force-unlock', async () => {
  await writeFile(
    join(target, '.migrate', '.lock'),
    JSON.stringify({ pid: 999999, startedAt: '2026-08-07T02:58:03.000Z', cmd: 'import' }),
  )
  const batchPath = join(target, 'b-routes-code-001.json')
  await writeFile(
    batchPath,
    JSON.stringify({
      batch: 'b-routes-code-001',
      phase: 'enumerate',
      rows: [
        {
          id: 'route-one',
          surface: 'routes',
          element: 'GET /one',
          found_by: ['code'],
          disposition: { kind: 'unaccounted' },
          refs: [{ kind: 'src', path: 'app.js' }],
          lens: 'code',
          notes: '',
        },
      ],
    }),
  )

  const blocked = await migrate(['import', 'elements', batchPath])
  expect(blocked.code).toBe(3)
  expect(blocked.err).toContain('999999')
  expect(blocked.err).toContain('--force-unlock')

  const forced = await migrate(['import', 'elements', batchPath, '--force-unlock'])
  expect(forced.code).toBe(0)
})
