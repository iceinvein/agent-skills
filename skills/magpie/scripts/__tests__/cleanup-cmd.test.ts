import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { killServer, runCleanup } from '../cleanup-cmd.ts'
import { runSetup } from '../setup-cmd.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`${cmd.join(' ')} exit ${exit}`)
}

async function gitOut(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`git ${args.join(' ')} exit ${exit}`)
  return out
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'magpie-cleanup-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'magpie-cleanup-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await sh(repo, 'git', 'config', 'commit.gpgsign', 'false')
  await sh(repo, 'git', 'config', 'tag.gpgsign', 'false')
  await writeFile(join(repo, 'a.txt'), 'a\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'worktree', 'add', '--detach', join(runDir, 'worktree'), 'HEAD')
  await mkdir(join(runDir, 'state'), { recursive: true })
  // setup writes log.jsonl first in every real run.
  await writeFile(join(runDir, 'log.jsonl'), '')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true }).catch(() => {})
})

test('cleanup removes worktree and archives run dir', async () => {
  const exit = await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })
  expect(exit).toBe(0)
  const original = await Bun.file(join(runDir, 'worktree', 'a.txt')).exists()
  expect(original).toBe(false)
  const parent = dirname(runDir)
  const entries = await readdir(parent)
  const archived = entries.find((e) => e.startsWith(`${basename(runDir)}.archived-`))
  expect(archived).toBeDefined()
})

test('cleanup prints a view-later hint line with the archived id', async () => {
  const out: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })
  } finally {
    process.stdout.write = origWrite
  }
  const text = out.join('')
  expect(text).toContain('archived to ')
  expect(text).toContain('view later: magpie open ')
  expect(text).toMatch(/magpie open \S+\.archived-\d+/)
})

test('cleanup of a local run prints the archive path but no view-later hint', async () => {
  await sh(repo, 'git', 'worktree', 'remove', '--force', join(runDir, 'worktree'))
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: repo }))
  const out: string[] = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((s: string) => {
    out.push(s)
    return true
  }) as typeof process.stdout.write
  try {
    await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })
  } finally {
    process.stdout.write = origWrite
  }
  const text = out.join('')
  expect(text).toContain('archived to ')
  expect(text).not.toContain('view later')
})

test('cleanup with a malformed target.json rejects before archiving or writing labels', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  await writeFile(join(runDir, 'findings.final.json'), '[]')
  await writeFile(join(runDir, 'target.json'), '{not json')
  await expect(runCleanup({ runDir, repoPath: repo, gitBin: 'git' })).rejects.toThrow('target.json')
  const entries = await readdir(dirname(runDir))
  expect(entries.some((e) => e.startsWith(`${basename(runDir)}.archived-`))).toBe(false)
  expect(await Bun.file(join(runDir, 'labels.json')).exists()).toBe(false)
})

test('killServer reports no-server-info when state/server-info missing', async () => {
  const result = await killServer(runDir, 100)
  expect(result.outcome).toBe('no-server-info')
})

test('killServer reports already-dead for a recycled pid', async () => {
  await writeFile(
    join(runDir, 'state', 'server-info'),
    JSON.stringify({ pid: 1, port: 12345, url: 'http://x' }),
  )
  // PID 1 on a sandbox is not signalable by us, so process.kill(1, 0) throws → treated as dead
  const result = await killServer(runDir, 100)
  expect(['already-dead', 'self']).toContain(result.outcome)
})

test('killServer escalates to SIGKILL when SIGTERM is ignored', async () => {
  // Spawn a child that traps SIGTERM and keeps running. SIGKILL is uncatchable.
  const child = Bun.spawn(
    [
      'node',
      '-e',
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('READY')",
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  // Wait for the READY marker so we know the trap is installed.
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (!buf.includes('READY')) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value)
  }
  reader.releaseLock()
  await writeFile(
    join(runDir, 'state', 'server-info'),
    JSON.stringify({ pid: child.pid, port: 12345, url: 'http://x' }),
  )
  const result = await killServer(runDir, 200)
  expect(result.outcome).toBe('sigkill')
  expect(result.pid).toBe(child.pid)
  await child.exited
  // Everything asserted here is bounded: killServer polls to a 200ms deadline
  // and then signals. The clock this test can actually run out of is subprocess
  // startup, seven git spawns in beforeEach plus a cold `node`, which on a
  // shared runner has overrun the 5s default and failed a release.
}, 30_000)

