import { open, readFile, unlink } from 'node:fs/promises'
import { storePaths } from './paths.ts'

export type LockHolder = { pid: number; startedAt: string; cmd: string }

export class LockError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'stale',
  ) {
    super(message)
    this.name = 'LockError'
  }
}

export type LockOptions = {
  cmd: string
  timeoutMs?: number
  force?: boolean
  alive?: (pid: number) => boolean
  onWait?: (message: string) => void
}

// Thirty seconds is roughly two orders of magnitude above the expected hold
// time for a ten-row batch, so reaching it means something is wrong rather
// than merely busy.
const DEFAULT_TIMEOUT_MS = 30_000

// A lock file exists for a moment after O_EXCL create and before its holder
// record is written, so a reader can legitimately observe it empty. Waiting
// out a handful of consecutive unreadable reads distinguishes that window
// from a genuinely corrupt lock nobody will ever release.
const UNREADABLE_TOLERANCE = 5

// signal 0 performs the permission and existence checks without delivering
// anything. ESRCH is the only code that proves the process is gone: EPERM
// means it exists but belongs to another user, which is still a live holder.
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM'
  }
}

export function lockPath(root: string): string {
  return `${storePaths(root).dir}/.lock`
}

async function readHolder(path: string): Promise<LockHolder | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as LockHolder
    return typeof parsed?.pid === 'number' ? parsed : null
  } catch {
    return null
  }
}

// Serialises the read-modify-write that `import` and `census` both perform
// over the whole store file. Without it two subagents importing concurrently
// each read the same base, and whichever renames last silently discards the
// other's rows. The lock is deliberately coarse: one lock for the whole
// store, held for milliseconds, rather than per-file locks that would have to
// agree on an ordering to stay deadlock-free.
export async function withStoreLock<T>(
  root: string,
  fn: () => Promise<T>,
  opts: LockOptions,
): Promise<T> {
  const path = lockPath(root)
  const alive = opts.alive ?? processIsAlive
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  if (opts.force) await unlink(path).catch(() => {})

  let announced = false
  let unreadable = 0
  let delay = 25
  for (;;) {
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(path, 'wx')
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e
    }
    if (handle) {
      let held = true
      try {
        const holder: LockHolder = {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          cmd: opts.cmd,
        }
        await handle.writeFile(`${JSON.stringify(holder)}\n`)
        await handle.close()
        held = false
        return await fn()
      } finally {
        if (held) await handle.close().catch(() => {})
        await unlink(path).catch(() => {})
      }
    }

    const holder = await readHolder(path)
    if (holder === null) {
      unreadable += 1
      if (unreadable >= UNREADABLE_TOLERANCE) {
        throw new LockError(
          `store lock at ${path} is unreadable; re-run with --force-unlock after confirming no other agent is writing`,
          'stale',
        )
      }
    } else {
      unreadable = 0
      if (!alive(holder.pid)) {
        throw new LockError(
          `store lock held by pid ${holder.pid}, which is not running. Re-run with --force-unlock after confirming no other agent is writing`,
          'stale',
        )
      }
      if (!announced) {
        opts.onWait?.(
          `waiting for store lock (held by pid ${holder.pid} since ${holder.startedAt})`,
        )
        announced = true
      }
      if (Date.now() >= deadline) {
        throw new LockError(
          `timed out after ${timeoutMs}ms waiting for the store lock held by pid ${holder.pid} since ${holder.startedAt}`,
          'timeout',
        )
      }
    }
    await Bun.sleep(delay)
    delay = Math.min(Math.ceil(delay * 1.5), 250)
  }
}
