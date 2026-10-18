import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffSha256, localBranchDiff, localBranchMeta } from '../local-diff.ts'

let repo: string

async function sh(cwd: string, ...cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  const exit = await proc.exited
  if (exit !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`${cmd.join(' ')} exit ${exit}: ${err}`)
  }
  return out
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'magpie-local-diff-'))
  await sh(repo, 'git', 'init', '-q', '-b', 'main')
  await sh(repo, 'git', 'config', 'user.email', 't@t.t')
  await sh(repo, 'git', 'config', 'user.name', 'Tess Tester')
  await sh(repo, 'git', 'config', 'commit.gpgsign', 'false')
  await writeFile(join(repo, 'a.txt'), 'one\n')
  await writeFile(join(repo, 'b.txt'), 'bee\n')
  await writeFile(join(repo, '.gitignore'), 'ignored.log\n')
  await sh(repo, 'git', 'add', '.')
  await sh(repo, 'git', 'commit', '-q', '-m', 'init')
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

async function makeFeatureBranch(): Promise<void> {
  await sh(repo, 'git', 'checkout', '-q', '-b', 'feat/x')
  await writeFile(join(repo, 'a.txt'), 'one\ntwo\n')
  await sh(repo, 'git', 'commit', '-q', '-am', 'add two', '-m', 'because two beats one')
  await writeFile(join(repo, 'b.txt'), 'bee\nsting\n')
  await writeFile(join(repo, 'new.txt'), 'fresh\n')
}

test('localBranchDiff includes committed, uncommitted and untracked changes', async () => {
  await makeFeatureBranch()
  const mainSha = (await sh(repo, 'git', 'rev-parse', 'main')).trim()
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!r.ok) throw new Error(r.error)
  expect(r.diff).toContain('diff --git a/a.txt b/a.txt')
  expect(r.diff).toContain('+two')
  expect(r.diff).toContain('diff --git a/b.txt b/b.txt')
  expect(r.diff).toContain('+sting')
  expect(r.diff).toContain('new file mode')
  expect(r.diff).toContain('+++ b/new.txt')
  expect(r.mergeBase).toBe(mainSha)
  expect(r.baseRef).toBe('main')
  expect(r.head).toBe((await sh(repo, 'git', 'rev-parse', 'HEAD')).trim())
})

test('localBranchDiff fails naming an unresolvable base ref', async () => {
  await makeFeatureBranch()
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'nope' })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toContain('nope')
})

test('localBranchDiff defaults to origin/HEAD and fails naming it without a remote', async () => {
  await makeFeatureBranch()
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toContain('origin/HEAD')
})

test('localBranchDiff fails when the branch matches its base and the tree is clean', async () => {
  await sh(repo, 'git', 'checkout', '-q', '-b', 'feat/x')
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toContain('nothing to review against main')
})

test('localBranchDiff leaves gitignored files out', async () => {
  await makeFeatureBranch()
  await writeFile(join(repo, 'ignored.log'), 'noise\n')
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!r.ok) throw new Error(r.error)
  expect(r.diff).not.toContain('ignored.log')
})

test('localBranchDiff leaves the index and working tree untouched', async () => {
  await makeFeatureBranch()
  const statusBefore = await sh(repo, 'git', 'status', '--porcelain')
  const cachedBefore = await sh(repo, 'git', 'diff', '--cached')
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  expect(r.ok).toBe(true)
  expect(await sh(repo, 'git', 'status', '--porcelain')).toBe(statusBefore)
  expect(await sh(repo, 'git', 'diff', '--cached')).toBe(cachedBefore)
  expect(statusBefore).toBe(' M b.txt\n?? new.txt\n')
})

async function metaFor(intentFile: string | null) {
  const d = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!d.ok) throw new Error(d.error)
  return localBranchMeta({
    gitBin: 'git',
    repoPath: repo,
    baseRef: d.baseRef,
    mergeBase: d.mergeBase,
    head: d.head,
    intentFile,
  })
}

test('localBranchMeta describes the branch, dirtiness, author and commits', async () => {
  await makeFeatureBranch()
  const r = await metaFor('/tmp/intent.md')
  if (!r.ok) throw new Error(r.error)
  expect(r.meta.branch).toBe('feat/x')
  expect(r.meta.dirty).toBe(true)
  expect(r.meta.author).toBe('Tess Tester')
  expect(r.meta.intentFile).toBe('/tmp/intent.md')
  expect(r.meta.commits).toHaveLength(1)
  expect(r.meta.commits[0]?.headline).toBe('add two')
  expect(r.meta.commits[0]?.body).toBe('because two beats one')
  expect(r.meta.commits[0]?.oid).toBe((await sh(repo, 'git', 'rev-parse', 'HEAD')).trim())
})

test('localBranchMeta reports a null branch on a detached HEAD', async () => {
  await makeFeatureBranch()
  await sh(repo, 'git', 'checkout', '-q', '--detach')
  const r = await metaFor(null)
  if (!r.ok) throw new Error(r.error)
  expect(r.meta.branch).toBeNull()
})

