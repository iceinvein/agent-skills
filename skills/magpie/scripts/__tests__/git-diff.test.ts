import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localPrDiff } from '../git-diff.ts'

let repo: string

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const exit = await proc.exited
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git ${args.join(' ')} exit ${exit}: ${stderr}`)
  }
  return stdout.trim()
}

/** A repo with `main` and a `feature-x` branch one commit ahead, plus a commit
 *  on `main` after the branch point so a two-dot diff would differ from a
 *  three-dot one. */
async function makeRepo(): Promise<{ head: string; baseTip: string }> {
  await git(repo, 'init', '-b', 'main')
  await git(repo, 'config', 'user.email', 'test@example.com')
  await git(repo, 'config', 'user.name', 'Test')
  await writeFile(join(repo, 'a.ts'), 'export const x = 1\n')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'base')
  await git(repo, 'checkout', '-b', 'feature-x')
  await writeFile(join(repo, 'a.ts'), 'export const x = 2\n')
  await git(repo, 'commit', '-am', 'change x')
  const head = await git(repo, 'rev-parse', 'HEAD')
  await git(repo, 'checkout', 'main')
  await writeFile(join(repo, 'b.ts'), 'export const y = 9\n')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-m', 'unrelated base commit')
  const baseTip = await git(repo, 'rev-parse', 'HEAD')
  return { head, baseTip }
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'magpie-gitdiff-'))
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

test('localPrDiff produces the three-dot diff from the merge base', async () => {
  const { head } = await makeRepo()
  const result = await localPrDiff({
    gitBin: 'git',
    repoPath: repo,
    prNumber: 7,
    baseRefName: 'main',
    headRefOid: head,
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.diff).toContain('export const x = 2')
  // b.ts landed on main after the branch point. A two-dot diff against the
  // base tip would show it as a deletion; the three-dot diff must not.
  expect(result.diff).not.toContain('b.ts')
})

test('localPrDiff errors when the head SHA is not present locally', async () => {
  await makeRepo()
  const result = await localPrDiff({
    gitBin: 'git',
    repoPath: repo,
    prNumber: 7,
    baseRefName: 'main',
    headRefOid: '0'.repeat(40),
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('cannot resolve PR head')
})

test('localPrDiff errors when the base branch is not present locally', async () => {
  const { head } = await makeRepo()
  const result = await localPrDiff({
    gitBin: 'git',
    repoPath: repo,
    prNumber: 7,
    baseRefName: 'no-such-branch',
    headRefOid: head,
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('cannot resolve base branch')
})
