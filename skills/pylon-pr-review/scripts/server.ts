import { appendFile, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type ServerHandle = {
  url: string
  port: number
  stop: () => Promise<void>
}

export type StartServerInput = {
  runDir: string
  idleMs: number
  host?: string
}

async function newestScreenPath(runDir: string): Promise<string | null> {
  const dir = join(runDir, 'screen')
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }
  let bestPath: string | null = null
  let bestMtime = -Infinity
  for (const name of entries) {
    if (!name.endsWith('.html')) continue
    const path = join(dir, name)
    const s = await stat(path)
    if (s.mtimeMs > bestMtime) {
      bestMtime = s.mtimeMs
      bestPath = path
    }
  }
  return bestPath
}

const HELPER_PATH = new URL('./helper.js', import.meta.url).pathname

async function readScreenHtml(htmlPath: string): Promise<string> {
  const body = await readFile(htmlPath, 'utf8')
  if (body.includes('<html')) return body
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>pr-review</title></head><body>${body}</body></html>`
}

export async function startServer(input: StartServerInput): Promise<ServerHandle> {
  const { runDir, idleMs } = input
  let lastActivity = Date.now()
  let stopped = false
  const events = join(runDir, 'state', 'events')
  const serverInfo = join(runDir, 'state', 'server-info')
  const serverStopped = join(runDir, 'state', 'server-stopped')

  await unlink(serverStopped).catch(() => {})

  const server = Bun.serve({
    hostname: input.host ?? '127.0.0.1',
    port: 0,
    fetch: async (req) => {
      lastActivity = Date.now()
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname === '/events') {
        const body = await req.text()
        await appendFile(events, `${body.trim()}\n`)
        return new Response('ok')
      }
      if (req.method === 'POST' && url.pathname === '/heartbeat') {
        return new Response('ok')
      }
      if (req.method === 'GET' && url.pathname === '/helper.js') {
        const src = await readFile(HELPER_PATH, 'utf8')
        return new Response(src, { headers: { 'Content-Type': 'application/javascript' } })
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204 })
      }
      if (req.method === 'GET' && url.pathname === '/') {
        const newest = await newestScreenPath(runDir)
        if (!newest) {
          return new Response('<h1>Waiting for first render</h1>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          })
        }
        const html = await readScreenHtml(newest)
        return new Response(html, { headers: { 'Content-Type': 'text/html' } })
      }
      return new Response('not found', { status: 404 })
    },
  })

  const port = server.port
  if (typeof port !== 'number') {
    throw new Error('Bun.serve did not assign a port')
  }
  const url = `http://${input.host ?? '127.0.0.1'}:${port}`
  await writeFile(serverInfo, JSON.stringify({ url, port, pid: process.pid }))

  const idleTimer = setInterval(
    async () => {
      if (stopped) return
      if (Date.now() - lastActivity >= idleMs) {
        stopped = true
        clearInterval(idleTimer)
        server.stop(true)
        await writeFile(serverStopped, String(Date.now()))
        await unlink(serverInfo).catch(() => {})
      }
    },
    Math.max(50, Math.min(idleMs / 4, 5000)),
  )

  return {
    url,
    port,
    stop: async () => {
      if (stopped) return
      stopped = true
      clearInterval(idleTimer)
      server.stop(true)
      await writeFile(serverStopped, String(Date.now()))
      await unlink(serverInfo).catch(() => {})
    },
  }
}
