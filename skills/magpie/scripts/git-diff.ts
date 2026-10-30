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
  env?: Record<string, string>,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([gitBin, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    ...(env ? { env: { ...process.env, ...env } } : {}),
  })
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
 * Render a fetch's outcome for an error message, so a genuine failure (wrong
 * remote, auth failure, rate limiting) can be told apart from a benign one
 * (no origin, offline, non-GitHub remote) when resolution ends up failing.
 * Empty when the fetch succeeded, since a successful fetch explains nothing.
 */
function fetchDiagnostic(result: { exit: number; stderr: string }): string {
  if (result.exit === 0) return ''
  const stderr = result.stderr.trim()
  return stderr ? `; git fetch: ${stderr}` : `; git fetch exited ${result.exit}`
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
export type PrHeadInput = {
  gitBin: string
  repoPath: string
  prNumber: number
  headRefOid: string
}

/**
 * The PR's head commit in the local clone, exactly `headRefOid`. The local
 * branch named `headRefName` can be behind, ahead with unpushed commits, or
 * absent on a fork PR, so it is never what gets reviewed.
 */
export async function resolvePrHead(
  input: PrHeadInput,
): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
  const { gitBin, repoPath, prNumber, headRefOid } = input
  const prRef = `refs/magpie/pr-${prNumber}`

  // Present, the SHA is the PR head by definition, so there is nothing to fetch
  // and a stale ref from an earlier run does not matter.
  const local = await resolveCommit(gitBin, repoPath, headRefOid)
  if (local) return { ok: true, sha: local }

  // Best effort. `pull/<n>/head` is a GitHub convention and resolves fork PRs
  // that `headRefName` cannot. The fetch's own result is kept (not discarded)
  // so, if resolution below still fails, the error can say why the fetch didn't
  // help. The `+` lets the ref follow a force-push; without it git keeps the head
  // an earlier run fetched. No terminal prompt, so missing credentials fail
  // instead of waiting on a tty nobody is watching.
  const headFetch = await git(
    gitBin,
    repoPath,
    ['fetch', 'origin', `+pull/${prNumber}/head:${prRef}`],
    { GIT_TERMINAL_PROMPT: '0' },
  )

  const head = await resolveCommit(gitBin, repoPath, prRef)
  if (!head) {
    return {
      ok: false,
      error: `cannot resolve PR head ${headRefOid} locally (tried the SHA and ${prRef}); run \`git fetch <remote> pull/${prNumber}/head\` from the remote that holds the PR, then retry${fetchDiagnostic(headFetch)}`,
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
  return { ok: true, sha: head }
}

export async function localPrDiff(input: LocalDiffInput): Promise<LocalDiffResult> {
  const { gitBin, repoPath, prNumber, baseRefName, headRefOid } = input
  const resolved = await resolvePrHead({ gitBin, repoPath, prNumber, headRefOid })
  if (!resolved.ok) return resolved
  const head = resolved.sha
  const baseFetch = await git(gitBin, repoPath, ['fetch', 'origin', baseRefName])

  let base: string | null = null
  for (const ref of [`origin/${baseRefName}`, baseRefName]) {
    base = await resolveCommit(gitBin, repoPath, ref)
    if (base) break
  }
  if (!base) {
    return {
      ok: false,
      error: `cannot resolve base branch ${baseRefName} locally (tried origin/${baseRefName} and ${baseRefName})${fetchDiagnostic(baseFetch)}`,
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
