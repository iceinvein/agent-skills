import { join } from 'node:path'
import { startServer } from './server.ts'

export type RunServeInput = {
  runDir: string
  idleMs: number
  host?: string
}

export async function runServe(input: RunServeInput): Promise<number> {
  const handle = await startServer({
    runDir: input.runDir,
    idleMs: input.idleMs,
    host: input.host,
  })
  process.stdout.write(
    `${JSON.stringify({
      url: handle.url,
      port: handle.port,
      state_dir: join(input.runDir, 'state'),
      pid: process.pid,
    })}\n`,
  )

  return new Promise<number>((resolve) => {
    const shutdown = async () => {
      await handle.stop()
      resolve(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    const watcher = setInterval(async () => {
      const stopped = await Bun.file(join(input.runDir, 'state', 'server-stopped')).exists()
      if (stopped) {
        clearInterval(watcher)
        resolve(0)
      }
    }, 200)
  })
}
