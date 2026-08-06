import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Spawn `git` in `cwd` and return trimmed stdout, throwing on a non-zero exit. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const exit = await proc.exited
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`git ${args.join(' ')} exit ${exit}: ${stderr}`)
  }
  return stdout.trim()
}

export type GitFixtureRepo = {
  repoPath: string
  head: string
  baseTip: string
}

/**
 * A fresh repo with `main` and a `feature-x` branch one commit ahead, plus a
 * commit on `main` after the branch point so a two-dot diff would differ
 * from a three-dot one. Shared by gh.test.ts and git-diff.test.ts, which both
 * exercise the local-git PR-diff fallback against a real clone.
 */
export async function createGitFixtureRepo(): Promise<GitFixtureRepo> {
  const repoPath = await mkdtemp(join(tmpdir(), 'magpie-git-fixture-'))
  await git(repoPath, 'init', '-b', 'main')
  await git(repoPath, 'config', 'user.email', 'test@example.com')
  await git(repoPath, 'config', 'user.name', 'Test')
  await writeFile(join(repoPath, 'a.ts'), 'export const x = 1\n')
  await git(repoPath, 'add', '.')
  await git(repoPath, 'commit', '-m', 'base')
  await git(repoPath, 'checkout', '-b', 'feature-x')
  await writeFile(join(repoPath, 'a.ts'), 'export const x = 2\n')
  await git(repoPath, 'commit', '-am', 'change x')
  const head = await git(repoPath, 'rev-parse', 'HEAD')
  await git(repoPath, 'checkout', 'main')
  await writeFile(join(repoPath, 'b.ts'), 'export const y = 9\n')
  await git(repoPath, 'add', '.')
  await git(repoPath, 'commit', '-m', 'unrelated base commit')
  const baseTip = await git(repoPath, 'rev-parse', 'HEAD')
  return { repoPath, head, baseTip }
}
