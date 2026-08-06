import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { localPrDiff } from './git-diff.ts'

export type FetchPrInput = {
  ghBin: string
  prNumber: number
  runDir: string
  /** Working directory for the gh and git invocations. Defaults to process.cwd(). */
  cwd?: string
  /** git binary for the local-diff fallback. Defaults to `git` on PATH. */
  gitBin?: string
  /** Extra environment for the gh invocation. Test seam for the fake gh fixtures. */
  env?: Record<string, string>
}

export type FetchPrResult =
  | { ok: true; prJsonPath: string; diffPath: string; source: 'gh' | 'git'; mergeBase?: string }
  | { ok: false; error: string }

export const PR_VIEW_FIELDS = [
  'number',
  'title',
  'headRefName',
  'baseRefName',
  'headRefOid',
  'baseRefOid',
  'author',
  'body',
  // `url` is included so server-side posting can parse owner/repo without
  // depending on cwd (the worktree is gone after cleanup).
  'url',
  'files',
  // Intent evidence for the scout's brief, and issue links for the report header.
  'commits',
  'closingIssuesReferences',
].join(',')

function prFileCount(viewStdout: string): number {
  try {
    const parsed = JSON.parse(viewStdout) as { files?: unknown }
    return Array.isArray(parsed.files) ? parsed.files.length : 0
  } catch {
    return 0
  }
}

export async function fetchPr(input: FetchPrInput): Promise<FetchPrResult> {
  const { ghBin, prNumber, runDir, cwd } = input
  const spawnOpts = {
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
    ...(cwd ? { cwd } : {}),
    ...(input.env ? { env: { ...process.env, ...input.env } } : {}),
  }
  const view = Bun.spawn(
    [ghBin, 'pr', 'view', String(prNumber), '--json', PR_VIEW_FIELDS],
    spawnOpts,
  )
  const viewStdout = await new Response(view.stdout).text()
  const viewStderr = await new Response(view.stderr).text()
  const viewExit = await view.exited
  if (viewExit !== 0) {
    return {
      ok: false,
      error: `gh pr view exit ${viewExit}: ${viewStderr.trim()}`,
    }
  }

  const prJsonPath = join(runDir, 'pr.json')
  const diffPath = join(runDir, 'diff.patch')
  await writeFile(prJsonPath, viewStdout)

  const diff = Bun.spawn([ghBin, 'pr', 'diff', String(prNumber)], spawnOpts)
  const diffStdout = await new Response(diff.stdout).text()
  const diffStderr = await new Response(diff.stderr).text()
  const diffExit = await diff.exited

  // GitHub refuses the `.diff` media type above roughly 300 files (HTTP 406),
  // and a truncating proxy can answer 200 with nothing at all. Reviewing an
  // empty diff as though it were the PR is the worse failure of the two, so
  // both conditions fall through to the local clone.
  const emptyForNonEmptyPr = diffStdout.trim() === '' && prFileCount(viewStdout) > 0
  if (diffExit === 0 && !emptyForNonEmptyPr) {
    await writeFile(diffPath, diffStdout)
    return { ok: true, prJsonPath, diffPath, source: 'gh' }
  }

  const ghError =
    diffExit !== 0
      ? `gh pr diff exit ${diffExit}: ${diffStderr.trim()}`
      : 'gh pr diff returned an empty diff for a PR with changed files'

  let pr: { baseRefName?: unknown; headRefOid?: unknown }
  try {
    pr = JSON.parse(viewStdout) as { baseRefName?: unknown; headRefOid?: unknown }
  } catch (err) {
    return { ok: false, error: `${ghError}; pr.json is unparseable: ${String(err)}` }
  }
  const baseRefName = typeof pr.baseRefName === 'string' ? pr.baseRefName : ''
  const headRefOid = typeof pr.headRefOid === 'string' ? pr.headRefOid : ''
  if (!baseRefName || !headRefOid) {
    return { ok: false, error: `${ghError}; pr.json has no baseRefName/headRefOid to diff from` }
  }

  const local = await localPrDiff({
    gitBin: input.gitBin ?? 'git',
    repoPath: cwd ?? process.cwd(),
    prNumber,
    baseRefName,
    headRefOid,
  })
  if (!local.ok) {
    return { ok: false, error: `${ghError}; local fallback failed: ${local.error}` }
  }
  await writeFile(diffPath, local.diff)
  return { ok: true, prJsonPath, diffPath, source: 'git', mergeBase: local.mergeBase }
}