test('cleanup leaves labels.json in the archived dir when findings.final.json exists', async () => {
  const finding = {
    id: 'sec-1',
    file: 'a.ts',
    line: 1,
    severity: 'blocker',
    risk: { impact: 'critical', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
    title: 't',
    description: 'd',
    domain: 'security',
  }
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify([finding]))
  await writeFile(
    join(runDir, 'state', 'events'),
    `${JSON.stringify({ type: 'dismiss', findingId: 'sec-1', reason: 'wrong', timestamp: 1 })}\n`,
  )
  const exit = await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })
  expect(exit).toBe(0)
  const parent = dirname(runDir)
  const archived = (await readdir(parent)).find((e) =>
    e.startsWith(`${basename(runDir)}.archived-`),
  )
  if (!archived) throw new Error('expected an archived run dir')
  const labels = JSON.parse(await readFile(join(parent, archived, 'labels.json'), 'utf8'))
  expect(labels).toEqual([{ id: 'sec-1', label: 'dismissed', reason: 'wrong' }])
  await rm(join(parent, archived), { recursive: true, force: true })
})

test('runCleanup logs kill outcome to log.jsonl', async () => {
  await writeFile(join(runDir, 'log.jsonl'), '')
  const exit = await runCleanup({ runDir, repoPath: repo, gitBin: 'git' })
  expect(exit).toBe(0)
  const parent = dirname(runDir)
  const entries = await readdir(parent)
  const archived = entries.find((e) => e.startsWith(`${basename(runDir)}.archived-`))
  expect(archived).toBeDefined()
  const log = await readFile(join(parent, archived as string, 'log.jsonl'), 'utf8')
  expect(log).toContain('"stage":"cleanup"')
  expect(log).toContain('"outcome":"no-server-info"')
})

test('cleanup after a local setup archives the run and leaves the repo as it was', async () => {
  // The shared fixture adds a worktree; a local run has none, so it gets its own repo and run dir.
  const localRepo = await mkdtemp(join(tmpdir(), 'magpie-cleanup-local-repo-'))
  const localRun = await mkdtemp(join(tmpdir(), 'magpie-cleanup-local-run-'))
  try {
    await sh(localRepo, 'git', 'init', '-q', '-b', 'main')
    await sh(localRepo, 'git', 'config', 'user.email', 't@t.t')
    await sh(localRepo, 'git', 'config', 'user.name', 't')
    await sh(localRepo, 'git', 'config', 'commit.gpgsign', 'false')
    await writeFile(join(localRepo, 'a.txt'), 'a\n')
    await sh(localRepo, 'git', 'add', '.')
    await sh(localRepo, 'git', 'commit', '-q', '-m', 'init')
    await sh(localRepo, 'git', 'checkout', '-q', '-b', 'feature-x')
    await writeFile(join(localRepo, 'b.txt'), 'b\n')
    await sh(localRepo, 'git', 'add', 'b.txt')
    await sh(localRepo, 'git', 'commit', '-q', '-m', 'add b')
    await writeFile(join(localRepo, 'a.txt'), 'a\nedited\n')
    await writeFile(join(localRepo, 'new.txt'), 'untracked\n')

    const setupExit = await runSetup({
      mode: 'local',
      runDir: localRun,
      repoPath: localRepo,
      baseRef: 'main',
      deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
    })
    expect(setupExit).toBe(0)

    const exit = await runCleanup({ runDir: localRun, repoPath: localRepo, gitBin: 'git' })
    expect(exit).toBe(0)

    const parent = dirname(localRun)
    const archived = (await readdir(parent)).find((e) =>
      e.startsWith(`${basename(localRun)}.archived-`),
    )
    if (!archived) throw new Error('expected an archived run dir')
    const target = JSON.parse(await readFile(join(parent, archived, 'target.json'), 'utf8'))
    await rm(join(parent, archived), { recursive: true, force: true })
    expect(target).toEqual({ mode: 'local', root: localRepo })

    expect(await readFile(join(localRepo, 'a.txt'), 'utf8')).toBe('a\nedited\n')
    expect(await readFile(join(localRepo, 'new.txt'), 'utf8')).toBe('untracked\n')
    const status = await gitOut(localRepo, 'status', '--porcelain')
    expect(status).toBe(' M a.txt\n?? new.txt\n')
    const worktrees = await gitOut(localRepo, 'worktree', 'list')
    expect(worktrees.trim().split('\n')).toHaveLength(1)
  } finally {
    await rm(localRepo, { recursive: true, force: true })
    await rm(localRun, { recursive: true, force: true })
  }
})
