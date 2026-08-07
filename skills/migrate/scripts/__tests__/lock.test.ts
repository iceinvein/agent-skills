import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
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
