import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchPr } from './gh.ts'
import { buildIncrementalContext, findPreviousRun } from './incremental.ts'
import { filterDiff, loadPathFilterConfig } from './path-filter.ts'
import { type Deps, defaultDeps, preflight, renderInstallHint } from './preflight.ts'
import { detectMissingTests } from './tests-check.ts'
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
    process.stderr.write(`magpie: missing dependencies:\n${renderInstallHint(preResult.missing)}\n`)
    await cleanup(input.runDir)
    return 3
  }
  await logLine(input.runDir, { stage: 'preflight', status: 'done' })

  const fetched = await fetchPr({
    ghBin: deps.gh,
    prNumber: input.prNumber,
    runDir: input.runDir,
    cwd: input.repoPath,
  })
  if (!fetched.ok) {
    await logLine(input.runDir, { stage: 'fetch-pr', status: 'error', error: fetched.error })
    process.stderr.write(`magpie: ${fetched.error}\n`)
    await cleanup(input.runDir)
    return 4
  }
  await logLine(input.runDir, { stage: 'fetch-pr', status: 'done' })

  await applyPathFilter(input.runDir, input.repoPath)

  await runTestsCheck(input.runDir)

  await detectIncrementalReview(input.runDir, input.prNumber)

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
    process.stderr.write(`magpie: ${wt.error}\n`)
    await cleanup(input.runDir)
    return 5
  }
  await logLine(input.runDir, { stage: 'setup', status: 'done', worktree: wt.worktreePath })
  return 0
}

async function cleanup(runDir: string): Promise<void> {
  for (const name of [
    'worktree',
    'pr.json',
    'diff.patch',
    'diff.full.patch',
    'excluded-files.json',
    'incremental.json',
    'findings',
    'screen',
    'state',
  ]) {
    await rm(join(runDir, name), { recursive: true, force: true }).catch(() => {})
  }
}

async function runTestsCheck(runDir: string): Promise<void> {
  const diff = await Bun.file(join(runDir, 'diff.patch')).text()
  const findings = detectMissingTests(diff)
  if (findings.length === 0) {
    await logLine(runDir, { stage: 'tests-check', status: 'done', findings: 0 })
    return
  }
  await writeFile(join(runDir, 'findings', 'tests.json'), `${JSON.stringify(findings, null, 2)}\n`)
  await logLine(runDir, { stage: 'tests-check', status: 'done', findings: findings.length })
}

async function detectIncrementalReview(runDir: string, prNumber: number): Promise<void> {
  const previous = await findPreviousRun(prNumber, runDir)
  if (!previous) {
    await logLine(runDir, { stage: 'incremental', status: 'first-run' })
    return
  }
  const currentPr = (await Bun.file(join(runDir, 'pr.json')).json()) as Record<string, unknown>
  const context = buildIncrementalContext(currentPr, previous)
  if (!context) {
    await logLine(runDir, { stage: 'incremental', status: 'missing-sha' })
    return
  }
  await writeFile(join(runDir, 'incremental.json'), `${JSON.stringify(context, null, 2)}\n`)
  await logLine(runDir, {
    stage: 'incremental',
    status: 'done',
    previousRunId: context.previousRunId,
    sameSha: context.sameSha,
  })
}

async function applyPathFilter(runDir: string, repoPath: string): Promise<void> {
  const diffPath = join(runDir, 'diff.patch')
  const rawDiff = await Bun.file(diffPath).text()
  const config = await loadPathFilterConfig(repoPath)
  const { filtered, excluded } = filterDiff(rawDiff, config)
  if (excluded.length === 0) {
    await logLine(runDir, { stage: 'filter', status: 'done', excluded: 0 })
    return
  }
  await writeFile(join(runDir, 'diff.full.patch'), rawDiff)
  await writeFile(diffPath, filtered)
  await writeFile(join(runDir, 'excluded-files.json'), `${JSON.stringify(excluded, null, 2)}\n`)
  await logLine(runDir, {
    stage: 'filter',
    status: 'done',
    excluded: excluded.length,
    patterns: Array.from(new Set(excluded.map((e) => e.pattern))),
  })
}
