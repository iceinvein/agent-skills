import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWorktree, removeWorktree } from '../worktree.ts'

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
  repo = await mkdtemp(join(tmpdir(), 'prskill-repo-'))
  runDir = await mkdtemp(join(tmpdir(), 'prskill-run-'))
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

test('createWorktree checks out the branch at the right SHA', async () => {
  const result = await createWorktree({
    gitBin: 'git',
    repoPath: repo,
    branch: 'feature-x',
    runDir,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  expect(result.worktreePath).toBe(join(runDir, 'worktree'))
  const fileExists = await Bun.file(join(result.worktreePath, 'a.txt')).exists()
  expect(fileExists).toBe(true)
})

test('createWorktree fails on unknown branch', async () => {
  const result = await createWorktree({
    gitBin: 'git',
    repoPath: repo,
    branch: 'no-such-branch',
    runDir,
  })
  expect(result.ok).toBe(false)
})

test('removeWorktree cleans up', async () => {
  const created = await createWorktree({
    gitBin: 'git',
    repoPath: repo,
    branch: 'feature-x',
    runDir,
  })
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error(created.error)
  const removed = await removeWorktree({
    gitBin: 'git',
    repoPath: repo,
    worktreePath: created.worktreePath,
  })
  expect(removed.ok).toBe(true)
  const fileExists = await Bun.file(join(created.worktreePath, 'a.txt')).exists()
  expect(fileExists).toBe(false)
})
