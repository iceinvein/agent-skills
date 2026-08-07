import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, unlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LockError, lockPath, processIsAlive, withStoreLock } from '../lock.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-lock-'))
  await mkdir(join(root, '.migrate'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('runs the body, returns its value, and removes the lock afterwards', async () => {
  const result = await withStoreLock(root, async () => 'done', { cmd: 'import' })
  expect(result).toBe('done')
  expect(existsSync(lockPath(root))).toBe(false)
})

test('the lock file names the holder while the body runs', async () => {
  let holder: { pid: number; cmd: string; startedAt: string } | null = null
  await withStoreLock(
    root,
    async () => {
      holder = JSON.parse(await readFile(lockPath(root), 'utf8'))
    },
    { cmd: 'census' },
  )
  expect(holder).not.toBeNull()
  expect((holder as unknown as { pid: number }).pid).toBe(process.pid)
  expect((holder as unknown as { cmd: string }).cmd).toBe('census')
})

test('releases the lock when the body throws, and propagates the error', async () => {
  const boom = withStoreLock(
    root,
    async () => {
      throw new Error('body failed')
    },
    { cmd: 'import' },
  )
  await expect(boom).rejects.toThrow('body failed')
  expect(existsSync(lockPath(root))).toBe(false)
})

test('refuses immediately when the holder pid is not running, naming --force-unlock', async () => {
  await writeFile(
    lockPath(root),
    JSON.stringify({ pid: 999999, startedAt: '2026-08-07T02:58:03.000Z', cmd: 'import' }),
  )
  const attempt = withStoreLock(root, async () => 'unreachable', {
    cmd: 'import',
    alive: () => false,
    timeoutMs: 30_000,
  })
  await expect(attempt).rejects.toThrow(/--force-unlock/)
  await attempt.catch((e) => {
    expect(e).toBeInstanceOf(LockError)
    expect((e as LockError).kind).toBe('stale')
  })
})

// Regression: readHolder and alive() are separated by an await boundary, so
// a holder that finishes, unlinks the lock, and exits in that gap used to
// make alive() return false for a pid that no longer matters, reported as a
// stale lock even though the lock was actually free. The alive hook's own
// side effect stands in for that race deterministically: it removes the lock
// file at the exact moment withStoreLock asks whether the holder it just read
// is still alive, so the confirming re-read must see the lock gone and retry
// rather than concluding pid 4242 is a dead holder.
test('a holder that releases the lock in the gap between the read and the liveness check is retried, not reported stale', async () => {
  await writeFile(
    lockPath(root),
    JSON.stringify({ pid: 4242, startedAt: '2026-08-07T02:58:03.000Z', cmd: 'import' }),
  )
  let calls = 0
  const result = await withStoreLock(root, async () => 'ran', {
    cmd: 'import',
    alive: (pid) => {
      calls += 1
      if (pid === 4242) unlinkSync(lockPath(root))
      return false
    },
  })
  expect(result).toBe('ran')
  // Called exactly once: the confirming re-read found the lock gone and the
  // retry went straight to acquiring it, never asking alive() about a second
  // holder.
  expect(calls).toBe(1)
})

test('times out while a live holder keeps the lock, naming the holder', async () => {
  await writeFile(
    lockPath(root),
    JSON.stringify({ pid: 4412, startedAt: '2026-08-07T02:58:03.000Z', cmd: 'import' }),
  )
  const waits: string[] = []
  const attempt = withStoreLock(root, async () => 'unreachable', {
    cmd: 'import',
    alive: () => true,
    timeoutMs: 120,
    onWait: (m) => waits.push(m),
  })
  await attempt.catch((e) => {
    expect(e).toBeInstanceOf(LockError)
    expect((e as LockError).kind).toBe('timeout')
    expect((e as LockError).message).toContain('4412')
  })
  expect(waits.length).toBe(1)
  expect(waits[0]).toContain('4412')
  expect(waits[0]).toContain('2026-08-07T02:58:03.000Z')
})

test('force breaks a lock held by a live holder and runs the body', async () => {
  await writeFile(
    lockPath(root),
    JSON.stringify({ pid: 4412, startedAt: '2026-08-07T02:58:03.000Z', cmd: 'import' }),
  )
  const result = await withStoreLock(root, async () => 'ran', {
    cmd: 'import',
    alive: () => true,
    force: true,
  })
  expect(result).toBe('ran')
  expect(existsSync(lockPath(root))).toBe(false)
})

test('a lock file that never becomes readable is reported as stale, not waited out', async () => {
  await writeFile(lockPath(root), 'not json at all')
  const attempt = withStoreLock(root, async () => 'unreachable', {
    cmd: 'import',
    timeoutMs: 30_000,
  })
  await attempt.catch((e) => {
    expect(e).toBeInstanceOf(LockError)
    expect((e as LockError).kind).toBe('stale')
    expect((e as LockError).message).toContain('unreadable')
  })
})

// A lock file left empty forever (its creator crashed after the O_EXCL
// create but before it ever wrote a holder record) must not hang: an empty
// read is deliberately excluded from UNREADABLE_TOLERANCE (see readHolder),
// since counting it there is what caused real contention to misreport a
// live handoff as corruption, so the only remaining backstop is the overall
// deadline. This confirms that backstop actually fires instead of looping.
test('a lock file that stays empty forever times out rather than looping', async () => {
  await writeFile(lockPath(root), '')
  const attempt = withStoreLock(root, async () => 'unreachable', {
    cmd: 'import',
    timeoutMs: 120,
  })
  await attempt.catch((e) => {
    expect(e).toBeInstanceOf(LockError)
    expect((e as LockError).kind).toBe('timeout')
  })
})

test('two concurrent bodies in one process do not overlap', async () => {
  const events: string[] = []
  const body = (name: string) => async () => {
    events.push(`${name}:enter`)
    await Bun.sleep(20)
    events.push(`${name}:exit`)
  }
  await Promise.all([
    withStoreLock(root, body('a'), { cmd: 'import' }),
    withStoreLock(root, body('b'), { cmd: 'import' }),
  ])
  expect(events.length).toBe(4)
  expect(events[1]).toBe(events[0]?.replace(':enter', ':exit'))
  expect(events[3]).toBe(events[2]?.replace(':enter', ':exit'))
})

test('processIsAlive is true for this process and false for an unused pid', () => {
  expect(processIsAlive(process.pid)).toBe(true)
  expect(processIsAlive(999999)).toBe(false)
})
