import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSetup } from '../setup-cmd.ts'

const FAKE_GH = new URL('../../fixtures/fake-gh.sh', import.meta.url).pathname
const FAKE_GH_WITH_LOCKFILE = new URL('../../fixtures/fake-gh-with-lockfile.sh', import.meta.url)
  .pathname
const FALSE_BIN = '/usr/bin/false'

let repo: string
let runDir: string

async function sh(cwd: string, ...cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const exit = await proc.exited
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} exit ${exit}: ${err}`)
  }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'magpie-setup-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'magpie-setup-run-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 't')
  await sh(repo, 'git', 'config', 'commit.gpgsign', 'false')
  await sh(repo, 'git', 'config', 'tag.gpgsign', 'false')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
  await sh(repo, 'git', 'branch', 'feature-x')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
  await rm(runDir, { recursive: true, force: true })
})

test('runSetup completes happy path: writes pr.json, diff.patch, worktree', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(0)
  const contents = await readdir(runDir)
  expect(contents).toContain('pr.json')
  expect(contents).toContain('diff.patch')
  expect(contents).toContain('worktree')
})

test('runSetup with missing dep returns non-zero and cleans up', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: 'definitely-not-a-thing', codex: 'echo', git: 'git' },
  })
  expect(exit).not.toBe(0)
  const contents = await readdir(runDir).catch(() => [])
  expect(contents.filter((c) => c !== 'log.jsonl')).toHaveLength(0)
})

test('runSetup filters excluded files by default and preserves raw diff', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH_WITH_LOCKFILE, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(0)
  const contents = await readdir(runDir)
  expect(contents).toContain('diff.patch')
  expect(contents).toContain('diff.full.patch')
  expect(contents).toContain('excluded-files.json')
  const filtered = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(filtered).toContain('src/a.ts')
  expect(filtered).not.toContain('bun.lock')
  expect(filtered).not.toContain('dist/x.js')
  const excluded = JSON.parse(
    await readFile(join(runDir, 'excluded-files.json'), 'utf8'),
  ) as Array<{
    path: string
    pattern: string
  }>
  expect(excluded.map((e) => e.path).sort()).toEqual(['bun.lock', 'dist/x.js'])
})

test('runSetup with no excludable files does not write filter sidecars', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(0)
  const contents = await readdir(runDir)
  expect(contents).not.toContain('diff.full.patch')
  expect(contents).not.toContain('excluded-files.json')
})

test('runSetup honors .magpie.json useDefaults=false', async () => {
  await writeFile(join(repo, '.magpie.json'), JSON.stringify({ useDefaults: false, exclude: [] }))
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH_WITH_LOCKFILE, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(0)
  const filtered = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(filtered).toContain('bun.lock')
  expect(filtered).toContain('dist/x.js')
})

test('runSetup writes incremental.json when a prior run for the same PR exists', async () => {
  const magpieHome = await mkdtemp(join(tmpdir(), 'magpie-home-incr-'))
  await sh(magpieHome, 'mkdir', '-p', 'pr-1234-100')
  await writeFile(
    join(magpieHome, 'pr-1234-100', 'pr.json'),
    JSON.stringify({ headRefOid: 'oldsha', number: 1234 }),
  )
  const originalHome = process.env.MAGPIE_HOME
  process.env.MAGPIE_HOME = magpieHome
  try {
    const exit = await runSetup({
      runDir,
      prNumber: 1234,
      repoPath: repo,
      deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
    })
    expect(exit).toBe(0)
    const incremental = JSON.parse(await readFile(join(runDir, 'incremental.json'), 'utf8'))
    expect(incremental.previousRunId).toBe('pr-1234-100')
    expect(incremental.previousSha).toBe('oldsha')
    expect(incremental.sameSha).toBe(false)
  } finally {
    if (originalHome === undefined) delete process.env.MAGPIE_HOME
    else process.env.MAGPIE_HOME = originalHome
    await rm(magpieHome, { recursive: true, force: true })
  }
})

test('runSetup omits incremental.json when no prior run exists', async () => {
  const magpieHome = await mkdtemp(join(tmpdir(), 'magpie-home-incr-empty-'))
  const originalHome = process.env.MAGPIE_HOME
  process.env.MAGPIE_HOME = magpieHome
  try {
    const exit = await runSetup({
      runDir,
      prNumber: 1234,
      repoPath: repo,
      deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
    })
    expect(exit).toBe(0)
    const contents = await readdir(runDir)
    expect(contents).not.toContain('incremental.json')
  } finally {
    if (originalHome === undefined) delete process.env.MAGPIE_HOME
    else process.env.MAGPIE_HOME = originalHome
    await rm(magpieHome, { recursive: true, force: true })
  }
})

test('runSetup with failing gh removes any partial state', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FALSE_BIN, codex: 'echo', git: 'git' },
  })
  expect(exit).not.toBe(0)
  const contents = await readdir(runDir).catch(() => [])
  expect(contents).not.toContain('worktree')
  expect(contents).not.toContain('pr.json')
})

test('runSetup shards the filtered diff and logs the result', async () => {
  const exit = await runSetup({
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(0)
  const manifest = JSON.parse(await readFile(join(runDir, 'shards', 'manifest.json'), 'utf8'))
  expect(manifest.shards.length).toBeGreaterThanOrEqual(1)
  // The fake PR is one small file, so it stays a single-shard passthrough.
  expect(manifest.shards[0].path).toBe('diff.patch')
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  const shardEntry = log
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((e) => e.stage === 'shard')
  expect(shardEntry).toMatchObject({ status: 'done', shards: 1 })
})
