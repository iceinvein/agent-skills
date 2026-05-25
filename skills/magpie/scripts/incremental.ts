import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export type IncrementalContext = {
  previousRunId: string
  previousSha: string
  currentSha: string
  /** True when the head SHA is unchanged from the previous run (no new commits). */
  sameSha: boolean
}

const RUN_PATTERN = /^pr-(\d+)-(\d+)(?:\.archived-\d+)?$/

function reviewHome(): string {
  return process.env.MAGPIE_HOME ?? join(homedir(), '.magpie')
}

/**
 * Find the most recent prior run (active or archived) for the same PR number,
 * excluding the current run. Returns null when no prior run exists. The current
 * run is identified by basename match so we don't accidentally pick it up.
 */
export async function findPreviousRun(
  prNumber: number,
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
    try {
      const text = await readFile(prJsonPath, 'utf8')
      return { runId: c.id, runDir, prJson: JSON.parse(text) }
    } catch {
      // Missing or malformed pr.json; try the next candidate.
    }
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
