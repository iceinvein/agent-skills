import { appendFile, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeLabels } from './labels-cmd.ts'
import { readTarget } from './target.ts'
import { removeWorktree } from './worktree.ts'

export type RunCleanupInput = {
  runDir: string
  repoPath: string
  gitBin: string
  ghBin: string
  killGraceMs?: number
}

async function run(
  cmd: string[],
  cwd: string,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [exit, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exit, stdout, stderr }
}

/**
 * Setup fetches a PR head into `refs/magpie/pr-<n>` when the commit is not local,
 * and the ref keeps that head reachable for the next re-review's changed-files
 * list. Once the PR is closed or merged nothing will re-review it.
 */
export type PruneResult = { deleted: string[]; failed: Array<{ ref: string; error: string }> }

/** The decision for one ref: true to delete. Throws when its PR state cannot be known. */
async function isClosedPr(ghBin: string, repoPath: string, n: string): Promise<boolean> {
  const view = await run([ghBin, 'pr', 'view', n, '--json', 'state'], repoPath)
  if (view.exit !== 0) throw new Error(`gh pr view ${n} exit ${view.exit}: ${view.stderr.trim()}`)
  let state: unknown
  try {
    state = (JSON.parse(view.stdout) as { state?: unknown }).state
  } catch (err) {
    throw new Error(`gh pr view ${n}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (state === 'OPEN') return false
  if (state === 'CLOSED' || state === 'MERGED') return true
  throw new Error(`gh pr view ${n}: unexpected state ${JSON.stringify(state)}`)
}

/**
 * Setup fetches a PR head into `refs/magpie/pr-<n>` when the commit is not local,
 * and the ref keeps that head reachable for the next re-review's changed-files
 * list. Once the PR is closed or merged nothing will re-review it. A ref whose
 * PR cannot be checked is kept and reported, without holding up the others.
 */
export async function pruneClosedPrRefs(input: {
  gitBin: string
  ghBin: string
  repoPath: string
}): Promise<PruneResult> {
  const list = await run(
    [input.gitBin, 'for-each-ref', '--format=%(refname)', 'refs/magpie/'],
    input.repoPath,
  )
  if (list.exit !== 0) throw new Error(`git for-each-ref exit ${list.exit}: ${list.stderr.trim()}`)
  const result: PruneResult = { deleted: [], failed: [] }
  for (const ref of list.stdout.split('\n').filter(Boolean)) {
    const match = ref.match(/^refs\/magpie\/pr-(\d+)$/)
    if (!match) continue
    try {
      if (!(await isClosedPr(input.ghBin, input.repoPath, match[1] as string))) continue
      const del = await run([input.gitBin, 'update-ref', '-d', ref], input.repoPath)
      if (del.exit !== 0) {
        throw new Error(`git update-ref -d ${ref} exit ${del.exit}: ${del.stderr.trim()}`)
      }
      result.deleted.push(ref)
    } catch (err) {
      result.failed.push({ ref, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}

export type KillOutcome =
  | 'no-server-info'
  | 'no-pid'
  | 'self'
  | 'already-dead'
  | 'sigterm'
  | 'sigkill'
  | 'failed'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function killServer(
  runDir: string,
  graceMs: number,
): Promise<{ outcome: KillOutcome; pid: number | null }> {
  const infoPath = join(runDir, 'state', 'server-info')
  let info: { pid?: number } | null = null
  try {
    info = JSON.parse(await readFile(infoPath, 'utf8'))
  } catch {
    return { outcome: 'no-server-info', pid: null }
  }
  const pid = info?.pid
  if (typeof pid !== 'number') return { outcome: 'no-pid', pid: null }
  if (pid === process.pid) return { outcome: 'self', pid }
  if (!isAlive(pid)) return { outcome: 'already-dead', pid }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return { outcome: 'failed', pid }
  }

  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return { outcome: 'sigterm', pid }
    await sleep(50)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return { outcome: isAlive(pid) ? 'failed' : 'sigterm', pid }
  }
  return { outcome: 'sigkill', pid }
}

export async function runCleanup(input: RunCleanupInput): Promise<number> {
  // Read before any side effect, so a malformed target.json leaves the run untouched.
  // Local mode promises the caller no report, so its cleanup does not point at one.
  const { mode } = await readTarget(input.runDir)
  const worktreePath = join(input.runDir, 'worktree')
  const worktreeExists = await stat(worktreePath)
    .then(() => true)
    .catch(() => false)
  if (worktreeExists) {
    await removeWorktree({
      gitBin: input.gitBin,
      repoPath: input.repoPath,
      worktreePath,
    })
  }

  const grace = input.killGraceMs ?? 2000
  const kill = await killServer(input.runDir, grace)
  await appendFile(
    join(input.runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'cleanup', status: 'kill-server', outcome: kill.outcome, pid: kill.pid, ts: Date.now() })}\n`,
  ).catch(() => {})

  // After the kill so no late /events append is missed by the labels.
  if (await Bun.file(join(input.runDir, 'findings.final.json')).exists()) {
    await writeLabels(input.runDir)
  }

  // Pruning is housekeeping for the repo, so a failure warns rather than leaving the run unarchived.
  let pruneError: string | null = null
  if (mode === 'pr') {
    try {
      const pruned = await pruneClosedPrRefs(input)
      await appendFile(
        join(input.runDir, 'log.jsonl'),
        `${JSON.stringify({ stage: 'cleanup', status: 'prune-refs', deleted: pruned.deleted, failed: pruned.failed.map((f) => f.ref), ts: Date.now() })}\n`,
      )
      if (pruned.failed.length > 0) pruneError = pruned.failed.map((f) => f.error).join('; ')
    } catch (err) {
      pruneError = err instanceof Error ? err.message : String(err)
    }
  }

  const target = `${input.runDir}.archived-${Date.now()}`
  await rename(input.runDir, target)
  process.stdout.write(`archived to ${target}\n`)
  const archivedId = target.split('/').filter(Boolean).pop()
  if (archivedId && mode !== 'local') {
    process.stdout.write(`view later: magpie open ${archivedId}\n`)
  }
  if (pruneError !== null) {
    process.stderr.write(`magpie: warning: could not prune refs/magpie: ${pruneError}\n`)
  }
  if (kill.outcome === 'failed') {
    process.stderr.write(
      `magpie: warning: server process pid=${kill.pid} survived cleanup; kill it manually\n`,
    )
  }
  return 0
}
