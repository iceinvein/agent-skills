export type LocalDiffInput = {
  gitBin: string
  repoPath: string
  prNumber: number
  baseRefName: string
  headRefOid: string
}

export type LocalDiffResult =
  | { ok: true; diff: string; mergeBase: string }
  | { ok: false; error: string }

async function git(
  gitBin: string,
  cwd: string,
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([gitBin, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  return { exit, stdout, stderr }
}

async function resolveCommit(gitBin: string, cwd: string, ref: string): Promise<string | null> {
  const r = await git(gitBin, cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  const sha = r.stdout.trim()
  return r.exit === 0 && sha.length > 0 ? sha : null
}

/**
 * Reproduce `gh pr diff` from the local clone. GitHub refuses the `.diff` media
 * type above roughly 300 files, and a review that cannot get a diff is worth
 * less than one built from local objects.
 *
 * Diffs from the merge base rather than the base tip so the output matches
 * `gh pr diff`'s three-dot semantics: the PR's own changes, not every commit
 * the base branch gained since the branch point.
 */
export async function localPrDiff(input: LocalDiffInput): Promise<LocalDiffResult> {
  const { gitBin, repoPath, prNumber, baseRefName, headRefOid } = input
  const prRef = `refs/magpie/pr-${prNumber}`

  // Best effort. `pull/<n>/head` is a GitHub convention and resolves fork PRs
  // that `headRefName` cannot, but a repo with no `origin`, an offline run, or
  // a non-GitHub remote must still work when the commits are already local.
  await git(gitBin, repoPath, ['fetch', 'origin', `pull/${prNumber}/head:${prRef}`])
  await git(gitBin, repoPath, ['fetch', 'origin', baseRefName])

  let head: string | null = null
  for (const ref of [prRef, headRefOid]) {
    head = await resolveCommit(gitBin, repoPath, ref)
    if (head) break
  }
  if (!head) {
    return {
      ok: false,
      error: `cannot resolve PR head ${headRefOid} locally (tried ${prRef} and the SHA); fetch the PR branch and retry`,
    }
  }
  // Reviewing a stale local ref and reporting it as a review of the PR is worse
  // than failing, so a mismatch is fatal rather than a warning.
  if (head !== headRefOid) {
    return {
      ok: false,
      error: `local PR head ${head} does not match the PR head ${headRefOid}; the local ref is stale`,
    }
  }

  let base: string | null = null
  for (const ref of [`origin/${baseRefName}`, baseRefName]) {
    base = await resolveCommit(gitBin, repoPath, ref)
    if (base) break
  }
  if (!base) {
    return {
      ok: false,
      error: `cannot resolve base branch ${baseRefName} locally (tried origin/${baseRefName} and ${baseRefName})`,
    }
  }

  const mb = await git(gitBin, repoPath, ['merge-base', base, head])
  if (mb.exit !== 0) {
    return { ok: false, error: `git merge-base exit ${mb.exit}: ${mb.stderr.trim()}` }
  }
  const mergeBase = mb.stdout.trim()

  const d = await git(gitBin, repoPath, ['diff', '--no-color', '--find-renames', mergeBase, head])
  if (d.exit !== 0) {
    return { ok: false, error: `git diff exit ${d.exit}: ${d.stderr.trim()}` }
  }
  return { ok: true, diff: d.stdout, mergeBase }
}
