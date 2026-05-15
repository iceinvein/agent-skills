import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchPr } from './gh.ts'
import { type Deps, defaultDeps, preflight, renderInstallHint } from './preflight.ts'
import { createWorktree } from './worktree.ts'

export type RunSetupInput = {
  runDir: string
  prNumber: number
  repoPath: string
  deps?: Deps
}

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  await appendFile(join(runDir, 'log.jsonl'), `${JSON.stringify({ ...entry, ts: Date.now() })}\n`)
}

export async function runSetup(input: RunSetupInput): Promise<number> {
  const deps = input.deps ?? defaultDeps()
  await mkdir(input.runDir, { recursive: true })
  await mkdir(join(input.runDir, 'findings'), { recursive: true })
  await mkdir(join(input.runDir, 'screen'), { recursive: true })
  await mkdir(join(input.runDir, 'state'), { recursive: true })

  const preResult = await preflight(deps)
  if (!preResult.ok) {
    await logLine(input.runDir, { stage: 'setup', status: 'error', missing: preResult.missing })
    process.stderr.write(
      `pr-review: missing dependencies:\n${renderInstallHint(preResult.missing)}\n`,
    )
    await cleanup(input.runDir)
    return 3
  }
  await logLine(input.runDir, { stage: 'preflight', status: 'done' })

  const fetched = await fetchPr({
    ghBin: deps.gh,
    prNumber: input.prNumber,
    runDir: input.runDir,
  })
  if (!fetched.ok) {
    await logLine(input.runDir, { stage: 'fetch-pr', status: 'error', error: fetched.error })
    process.stderr.write(`pr-review: ${fetched.error}\n`)
    await cleanup(input.runDir)
    return 4
  }
  await logLine(input.runDir, { stage: 'fetch-pr', status: 'done' })

  const prJson = (await Bun.file(join(input.runDir, 'pr.json')).json()) as { headRefName: string }
  const branch = prJson.headRefName

  const wt = await createWorktree({
    gitBin: deps.git,
    repoPath: input.repoPath,
    branch,
    runDir: input.runDir,
  })
  if (!wt.ok) {
    await logLine(input.runDir, { stage: 'worktree', status: 'error', error: wt.error })
    process.stderr.write(`pr-review: ${wt.error}\n`)
    await cleanup(input.runDir)
    return 5
  }
  await logLine(input.runDir, { stage: 'setup', status: 'done', worktree: wt.worktreePath })
  return 0
}

async function cleanup(runDir: string): Promise<void> {
  for (const name of ['worktree', 'pr.json', 'diff.patch', 'findings', 'screen', 'state']) {
    await rm(join(runDir, name), { recursive: true, force: true }).catch(() => {})
  }
}
