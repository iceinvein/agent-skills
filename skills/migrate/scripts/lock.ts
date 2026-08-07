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

// Five consecutive corrupt reads (see readHolder below for what counts as
// corrupt, as distinct from the merely transient absent state that never
// reaches this counter at all) is well past what a fluctuating filesystem
// state could produce by chance, so it means the lock file itself is broken,
// not merely between holders.
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

// A lock file passes through two ordinary transient states that are not
// evidence of anything wrong: missing (ENOENT, the gap between one holder's
// unlink and the next one's create) and present-but-empty (the gap between
// O_EXCL create and the holder record actually being written). Both are
// reported as 'absent' here and must never spend any of
// UNREADABLE_TOLERANCE's budget: under real contention with several
// short-lived holders cycling quickly, a handful of unlucky consecutive
// polls landing in one gap or the other is ordinary noise, not a stuck lock,
// and charging it against the same counter a genuinely corrupt file uses
// produced exactly that false positive. A file that exists, is non-empty,
// and still fails to parse (or parses to something with no numeric pid) is
// the only state that means a lock nobody will ever finish writing or
// clean up, so that is the only state 'corrupt' covers.
type HolderRead = { status: 'present'; holder: LockHolder } | { status: 'absent' | 'corrupt' }

async function readHolder(path: string): Promise<HolderRead> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { status: 'absent' }
  }
  if (text.length === 0) return { status: 'absent' }
  try {
    const parsed = JSON.parse(text) as LockHolder
    if (typeof parsed?.pid === 'number') return { status: 'present', holder: parsed }
  } catch {
    // falls through to 'corrupt' below
  }
  return { status: 'corrupt' }
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

    const read = await readHolder(path)
    if (read.status === 'corrupt') {
      unreadable += 1
      if (unreadable >= UNREADABLE_TOLERANCE) {
        throw new LockError(
          `store lock at ${path} is unreadable; re-run with --force-unlock after confirming no other agent is writing`,
          'stale',
        )
      }
    } else if (read.status === 'present') {
      unreadable = 0
      const holder = read.holder
      if (!alive(holder.pid)) {
        // The holder read above may have already finished, unlinked the lock
        // and exited by the time this check runs: that is a live release, not
        // a stale one, and it must not be reported as the holder's pid being
        // dead. Re-reading before concluding otherwise tells the two apart.
        // If the file is now gone, or now names a different holder, the lock
        // was released (or handed off) in the gap between the two reads, and
        // the right move is to fall through and retry on the next iteration,
        // not to throw about a holder that no longer holds anything. Only a
        // second read that still shows the exact same dead pid means the
        // holder actually exited without releasing.
        const confirm = await readHolder(path)
        if (confirm.status === 'present' && confirm.holder.pid === holder.pid) {
          throw new LockError(
            `store lock held by pid ${holder.pid}, which is not running. Re-run with --force-unlock after confirming no other agent is writing`,
            'stale',
          )
        }
      } else if (!announced) {
        opts.onWait?.(
          `waiting for store lock (held by pid ${holder.pid} since ${holder.startedAt})`,
        )
        announced = true
      }
    }
    // read.status === 'absent' falls straight through to here: see
    // readHolder's comment for why this must not touch `unreadable`.
    //
    // The deadline applies unconditionally, not only while a live holder is
    // in view: a lock file stuck 'absent' or 'corrupt' for the whole timeout
    // (its creator crashed after the O_EXCL create but before writing, say)
    // must still surface as a timeout rather than loop forever, since
    // neither status alone throws on its own schedule the way a confirmed
    // dead holder or five straight corrupt reads do. The message names the
    // holder when one was last seen, and falls back to naming the lock path
    // when the wait never got that far.
    if (Date.now() >= deadline) {
      throw new LockError(
        read.status === 'present'
          ? `timed out after ${timeoutMs}ms waiting for the store lock held by pid ${read.holder.pid} since ${read.holder.startedAt}`
          : `timed out after ${timeoutMs}ms waiting for the store lock at ${path}`,
        'timeout',
      )
    }
    await Bun.sleep(delay)
    delay = Math.min(Math.ceil(delay * 1.5), 250)
  }
}
