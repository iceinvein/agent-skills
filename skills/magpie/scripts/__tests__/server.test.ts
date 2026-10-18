import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ServerHandle, startServer } from '../server.ts'

let runDir: string
let server: ServerHandle | null

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-server-'))
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

test('serves the newest HTML file verbatim (HTML is self-contained at render time)', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>One</h1>')
  await new Promise((r) => setTimeout(r, 5))
  await writeFile(
    join(runDir, 'screen', 'b.html'),
    '<!DOCTYPE html><html><body><h1>Two</h1><script>/*inline-helper*/</script></body></html>',
  )
  server = await startServer({ runDir, idleMs: 60_000 })
  const html = await fetchHtml(server)
  expect(html).toContain('<h1>Two</h1>')
  expect(html).toContain('inline-helper')
})

/** Writes a screen page with an explicit mtime, in seconds since the epoch. */
async function writeScreen(name: string, body: string, mtime: number): Promise<void> {
  const path = join(runDir, 'screen', name)
  await writeFile(path, body)
  await utimes(path, mtime, mtime)
}

test('a progress page rendered after the findings page does not replace it', async () => {
  await writeScreen('findings.html', '<h1>Findings</h1>', 1000)
  await writeScreen('progress-v9.html', '<h1>Progress, report done</h1>', 2000)
  server = await startServer({ runDir, idleMs: 60_000 })
  expect(await fetchHtml(server)).toContain('<h1>Findings</h1>')
})

test('before any findings page exists, the newest progress page is served', async () => {
  await writeScreen('progress.html', '<h1>Progress one</h1>', 1000)
  await writeScreen('progress-v2.html', '<h1>Progress two</h1>', 2000)
  server = await startServer({ runDir, idleMs: 60_000 })
  expect(await fetchHtml(server)).toContain('<h1>Progress two</h1>')
})

test('the newest findings version is served when several exist', async () => {
  await writeScreen('findings.html', '<h1>Findings one</h1>', 1000)
  await writeScreen('findings-v2.html', '<h1>Findings two</h1>', 2000)
  await writeScreen('progress-v5.html', '<h1>Progress</h1>', 3000)
  server = await startServer({ runDir, idleMs: 60_000 })
  expect(await fetchHtml(server)).toContain('<h1>Findings two</h1>')
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

test('POST /post returns 400 when findingIds is missing or empty', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const res = await fetch(`${server.url}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  expect(res.status).toBe(400)
  const body = (await res.json()) as { ok: boolean; error: string }
  expect(body.ok).toBe(false)
  expect(body.error).toMatch(/findingIds/)
})

test('POST /post wires through to runPost (dry-run) and returns results', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 7,
      headRefOid: 'abcdef00',
      url: 'https://github.com/o/r/pull/7',
    }),
  )
  await writeFile(
    join(runDir, 'findings.final.json'),
    JSON.stringify([
      {
        id: 'sec-1',
        file: 'a.ts',
        line: 1,
        severity: 'blocker',
        risk: { impact: 'critical', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        title: 't',
        description: 'd',
        domain: 'security',
      },
    ]),
  )
  server = await startServer({ runDir, idleMs: 60_000 })
  const res = await fetch(`${server.url}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingIds: ['sec-1'], dryRun: true }),
  })
  expect(res.ok).toBe(true)
  const body = (await res.json()) as {
    ok: boolean
    results: Array<{ id: string; status: string }>
    target?: { repo: string; number: number }
  }
  expect(body.ok).toBe(true)
  expect(body.target).toEqual({ repo: 'o/r', number: 7 })
  expect(body.results.find((r) => r.id === 'sec-1')).toMatchObject({
    id: 'sec-1',
    status: 'posted',
  })
})

test('writes server-info on start with url and port', async () => {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  server = await startServer({ runDir, idleMs: 60_000 })
  const info = JSON.parse(await readFile(join(runDir, 'state', 'server-info'), 'utf8'))
  expect(info.url).toBe(server.url)
  expect(typeof info.port).toBe('number')
  expect(info.pid).toBe(process.pid)
})

