import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')

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
  target = await mkdtemp(join(tmpdir(), 'migrate-phase-'))
  source = join(target, 'legacy')
  await Bun.write(join(source, 'app.js'), '// legacy\n')
  const init = await migrate(['init', '--source', source, '--scope', 'x', '--name', 'target'])
  expect(init.code).toBe(0)
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

test('phase with no arguments prints every phase and its status', async () => {
  const result = await migrate(['phase'])
  expect(result.code).toBe(0)
  for (const p of [
    'probe',
    'enumerate',
    'seam',
    'extract',
    'parity',
    'queue',
    'adjudicate',
    'handoff',
  ]) {
    expect(result.out).toContain(p)
  }
  expect(result.out).toContain('pending')
})

test('phase <name> --status done persists to phases.json', async () => {
  const set = await migrate(['phase', 'probe', '--status', 'done'])
  expect(set.code).toBe(0)
  expect(set.out).toContain('probe is now done')
  const phases = JSON.parse(await readFile(join(target, '.migrate', 'phases.json'), 'utf8'))
  expect(phases.phases.probe.status).toBe('done')
})

test('phase <name> with no status prints just that phase', async () => {
  await migrate(['phase', 'seam', '--status', 'running'])
  const result = await migrate(['phase', 'seam'])
  expect(result.code).toBe(0)
  expect(result.out).toContain('seam')
  expect(result.out).toContain('running')
  expect(result.out).not.toContain('probe')
})

test('an unknown phase name is a usage error naming the valid set', async () => {
  const result = await migrate(['phase', 'nonsense', '--status', 'done'])
  expect(result.code).toBe(2)
  expect(result.err).toContain('nonsense')
  expect(result.err).toContain('enumerate')
})

test('an unknown status is a usage error naming the valid set', async () => {
  const result = await migrate(['phase', 'probe', '--status', 'finished'])
  expect(result.code).toBe(2)
  expect(result.err).toContain('finished')
  expect(result.err).toContain('blocked')
})

test('recording a census commits its batch under the record phase', async () => {
  const record = join(target, 'census.json')
  await writeFile(
    record,
    JSON.stringify({
      kind: 'lens',
      surface: 'routes',
      phase: 'enumerate',
      directions: {
        code: { count: 2, evidence: 'rg -n "app.(get|post)" app.js' },
        nav: { count: 2, evidence: 'read views/index.html link targets' },
      },
      total: 2,
      in_ledger: 0,
      added: 2,
      skipped: [],
      queued: [],
      batch: 'b-routes-census-001',
    }),
  )
  const result = await migrate(['census', record])
  expect(result.code).toBe(0)
  const phases = JSON.parse(await readFile(join(target, '.migrate', 'phases.json'), 'utf8'))
  const ids = (phases.phases.enumerate.batches as { id: string }[]).map((b) => b.id)
  expect(ids).toContain('b-routes-census-001')
})

test('a closer census without a phase is rejected', async () => {
  const record = join(target, 'closer.json')
  await writeFile(
    record,
    JSON.stringify({
      kind: 'closer',
      closer: 'scope-injection',
      batch: 'b-closer-001',
      checked: 3,
      findings: 0,
      fixed: 0,
      queued: [],
    }),
  )
  const result = await migrate(['census', record])
  expect(result.code).toBe(2)
  expect(result.err).toContain('phase is required')
})
