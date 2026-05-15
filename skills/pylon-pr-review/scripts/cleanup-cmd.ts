import { readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { removeWorktree } from './worktree.ts'

export type RunCleanupInput = {
  runDir: string
  repoPath: string
  gitBin: string
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

  const infoPath = join(input.runDir, 'state', 'server-info')
  try {
    const info = JSON.parse(await readFile(infoPath, 'utf8')) as { pid?: number }
    if (info.pid && info.pid !== process.pid) {
      try {
        process.kill(info.pid, 'SIGTERM')
      } catch {}
    }
  } catch {}

  const target = `${input.runDir}.archived-${Date.now()}`
  await rename(input.runDir, target)
  process.stdout.write(`archived to ${target}\n`)
  return 0
}
