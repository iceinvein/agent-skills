import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type IncrementalContext = {
  previousRunId: string
  previousSha: string
  currentSha: string
  /** True when the head SHA is unchanged from the previous run (no new commits). */
  sameSha: boolean
  /** Files changed from previousSha to currentSha; null when previousSha is not in the clone. */
  changedSincePrevious?: string[] | null
}

const RUN_PATTERN = /^pr-(\d+)-(\d+)(?:\.archived-\d+)?$/

function reviewHome(): string {
  return process.env.MAGPIE_HOME ?? join(homedir(), '.magpie')
}

/**
 * Find the most recent prior run (active or archived) of the same PR, excluding
 * the current run. Run ids carry only the PR number, so the repository is
 * confirmed by matching pr.json's `url`; a run without one is skipped, since
 * another repository's dismissals would make the critic drop findings here.
 * Returns null when no prior run exists.
 */
export async function findPreviousRun(
  prNumber: number,
  prUrl: string,
  currentRunDir: string,
  home?: string,
): Promise<{ runId: string; runDir: string; prJson: Record<string, unknown> } | null> {
  const root = home ?? reviewHome()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return null
  }
  const currentId = basename(currentRunDir)
  const candidates: Array<{ id: string; ts: number }> = []
  for (const id of entries) {
    if (id === currentId) continue
    const m = id.match(RUN_PATTERN)
    if (!m) continue
    if (Number(m[1]) !== prNumber) continue
    candidates.push({ id, ts: Number(m[2]) })
  }
  candidates.sort((a, b) => b.ts - a.ts)
  for (const c of candidates) {
    const runDir = join(root, c.id)
    const s = await stat(runDir).catch(() => null)
    if (!s?.isDirectory()) continue
    const prJsonPath = join(runDir, 'pr.json')
    let prJson: Record<string, unknown>
    try {
      prJson = JSON.parse(await readFile(prJsonPath, 'utf8'))
    } catch {
      // Missing or malformed pr.json; try the next candidate.
      continue
    }
    if (prJson.url === prUrl) return { runId: c.id, runDir, prJson }
  }
  return null
}

export function buildIncrementalContext(
  current: Record<string, unknown>,
  previous: { runId: string; prJson: Record<string, unknown> },
): IncrementalContext | null {
  const currentSha = typeof current.headRefOid === 'string' ? current.headRefOid : ''
  const previousSha =
    typeof previous.prJson.headRefOid === 'string' ? previous.prJson.headRefOid : ''
  if (!currentSha || !previousSha) return null
  return {
    previousRunId: previous.runId,
    previousSha,
    currentSha,
    sameSha: previousSha === currentSha,
  }
}

/**
 * Files changed between two commits, or null when either is not in the clone
 * (a force-push can leave the earlier head unreachable). Names are the new side.
 */
export async function changedFilesSince(input: {
  gitBin: string
  repoPath: string
  fromSha: string
  toSha: string
}): Promise<string[] | null> {
  for (const sha of [input.fromSha, input.toSha]) {
    const probe = Bun.spawn([input.gitBin, 'cat-file', '-e', `${sha}^{commit}`], {
      cwd: input.repoPath,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    if ((await probe.exited) !== 0) return null
  }
  const proc = Bun.spawn(
    [input.gitBin, 'diff', '--name-only', '--no-renames', input.fromSha, input.toSha],
    { cwd: input.repoPath, stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if ((await proc.exited) !== 0) {
    throw new Error(`git diff --name-only ${input.fromSha} ${input.toSha}: ${stderr.trim()}`)
  }
  return stdout.split('\n').filter((l) => l !== '')
}
