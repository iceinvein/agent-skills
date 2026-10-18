import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { reviewHome } from './housekeeping-cmd.ts'
import { readTarget } from './target.ts'

export type ResolvedRun = {
  id: string
  path: string
  archived: boolean
}

// open and serve render the HTML report, which local runs never get, so only PR
// runs are candidates here. --list-runs still lists local runs for resume.
const ACTIVE_PATTERN = /^pr-\d+-\d+$/
const ARCHIVED_PATTERN = /^pr-(\d+)-\d+\.archived-(\d+)$/
const LOCAL_PATTERN = /^local-[A-Za-z0-9._-]+-\d+(?:\.archived-\d+)?$/

function localRunError(idOrPath: string): Error {
  return new Error(`${idOrPath} is a local run; local runs have no report`)
}

type Entry = { id: string; path: string; archived: boolean; mtimeMs: number }

async function listEntries(home: string): Promise<Entry[]> {
  let names: string[]
  try {
    names = await readdir(home)
  } catch {
    return []
  }
  const out: Entry[] = []
  for (const id of names) {
    const path = join(home, id)
    const s = await stat(path).catch(() => null)
    if (!s?.isDirectory()) continue
    if (ARCHIVED_PATTERN.test(id)) {
      out.push({ id, path, archived: true, mtimeMs: s.mtimeMs })
    } else if (ACTIVE_PATTERN.test(id)) {
      out.push({ id, path, archived: false, mtimeMs: s.mtimeMs })
    }
  }
  return out
}

async function isReviewDir(path: string): Promise<boolean> {
  const screen = await stat(join(path, 'screen')).catch(() => null)
  return !!screen?.isDirectory()
}

export async function resolveRunDir(
  idOrPath: string | undefined,
  home?: string,
): Promise<ResolvedRun> {
  const root = home ?? reviewHome()

  if (idOrPath && (isAbsolute(idOrPath) || idOrPath.includes('/'))) {
    const path = idOrPath
    if (!(await isReviewDir(path))) {
      throw new Error(`Not a magpie run directory: ${path}`)
    }
    // Without target.json the run predates local mode, so it is a PR run.
    if (existsSync(join(path, 'target.json')) && (await readTarget(path)).mode === 'local') {
      throw localRunError(path)
    }
    const id = path.split('/').filter(Boolean).pop() ?? path
    return { id, path, archived: ARCHIVED_PATTERN.test(id) }
  }

  if (idOrPath) {
    if (LOCAL_PATTERN.test(idOrPath)) throw localRunError(idOrPath)
    const path = join(root, idOrPath)
    if (!(await isReviewDir(path))) {
      throw new Error(`Run id not found: ${idOrPath} (looked in ${root})`)
    }
    return { id: idOrPath, path, archived: ARCHIVED_PATTERN.test(idOrPath) }
  }

  const entries = await listEntries(root)
  if (entries.length === 0) {
    throw new Error(`No magpie runs found in ${root}`)
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const latest = entries[0]
  if (!latest) {
    throw new Error(`No magpie runs found in ${root}`)
  }
  return { id: latest.id, path: latest.path, archived: latest.archived }
}