test('POST /api/post-review returns reviewId under dry-run', async () => {
  process.env.MAGPIE_DRY_RUN_POST = '1'
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({
      number: 7,
      headRefOid: 'abcdef00',
      url: 'https://github.com/o/r/pull/7',
    }),
  )
  await writeFile(
    join(runDir, 'findings.json'),
    JSON.stringify([
      {
        id: '1',
        file: 'a.ts',
        line: 1,
        severity: 'blocker',
        risk: { impact: 'critical', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        title: 't1',
        description: 'd1',
        domain: 'security',
      },
      {
        id: '2',
        file: 'b.ts',
        line: 2,
        severity: 'warning',
        risk: {
          impact: 'medium',
          likelihood: 'possible',
          confidence: 'medium',
          action: 'should-fix',
        },
        title: 't2',
        description: 'd2',
        domain: 'performance',
      },
    ]),
  )
  server = await startServer({ runDir, idleMs: 60_000 })
  const res = await fetch(`${server.url}/api/post-review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ findingIds: ['1', '2'] }),
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { comments: Array<{ id: string; status: string }> }
  expect(Array.isArray(body.comments)).toBe(true)
  expect(body.comments).toHaveLength(2)
  delete process.env.MAGPIE_DRY_RUN_POST
})

async function postLogEntries(): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e.stage === 'post' && typeof e.id === 'string' && e.id !== '__summary__')
}

const viaFinding = {
  id: 'sec-1',
  file: 'a.ts',
  line: 1,
  severity: 'blocker',
  risk: { impact: 'critical', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
  title: 't',
  description: 'd',
  domain: 'security',
}

async function seedPostable(findingsFile: string): Promise<void> {
  await writeFile(join(runDir, 'screen', 'a.html'), '<h1>X</h1>')
  await writeFile(
    join(runDir, 'pr.json'),
    JSON.stringify({ number: 7, headRefOid: 'abcdef00', url: 'https://github.com/o/r/pull/7' }),
  )
  await writeFile(join(runDir, findingsFile), JSON.stringify([viaFinding]))
}

test('POST /post carries the body via onto the post log entries', async () => {
  await seedPostable('findings.final.json')
  server = await startServer({ runDir, idleMs: 60_000 })
  await fetch(`${server.url}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingIds: ['sec-1'], dryRun: true, via: 'recommended' }),
  })
  const entries = await postLogEntries()
  expect(entries.map((e) => ({ id: e.id, status: e.status, via: e.via }))).toEqual([
    { id: 'sec-1', status: 'dry-run', via: 'recommended' },
  ])
})

test('POST /api/post-review carries the body via onto the post log entries', async () => {
  process.env.MAGPIE_DRY_RUN_POST = '1'
  try {
    await seedPostable('findings.json')
    server = await startServer({ runDir, idleMs: 60_000 })
    await fetch(`${server.url}/api/post-review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ findingIds: ['sec-1'], via: 'recommended' }),
    })
    const entries = await postLogEntries()
    expect(entries.map((e) => ({ id: e.id, status: e.status, via: e.via }))).toEqual([
      { id: 'sec-1', status: 'dry-run', via: 'recommended' },
    ])
  } finally {
    delete process.env.MAGPIE_DRY_RUN_POST
  }
})

test('POST /post with an unrecognised via still posts and logs no via', async () => {
  await seedPostable('findings.final.json')
  server = await startServer({ runDir, idleMs: 60_000 })
  const res = await fetch(`${server.url}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findingIds: ['sec-1'], dryRun: true, via: 'bogus' }),
  })
  expect(res.ok).toBe(true)
  const entries = await postLogEntries()
  expect(entries).toHaveLength(1)
  expect('via' in (entries[0] ?? {})).toBe(false)
})
