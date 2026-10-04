import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Drives evals/lib/scaffold.sh the way an eval case's fixture.sh does: a fresh
// HOME and an empty workspace as cwd, the two functions sourced into bash. Each
// stage is built once and shared, since a build is a few dozen CLI calls and
// the assertions below only read the result.
const SCAFFOLD = join(import.meta.dir, '..', '..', 'evals', 'lib', 'scaffold.sh')

type Workspace = { home: string; cwd: string }
type Result = { code: number; out: string; err: string }

const workspaces = new Map<string, Workspace>()
let root: string

async function spawn(cmd: string[], ws: Workspace): Promise<Result> {
  const proc = Bun.spawn(cmd, {
    cwd: ws.cwd,
    env: { ...process.env, HOME: ws.home },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? -1, out, err }
}

async function build(stage: string): Promise<Workspace> {
  const base = join(root, stage)
  const ws = { home: join(base, 'home'), cwd: join(base, 'cwd') }
  await mkdir(ws.home, { recursive: true })
  await mkdir(ws.cwd, { recursive: true })
  const script = `set -euo pipefail; . "${SCAFFOLD}"; migrate_scaffold tiny-express; build_express ${stage}`
  const result = await spawn(['bash', '-c', script], ws)
  if (result.code !== 0) {
    throw new Error(`scaffold for ${stage} exited ${result.code}:\n${result.out}\n${result.err}`)
  }
  return ws
}

function migrate(stage: string, args: string[]): Promise<Result> {
  const ws = workspaces.get(stage)
  if (!ws) throw new Error(`no workspace built for ${stage}`)
  return spawn([join(ws.home, 'shims', 'migrate'), ...args], ws)
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-eval-scaffold-'))
  const stages = ['enumerated', 'queued', 'handed-off']
  const built = await Promise.all(stages.map(build))
  stages.forEach((stage, i) => {
    const ws = built[i]
    if (ws) workspaces.set(stage, ws)
  })
}, 120_000)

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

test('build_express enumerated leaves the enumerate phase done', async () => {
  const result = await migrate('enumerated', ['phase', 'enumerate'])
  expect(result.code).toBe(0)
  expect(result.out).toMatch(/^enumerate\s+done\s/)
})

test('build_express enumerated stops before the seam phase starts', async () => {
  const result = await migrate('enumerated', ['phase', 'seam'])
  expect(result.out).toMatch(/^seam\s+pending\s/)
})

test('build_express queued leaves the queue phase done', async () => {
  const result = await migrate('queued', ['phase', 'queue'])
  expect(result.code).toBe(0)
  expect(result.out).toMatch(/^queue\s+done\s/)
})

test('build_express queued passes the check bound at the queue phase', async () => {
  const result = await migrate('queued', ['check', '--phase', 'queue'])
  expect(result.out).toContain('12/12 mapped, 0 out-of-scope, 0 unaccounted')
  expect(result.code).toBe(0)
})

test('build_express handed-off leaves the handoff phase done', async () => {
  const result = await migrate('handed-off', ['phase', 'handoff'])
  expect(result.code).toBe(0)
  expect(result.out).toMatch(/^handoff\s+done\s/)
})

test('build_express handed-off passes a plain check', async () => {
  const result = await migrate('handed-off', ['check'])
  expect(result.out).not.toContain('Violations')
  expect(result.code).toBe(0)
})

test('the source copy carries neither the ground truth nor a git directory', () => {
  const ws = workspaces.get('queued')
  if (!ws) throw new Error('no workspace built for queued')
  expect(existsSync(join(ws.cwd, 'legacy', 'app.js'))).toBe(true)
  expect(existsSync(join(ws.cwd, 'legacy', 'GROUND-TRUTH.md'))).toBe(false)
  expect(existsSync(join(ws.cwd, 'legacy', '.git'))).toBe(false)
})

test('every step the scaffold replays is committed', async () => {
  const ws = workspaces.get('handed-off')
  if (!ws) throw new Error('no workspace built for handed-off')
  const status = await spawn(['git', 'status', '--porcelain'], ws)
  expect(status.code).toBe(0)
  expect(status.out).toBe('')
})

test('the agent shell finds the compiled CLI first on PATH', async () => {
  const ws = workspaces.get('queued')
  if (!ws) throw new Error('no workspace built for queued')
  const result = await spawn(['zsh', '-c', 'command -v migrate'], ws)
  expect(result.out.trim()).toBe(join(ws.home, 'shims', 'migrate'))
})

test('the workspace holds no compiler leftovers for the agent to find', async () => {
  const ws = workspaces.get('queued')
  if (!ws) throw new Error('no workspace built for queued')
  const tracked = await spawn(['git', 'ls-files'], ws)
  expect(tracked.out.split('\n').filter((path) => path.endsWith('.bun-build'))).toEqual([])
})
