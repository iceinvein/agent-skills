import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffSha256, localBranchDiff } from '../local-diff.ts'
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
    mode: 'pr',
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
  const target = JSON.parse(await readFile(join(runDir, 'target.json'), 'utf8'))
  expect(target).toEqual({ mode: 'pr', root: join(runDir, 'worktree') })
})

test('runSetup with missing dep returns non-zero and cleans up', async () => {
  const exit = await runSetup({
    mode: 'pr',
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
    mode: 'pr',
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
    mode: 'pr',
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
    mode: 'pr',
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
      mode: 'pr',
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
      mode: 'pr',
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
    mode: 'pr',
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FALSE_BIN, codex: 'echo', git: 'git' },
  })
  expect(exit).not.toBe(0)
  const contents = await readdir(runDir).catch(() => [])
  expect(contents).not.toContain('worktree')
  expect(contents).not.toContain('pr.json')
  expect(contents).not.toContain('target.json')
})

test('runSetup shards the filtered diff and logs the result', async () => {
  const exit = await runSetup({
    mode: 'pr',
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

test('runSetup cleans up a populated shards/ when worktree creation fails after sharding', async () => {
  // `git worktree add` refuses a target path that already exists and is
  // non-empty, which forces the worktree step to fail *after* fetchPr,
  // applyPathFilter, and runShard have already run successfully, without
  // needing a fake git binary.
  await mkdir(join(runDir, 'worktree'), { recursive: true })
  await writeFile(join(runDir, 'worktree', 'occupied'), 'x')

  const exit = await runSetup({
    mode: 'pr',
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(5)

  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  const entries = log
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  // Sharding really did happen before the worktree failure: this isn't a
  // false pass from the worktree step failing before shard ever ran.
  expect(entries.find((e) => e.stage === 'shard')).toMatchObject({ status: 'done', shards: 1 })
  expect(entries.find((e) => e.stage === 'worktree')).toMatchObject({ status: 'error' })

  const contents = await readdir(runDir).catch(() => [])
  expect(contents).not.toContain('shards')
  expect(contents).not.toContain('worktree')
  expect(contents).not.toContain('target.json')
})

test('runSetup treats a shardDiff throw as a hard stop: logs, cleans up, exits 6', async () => {
  // shardDiff creates $RUN_DIR/shards via a plain recursive mkdir. Seeding
  // 'shards' as a regular file ahead of time forces that mkdir to throw
  // EEXIST, a genuine non-ENOENT failure out of shardDiff. diff.patch itself
  // can't be used for this: fetchPr and applyPathFilter both write it earlier
  // in the pipeline, so pre-seeding it as something unreadable would fail
  // before the shard step is ever reached.
  await writeFile(join(runDir, 'shards'), 'not a directory')

  const exit = await runSetup({
    mode: 'pr',
    runDir,
    prNumber: 1234,
    repoPath: repo,
    deps: { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' },
  })
  expect(exit).toBe(6)

  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  const entries = log
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
  const shardEntry = entries.find((e) => e.stage === 'shard')
  expect(shardEntry).toMatchObject({ status: 'error' })
  expect(typeof (shardEntry as { error: unknown }).error).toBe('string')

  const contents = await readdir(runDir).catch(() => [])
  expect(contents.filter((c) => c !== 'log.jsonl')).toHaveLength(0)
})

const LOCAL_DEPS = { bun: 'bun', gh: FAKE_GH, codex: 'echo', git: 'git' }

async function prepareLocalBranch(): Promise<void> {
  await sh(repo, 'git', 'checkout', '-q', 'feature-x')
  await writeFile(join(repo, 'b.txt'), 'two\n')
  await sh(repo, 'git', 'add', 'b.txt')
  await sh(repo, 'git', 'commit', '-q', '-m', 'add b')
  await writeFile(join(repo, 'a.txt'), 'one\nedited\n')
  await writeFile(join(repo, 'new.txt'), 'untracked\n')
}

async function setupCapturingStderr(
  input: Parameters<typeof runSetup>[0],
): Promise<{ exit: number; stderr: string }> {
  const errs: string[] = []
  const origWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((s: string) => {
    errs.push(s)
    return true
  }) as typeof process.stderr.write
  try {
    const exit = await runSetup(input)
    return { exit, stderr: errs.join('') }
  } finally {
    process.stderr.write = origWrite
  }
}

async function readLog(): Promise<Array<Record<string, unknown>>> {
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  return log
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

test('local setup writes the diff, its sidecars and a target rooted at the repo', async () => {
  await prepareLocalBranch()
  const exit = await runSetup({
    mode: 'local',
    runDir,
    repoPath: repo,
    baseRef: 'main',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(0)
  const contents = await readdir(runDir)
  expect(contents).not.toContain('pr.json')
  expect(contents).not.toContain('incremental.json')
  expect(contents).not.toContain('worktree')

  const diff = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(diff).toContain('+++ b/b.txt')
  expect(diff).toContain('+edited')
  expect(diff).toContain('+++ b/new.txt')

  const source = JSON.parse(await readFile(join(runDir, 'diff-source.json'), 'utf8'))
  expect(source.source).toBe('local')
  expect(source.baseRef).toBe('main')
  expect(source.mergeBase).toMatch(/^[0-9a-f]{40}$/)
  expect(source.head).toMatch(/^[0-9a-f]{40}$/)
  expect(source.diffSha256).toMatch(/^[0-9a-f]{64}$/)

  const meta = JSON.parse(await readFile(join(runDir, 'local.json'), 'utf8'))
  expect(meta.branch).toBe('feature-x')
  expect(meta.baseRef).toBe('main')
  expect(meta.dirty).toBe(true)
  expect(meta.intentFile).toBeNull()

  const target = JSON.parse(await readFile(join(runDir, 'target.json'), 'utf8'))
  expect(target).toEqual({ mode: 'local', root: repo })

  expect((await readLog()).find((e) => e.stage === 'setup')).toMatchObject({
    status: 'done',
    root: repo,
  })
})

test('local setup hashes the raw diff, not the path-filtered patch', async () => {
  await sh(repo, 'git', 'checkout', '-q', 'feature-x')
  await writeFile(join(repo, 'bun.lock'), 'lock\n')
  await writeFile(join(repo, 'src.ts'), 'export const x = 1\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'lock and src')

  const exit = await runSetup({
    mode: 'local',
    runDir,
    repoPath: repo,
    baseRef: 'main',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(0)
  const filtered = await readFile(join(runDir, 'diff.patch'), 'utf8')
  expect(filtered).not.toContain('bun.lock')

  const raw = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!raw.ok) throw new Error(raw.error)
  const source = JSON.parse(await readFile(join(runDir, 'diff-source.json'), 'utf8'))
  expect(source.diffSha256).toBe(diffSha256(raw.diff))
})

test('local setup with an unresolvable base logs the error and keeps only the log', async () => {
  await prepareLocalBranch()
  const exit = await runSetup({
    mode: 'local',
    runDir,
    repoPath: repo,
    baseRef: 'nope',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(4)
  expect((await readLog()).find((e) => e.stage === 'local-diff')).toMatchObject({
    status: 'error',
  })
  expect(await readdir(runDir)).toEqual(['log.jsonl'])
})

test('local setup with a missing intent file fails naming the path', async () => {
  await prepareLocalBranch()
  const missing = join(runDir, 'no-such-intent.md')
  const { exit, stderr } = await setupCapturingStderr({
    mode: 'local',
    runDir,
    repoPath: repo,
    baseRef: 'main',
    intentFile: missing,
    deps: LOCAL_DEPS,
  })
  expect(exit).not.toBe(0)
  expect(stderr).toContain(`magpie: intent file ${missing} does not exist`)
  expect((await readLog()).find((e) => e.stage === 'local-diff')).toMatchObject({
    status: 'error',
  })
  expect(await readdir(runDir)).toEqual(['log.jsonl'])
})

test('local setup with an intent path that is a directory fails naming the path', async () => {
  await prepareLocalBranch()
  const intentDir = await mkdtemp(join(tmpdir(), 'magpie-intent-dir-'))
  try {
    const { exit, stderr } = await setupCapturingStderr({
      mode: 'local',
      runDir,
      repoPath: repo,
      baseRef: 'main',
      intentFile: intentDir,
      deps: LOCAL_DEPS,
    })
    expect(exit).not.toBe(0)
    expect(stderr).toContain(`magpie: intent file ${intentDir} is not a file`)
    expect((await readLog()).find((e) => e.stage === 'local-diff')).toMatchObject({
      status: 'error',
    })
    expect(await readdir(runDir)).toEqual(['log.jsonl'])
  } finally {
    await rm(intentDir, { recursive: true, force: true })
  }
})

test('local setup refuses a run dir that is the repository and leaves it untouched', async () => {
  await prepareLocalBranch()
  await mkdir(join(repo, 'findings'))
  await writeFile(join(repo, 'findings', 'user.txt'), 'mine\n')
  await sh(repo, 'git', 'add', 'findings/user.txt')
  await sh(repo, 'git', 'commit', '-q', '-m', 'user findings')
  const before = (await readdir(repo)).sort()

  const { exit, stderr } = await setupCapturingStderr({
    mode: 'local',
    runDir: repo,
    repoPath: repo,
    baseRef: 'nope',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(2)
  expect(stderr).toContain(
    `magpie: run dir ${repo} is inside the repository under review ${await realpath(repo)}\n`,
  )
  expect(await readFile(join(repo, 'findings', 'user.txt'), 'utf8')).toBe('mine\n')
  expect((await readdir(repo)).sort()).toEqual(before)
})

test('local setup refuses a not-yet-created run dir under the repository and creates nothing', async () => {
  await prepareLocalBranch()
  const before = (await readdir(repo)).sort()
  const nested = join(repo, 'runs', 'r1')

  const { exit, stderr } = await setupCapturingStderr({
    mode: 'local',
    runDir: nested,
    repoPath: repo,
    baseRef: 'main',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(2)
  expect(stderr).toContain(`magpie: run dir ${nested} is inside the repository under review`)
  expect((await readdir(repo)).sort()).toEqual(before)
})

async function gitStatus(cwd: string): Promise<string> {
  const proc = Bun.spawn(['git', 'status', '--porcelain'], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  expect(await proc.exited).toBe(0)
  return out
}

test('local setup with --repo at a subdirectory fails before writing a run dir into the repository', async () => {
  await mkdir(join(repo, 'sub'))
  await writeFile(join(repo, 'sub', 's.txt'), 's\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'sub')
  const before = (await readdir(repo)).sort()
  const statusBefore = await gitStatus(repo)
  const sub = join(repo, 'sub')

  const { exit, stderr } = await setupCapturingStderr({
    mode: 'local',
    runDir: join(repo, 'run'),
    repoPath: sub,
    baseRef: 'main',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(2)
  expect(stderr).toContain(`magpie: --repo ${sub} is not the repository root`)
  expect((await readdir(repo)).sort()).toEqual(before)
  expect(await gitStatus(repo)).toBe(statusBefore)
})

test('local setup with a run dir that climbs out of a symlink into the repository leaves the repository unchanged', async () => {
  await mkdir(join(repo, 'sub'))
  await writeFile(join(repo, 'sub', 's.txt'), 's\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'sub')
  await symlink(join(repo, 'sub'), join(runDir, 'L'))
  const before = (await readdir(repo)).sort()
  const statusBefore = await gitStatus(repo)

  await setupCapturingStderr({
    mode: 'local',
    runDir: `${join(runDir, 'L')}/../run5`,
    repoPath: repo,
    baseRef: 'nope',
    deps: LOCAL_DEPS,
  })
  expect((await readdir(repo)).sort()).toEqual(before)
  expect(await gitStatus(repo)).toBe(statusBefore)
})

test('local setup with a --repo that does not exist fails with exit 2 and creates no run dir', async () => {
  const missing = join(runDir, 'no-such-repo')
  const nested = join(runDir, 'r1')
  const { exit, stderr } = await setupCapturingStderr({
    mode: 'local',
    runDir: nested,
    repoPath: missing,
    baseRef: 'main',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(2)
  expect(stderr).toBe(`magpie: --repo ${missing} does not exist\n`)
  expect(await readdir(runDir)).toEqual([])
})

test('local setup with a --repo that is a file fails with exit 2 and creates no run dir', async () => {
  const file = join(repo, 'a.txt')
  const nested = join(runDir, 'r1')
  const { exit, stderr } = await setupCapturingStderr({
    mode: 'local',
    runDir: nested,
    repoPath: file,
    baseRef: 'main',
    deps: LOCAL_DEPS,
  })
  expect(exit).toBe(2)
  expect(stderr).toBe(`magpie: --repo ${file} is not a directory\n`)
  expect(await readdir(runDir)).toEqual([])
})

test('local setup with --repo outside any git repository fails with exit 2 and creates no run dir', async () => {
  const notRepo = await mkdtemp(join(tmpdir(), 'magpie-setup-notrepo-'))
  const nested = join(runDir, 'r1')
  try {
    const { exit, stderr } = await setupCapturingStderr({
      mode: 'local',
      runDir: nested,
      repoPath: notRepo,
      baseRef: 'main',
      deps: LOCAL_DEPS,
    })
    expect(exit).toBe(2)
    expect(stderr).toContain(`magpie: --repo ${notRepo} is not inside a git work tree: `)
    expect(await readdir(runDir)).toEqual([])
  } finally {
    await rm(notRepo, { recursive: true, force: true })
  }
})
