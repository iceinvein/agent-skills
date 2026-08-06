import { afterEach, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { localPrDiff } from '../git-diff.ts'
import { createGitFixtureRepo, git } from './helpers/git-fixture.ts'

let repo = ''

afterEach(async () => {
  if (repo) {
    await rm(repo, { recursive: true, force: true })
    repo = ''
  }
})

test('localPrDiff produces the three-dot diff from the merge base', async () => {
  const { repoPath, head } = await createGitFixtureRepo()
  repo = repoPath
  const result = await localPrDiff({
    gitBin: 'git',
    repoPath,
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
  const { repoPath } = await createGitFixtureRepo()
  repo = repoPath
  const result = await localPrDiff({
    gitBin: 'git',
    repoPath,
    prNumber: 7,
    baseRefName: 'main',
    headRefOid: '0'.repeat(40),
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('cannot resolve PR head')
})

test('localPrDiff errors when the base branch is not present locally', async () => {
  const { repoPath, head } = await createGitFixtureRepo()
  repo = repoPath
  const result = await localPrDiff({
    gitBin: 'git',
    repoPath,
    prNumber: 7,
    baseRefName: 'no-such-branch',
    headRefOid: head,
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('cannot resolve base branch')
})

test('localPrDiff errors when a stale refs/magpie/pr-<n> ref points at an older commit', async () => {
  const { repoPath, head } = await createGitFixtureRepo()
  repo = repoPath
  // Simulate a previous run's fetch having landed an older commit under the
  // PR ref, with no origin remote configured to refresh it from. head~1 is
  // the pre-branch "base" commit: a valid, resolvable, genuinely older commit.
  const staleSha = await git(repoPath, 'rev-parse', `${head}~1`)
  await git(repoPath, 'update-ref', 'refs/magpie/pr-7', staleSha)
  const result = await localPrDiff({
    gitBin: 'git',
    repoPath,
    prNumber: 7,
    baseRefName: 'main',
    headRefOid: head,
  })
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.error).toContain('stale')
  expect(result.error).toContain(staleSha)
  expect(result.error).toContain(head)
})
