import { appendFile, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { removeWorktree } from './worktree.ts'

export type RunCleanupInput = {
  runDir: string
  repoPath: string
  gitBin: string
  killGraceMs?: number
}

export type KillOutcome =
  | 'no-server-info'
  | 'no-pid'
  | 'self'
  | 'already-dead'
  | 'sigterm'
  | 'sigkill'
  | 'failed'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function killServer(
  runDir: string,
  graceMs: number,
): Promise<{ outcome: KillOutcome; pid: number | null }> {
  const infoPath = join(runDir, 'state', 'server-info')
  let info: { pid?: number } | null = null
  try {
    info = JSON.parse(await readFile(infoPath, 'utf8'))
  } catch {
    return { outcome: 'no-server-info', pid: null }
  }
  const pid = info?.pid
  if (typeof pid !== 'number') return { outcome: 'no-pid', pid: null }
  if (pid === process.pid) return { outcome: 'self', pid }
  if (!isAlive(pid)) return { outcome: 'already-dead', pid }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return { outcome: 'failed', pid }
  }

  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return { outcome: 'sigterm', pid }
    await sleep(50)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return { outcome: isAlive(pid) ? 'failed' : 'sigterm', pid }
  }
  return { outcome: 'sigkill', pid }
}

export async function runCleanup(input: RunCleanupInput): Promise<number> {
  const worktreePath = join(input.runDir, 'worktree')
  const worktreeExists = await stat(worktreePath)
    .then(() => true)
    .catch(() => false)
  if (worktreeExists) {
    await removeWorktree({
      gitBin: input.gitBin,
      repoPath: input.repoPath,
      worktreePath,
    })
  }

  const grace = input.killGraceMs ?? 2000
  const kill = await killServer(input.runDir, grace)
  await appendFile(
    join(input.runDir, 'log.jsonl'),
    `${JSON.stringify({ stage: 'cleanup', status: 'kill-server', outcome: kill.outcome, pid: kill.pid, ts: Date.now() })}\n`,
  ).catch(() => {})

  const target = `${input.runDir}.archived-${Date.now()}`
  await rename(input.runDir, target)
  process.stdout.write(`archived to ${target}\n`)
  if (kill.outcome === 'failed') {
    process.stderr.write(
      `pr-review: warning: server process pid=${kill.pid} survived cleanup; kill it manually\n`,
    )
  }
  return 0
}