test('localBranchMeta fails naming user.name when it is unset', async () => {
  await makeFeatureBranch()
  const d = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!d.ok) throw new Error(d.error)
  await sh(repo, 'git', 'config', '--unset', 'user.name')
  const saved = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
    HOME: process.env.HOME,
  }
  process.env.GIT_CONFIG_GLOBAL = '/dev/null'
  process.env.GIT_CONFIG_SYSTEM = '/dev/null'
  process.env.HOME = repo
  try {
    const r = await localBranchMeta({
      gitBin: 'git',
      repoPath: repo,
      baseRef: d.baseRef,
      mergeBase: d.mergeBase,
      head: d.head,
      intentFile: null,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('user.name')
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
})

test('localBranchDiff keeps a/ b/ headers and real content despite user diff config', async () => {
  await makeFeatureBranch()
  await sh(repo, 'git', 'config', 'diff.noprefix', 'true')
  await sh(repo, 'git', 'config', 'diff.external', '/usr/bin/true')
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!r.ok) throw new Error(r.error)
  expect(r.diff).toContain('diff --git a/a.txt b/a.txt')
  expect(r.diff).toContain('+two')
  expect(r.diff).toContain('diff --git a/new.txt b/new.txt')
  expect(r.diff).toContain('+fresh')
})

test('localBranchDiff and localBranchMeta leave .git/index unwritten', async () => {
  await makeFeatureBranch()
  const future = new Date(Date.now() + 60_000)
  await utimes(join(repo, 'a.txt'), future, future)
  const indexPath = join(repo, '.git', 'index')
  const past = new Date(Date.now() - 3_600_000)
  await utimes(indexPath, past, past)
  const before = await stat(indexPath)
  const bytesBefore = await readFile(indexPath)
  const d = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!d.ok) throw new Error(d.error)
  const m = await localBranchMeta({
    gitBin: 'git',
    repoPath: repo,
    baseRef: d.baseRef,
    mergeBase: d.mergeBase,
    head: d.head,
    intentFile: null,
  })
  expect(m.ok).toBe(true)
  expect((await stat(indexPath)).mtimeMs).toBe(before.mtimeMs)
  expect(Buffer.compare(await readFile(indexPath), bytesBefore)).toBe(0)
})

test('localBranchDiff leaves .git/index unwritten when a tracked file is only stat-dirty', async () => {
  await makeFeatureBranch()
  const y2030 = new Date('2030-01-01T00:00:00Z')
  // .gitignore is unchanged since the merge base, so only its stat info moves.
  await utimes(join(repo, '.gitignore'), y2030, y2030)
  const indexPath = join(repo, '.git', 'index')
  const past = new Date(Date.now() - 3_600_000)
  await utimes(indexPath, past, past)
  const before = await stat(indexPath)
  const bytesBefore = await readFile(indexPath)
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  expect(r.ok).toBe(true)
  expect((await stat(indexPath)).mtimeMs).toBe(before.mtimeMs)
  expect(Buffer.compare(await readFile(indexPath), bytesBefore)).toBe(0)
})

test('localBranchDiff writes non-ASCII paths unquoted', async () => {
  await writeFile(join(repo, 'naïve.txt'), 'old\n')
  await sh(repo, 'git', 'add', 'naïve.txt')
  await sh(repo, 'git', 'commit', '-q', '-m', 'add naive')
  await makeFeatureBranch()
  await writeFile(join(repo, 'naïve.txt'), 'new\n')
  await writeFile(join(repo, 'café.txt'), 'latte\n')
  const r = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!r.ok) throw new Error(r.error)
  expect(r.diff).toContain('diff --git a/café.txt b/café.txt')
  expect(r.diff).toContain('diff --git a/naïve.txt b/naïve.txt')
})

test('localBranchMeta lists commits up to the given head, not HEAD', async () => {
  await makeFeatureBranch()
  const d = await localBranchDiff({ gitBin: 'git', repoPath: repo, baseRef: 'main' })
  if (!d.ok) throw new Error(d.error)
  const r = await localBranchMeta({
    gitBin: 'git',
    repoPath: repo,
    baseRef: d.baseRef,
    mergeBase: d.mergeBase,
    head: d.mergeBase,
    intentFile: null,
  })
  if (!r.ok) throw new Error(r.error)
  expect(r.meta.commits).toEqual([])
})

test('localBranchDiff refuses a repoPath that is not the repository root', async () => {
  await makeFeatureBranch()
  await mkdir(join(repo, 'sub'))
  const r = await localBranchDiff({ gitBin: 'git', repoPath: join(repo, 'sub'), baseRef: 'main' })
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.error).toContain(join(repo, 'sub'))
})

test('diffSha256 hashes the UTF-8 bytes as lowercase hex', () => {
  expect(diffSha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
