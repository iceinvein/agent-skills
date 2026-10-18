import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** What a run reviews: a PR checked out in the run's worktree, or a local branch in place. */
export type ReviewTarget = { mode: 'pr' | 'local'; root: string }

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/**
 * Runs from before local mode wrote no target.json; those are all PR runs.
 * setup writes log.jsonl first, so a dir without it is a mistyped path, not an old run.
 */
export async function readTarget(runDir: string): Promise<ReviewTarget> {
  const path = join(runDir, 'target.json')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (!isMissingFile(err)) throw err
    if (!existsSync(join(runDir, 'log.jsonl'))) {
      throw new Error(`${runDir}: not a magpie run (no target.json or log.jsonl)`)
    }
    return { mode: 'pr', root: join(runDir, 'worktree') }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`${path}: not valid JSON (${err instanceof Error ? err.message : String(err)})`)
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${path}: expected an object`)
  }
  const { mode, root } = raw as Record<string, unknown>
  if (mode !== 'pr' && mode !== 'local') {
    throw new Error(`${path}: mode must be "pr" or "local", got ${JSON.stringify(mode)}`)
  }
  if (typeof root !== 'string') {
    throw new Error(`${path}: root must be a string, got ${JSON.stringify(root)}`)
  }
  // A relative root would resolve against whichever cwd a command runs in.
  if (!isAbsolute(root)) throw new Error(`${path}: root must be an absolute path`)
  return { mode, root }
}

export async function writeTarget(runDir: string, target: ReviewTarget): Promise<void> {
  await writeFile(join(runDir, 'target.json'), `${JSON.stringify(target, null, 2)}\n`)
}

/** The directory findings are anchored against. */
export async function reviewRoot(runDir: string): Promise<string> {
  return (await readTarget(runDir)).root
}
