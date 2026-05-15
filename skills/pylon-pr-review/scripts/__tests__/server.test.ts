import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ServerHandle, startServer } from '../server.ts'

let runDir: string
let server: ServerHandle | null

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'prskill-server-'))
  await mkdir(join(runDir, 'screen'), { recursive: true })
  await mkdir(join(runDir, 'state'), { recursive: true })
  server = null
})

afterEach(async () => {
  if (server) await server.stop()
  await rm(runDir, { recursive: true, force: true })
})

async function fetchHtml(handle: ServerHandle): Promise<string> {
  const res = await fetch(handle.url)
  return res.text()
}

test('serves the newest HTML file and injects the helper', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>One</h1>')
  await new Promise((r) => setTimeout(r, 5))
  await writeFile(join(runDir, 'screen', 'b.html'), '<h1>Two</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const html = await fetchHtml(server)
  expect(html).toContain('<h1>Two</h1>')
  expect(html).toContain('helper.js')
})

test('POST /events appends a JSON line to state/events', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const res = await fetch(`${server.url}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'click', findingId: 'f1' }),
  })
  expect(res.ok).toBe(true)
  const events = await readFile(join(runDir, 'state', 'events'), 'utf8')
  const lines = events.trim().split('\n')
  expect(lines).toHaveLength(1)
  const first = lines[0]
  if (!first) throw new Error('expected at least one event line')
  expect(JSON.parse(first).findingId).toBe('f1')
})

test('POST /heartbeat resets the idle timer', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 200 })
  await new Promise((r) => setTimeout(r, 100))
  await fetch(`${server.url}/heartbeat`, { method: 'POST' })
  await new Promise((r) => setTimeout(r, 150))
  const stopped = await Bun.file(join(runDir, 'state', 'server-stopped')).exists()
  expect(stopped).toBe(false)
})

test('idle timeout causes server to exit and write server-stopped', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 100 })
  await new Promise((r) => setTimeout(r, 250))
  const stopped = await Bun.file(join(runDir, 'state', 'server-stopped')).exists()
  expect(stopped).toBe(true)
  server = null
})

test('writes server-info on start with url and port', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const info = JSON.parse(await readFile(join(runDir, 'state', 'server-info'), 'utf8'))
  expect(info.url).toBe(server.url)
  expect(typeof info.port).toBe('number')
  expect(info.pid).toBe(process.pid)
})
