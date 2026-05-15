import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ACTIVE_PATTERN = /^pr-\d+-\d+$/
const ARCHIVED_PATTERN = /^pr-\d+-\d+\.archived-\d+$/

export function reviewHome(): string {
  return process.env.PYLON_REVIEW_HOME ?? join(homedir(), '.pylon-review')
}

export type RunInfo = { id: string; archived: boolean; path: string }

export async function listRuns(home?: string): Promise<RunInfo[]> {
  const root = home ?? reviewHome()
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const runs: RunInfo[] = []
  for (const id of entries) {
    const path = join(root, id)
    const s = await stat(path).catch(() => null)
    if (!s?.isDirectory()) continue
    if (ACTIVE_PATTERN.test(id)) {
      runs.push({ id, archived: false, path })
    } else if (ARCHIVED_PATTERN.test(id)) {
      runs.push({ id, archived: true, path })
    }
  }
  return runs
}

export async function cleanupRun(home: string | undefined, id: string): Promise<number> {
  const root = home ?? reviewHome()
  const target = join(root, id)
  const exists = await stat(target)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    process.stderr.write(`cleanup-run: ${id} not found in ${root}\n`)
    return 1
  }
  await rm(target, { recursive: true, force: true })
  return 0
}
