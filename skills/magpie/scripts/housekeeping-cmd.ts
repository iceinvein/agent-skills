import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Local slugs may contain dots and dashes, so an archived local id also matches
// ACTIVE_PATTERN: test ARCHIVED_PATTERN first.
const ACTIVE_PATTERN = /^(?:pr-\d+|local-[A-Za-z0-9._-]+)-\d+$/
const ARCHIVED_PATTERN = /^(?:pr-\d+|local-[A-Za-z0-9._-]+)-\d+\.archived-\d+$/

export function reviewHome(): string {
  return process.env.MAGPIE_HOME ?? join(homedir(), '.magpie')
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
    if (ARCHIVED_PATTERN.test(id)) {
      runs.push({ id, archived: true, path })
    } else if (ACTIVE_PATTERN.test(id)) {
      runs.push({ id, archived: false, path })
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
