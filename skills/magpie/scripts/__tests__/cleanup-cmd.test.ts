import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { killServer, runCleanup } from '../cleanup-cmd.ts'

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(`${cmd.join(' ')} exit ${exit}`)
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
