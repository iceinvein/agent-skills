import { join } from 'node:path'

export type CreateWorktreeInput = {
  gitBin: string
  repoPath: string
  branch: string
  runDir: string
}

export type CreateWorktreeResult = { ok: true; worktreePath: string } | { ok: false; error: string }

async function runGit(
  gitBin: string,
  cwd: string,
  args: string[],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([gitBin, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exit = await proc.exited
  return { exit, stdout, stderr }
}

export async function createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
  const worktreePath = join(input.runDir, 'worktree')
  const result = await runGit(input.gitBin, input.repoPath, [
    'worktree',
    'add',
    '--detach',
    worktreePath,
    input.branch,
  ])
  if (result.exit !== 0) {
    return { ok: false, error: `git worktree add exit ${result.exit}: ${result.stderr.trim()}` }
  }
  return { ok: true, worktreePath }
}

export type RemoveWorktreeInput = {
  gitBin: string
  repoPath: string
  worktreePath: string
}

export type RemoveWorktreeResult = { ok: true } | { ok: false; error: string }

export async function removeWorktree(input: RemoveWorktreeInput): Promise<RemoveWorktreeResult> {
  const result = await runGit(input.gitBin, input.repoPath, [
    'worktree',
    'remove',
    '--force',
    input.worktreePath,
  ])
  if (result.exit !== 0) {
    return { ok: false, error: `git worktree remove exit ${result.exit}: ${result.stderr.trim()}` }
  }
  return { ok: true }
}
