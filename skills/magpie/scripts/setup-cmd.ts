import { existsSync } from 'node:fs'
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fetchPr } from './gh.ts'
import { buildIncrementalContext, findPreviousRun } from './incremental.ts'
import { diffSha256, localBranchDiff, localBranchMeta } from './local-diff.ts'
import { filterDiff, loadPathFilterConfig } from './path-filter.ts'
import { type Deps, defaultDeps, preflight, renderInstallHint } from './preflight.ts'
import { shardDiff } from './shard.ts'
import { writeTarget } from './target.ts'
import { detectMissingTests } from './tests-check.ts'
import { createWorktree } from './worktree.ts'

export type RunSetupInput = {
  runDir: string
  repoPath: string
  deps?: Deps
} & ({ mode: 'pr'; prNumber: number } | { mode: 'local'; baseRef?: string; intentFile?: string })

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  await appendFile(join(runDir, 'log.jsonl'), `${JSON.stringify({ ...entry, ts: Date.now() })}\n`)
}

export async function runSetup(input: RunSetupInput): Promise<number> {
  const deps = input.deps ?? defaultDeps()
  // Absolute so target.json and every git call agree on the repo whatever the cwd.
  const repoPath = resolve(input.repoPath)
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
  if (preResult.missingOptional.length > 0) {
    await logLine(input.runDir, {
      stage: 'preflight',
      status: 'done',
      missingOptional: preResult.missingOptional,
    })
    process.stderr.write(
      `magpie: optional dependency unavailable, some stages will be skipped:\n${renderInstallHint(preResult.missingOptional)}\n`,
    )
  } else {
    await logLine(input.runDir, { stage: 'preflight', status: 'done' })
  }

  const diffExit =
    input.mode === 'local'
      ? await writeLocalDiff(input.runDir, deps.git, repoPath, input.baseRef, input.intentFile)
      : await writePrDiff(input.runDir, deps, repoPath, input.prNumber)
  if (diffExit !== 0) {
    await cleanup(input.runDir)
    return diffExit
  }

  await applyPathFilter(input.runDir, repoPath)

  try {
    await runShard(input.runDir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logLine(input.runDir, { stage: 'shard', status: 'error', error: message })
    process.stderr.write(`magpie: ${message}\n`)
    await cleanup(input.runDir)
    return 6
  }

  await runTestsCheck(input.runDir)

  if (input.mode === 'local') {
    await logLine(input.runDir, { stage: 'setup', status: 'done', root: repoPath })
    return 0
  }

  await detectIncrementalReview(input.runDir, input.prNumber)

  const prJson = (await Bun.file(join(input.runDir, 'pr.json')).json()) as { headRefName: string }
  const branch = prJson.headRefName

  const wt = await createWorktree({
    gitBin: deps.git,
    repoPath,
    branch,
    runDir: input.runDir,
  })
  if (!wt.ok) {
    await logLine(input.runDir, { stage: 'worktree', status: 'error', error: wt.error })
    process.stderr.write(`magpie: ${wt.error}\n`)
    await cleanup(input.runDir)
    return 5
  }
  await writeTarget(input.runDir, { mode: 'pr', root: resolve(input.runDir, 'worktree') })
  await logLine(input.runDir, { stage: 'setup', status: 'done', worktree: wt.worktreePath })
  return 0
}

async function writePrDiff(
  runDir: string,
  deps: Deps,
  repoPath: string,
  prNumber: number,
): Promise<number> {
  const fetched = await fetchPr({
    ghBin: deps.gh,
    gitBin: deps.git,
    prNumber,
    runDir,
    cwd: repoPath,
  })
  if (!fetched.ok) {
    await logLine(runDir, { stage: 'fetch-pr', status: 'error', error: fetched.error })
    process.stderr.write(`magpie: ${fetched.error}\n`)
    return 4
  }
  await logLine(runDir, {
    stage: 'fetch-pr',
    status: 'done',
    source: fetched.source,
    ...(fetched.mergeBase ? { mergeBase: fetched.mergeBase } : {}),
  })
  // Sidecar so the report can say where the diff came from without re-parsing
  // log.jsonl, the same way incremental.json carries the incremental context.
  await writeFile(
    join(runDir, 'diff-source.json'),
    `${JSON.stringify({ source: fetched.source, mergeBase: fetched.mergeBase ?? null }, null, 2)}\n`,
  )
  return 0
}

async function writeLocalDiff(
  runDir: string,
  gitBin: string,
  repoPath: string,
  baseRef: string | undefined,
  intentFile: string | undefined,
): Promise<number> {
  const intentPath = intentFile === undefined ? null : resolve(intentFile)
  if (intentPath !== null && !existsSync(intentPath)) {
    const error = `intent file ${intentPath} does not exist`
    await logLine(runDir, { stage: 'local-diff', status: 'error', error })
    process.stderr.write(`magpie: ${error}\n`)
    return 4
  }
  const diff = await localBranchDiff({
    gitBin,
    repoPath,
    ...(baseRef !== undefined ? { baseRef } : {}),
  })
  if (!diff.ok) {
    await logLine(runDir, { stage: 'local-diff', status: 'error', error: diff.error })
    process.stderr.write(`magpie: ${diff.error}\n`)
    return 4
  }
  await writeFile(join(runDir, 'diff.patch'), diff.diff)
  const meta = await localBranchMeta({
    gitBin,
    repoPath,
    baseRef: diff.baseRef,
    mergeBase: diff.mergeBase,
    head: diff.head,
    intentFile: intentPath,
  })
  if (!meta.ok) {
    await logLine(runDir, { stage: 'local-diff', status: 'error', error: meta.error })
    process.stderr.write(`magpie: ${meta.error}\n`)
    return 4
  }
  // Hash the raw diff: applyPathFilter rewrites diff.patch next, and handoff
  // compares against a fresh raw diff, so a filtered hash would always read as stale.
  await writeFile(
    join(runDir, 'diff-source.json'),
    `${JSON.stringify(
      {
        source: 'local',
        mergeBase: diff.mergeBase,
        baseRef: diff.baseRef,
        head: diff.head,
        diffSha256: diffSha256(diff.diff),
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(join(runDir, 'local.json'), `${JSON.stringify(meta.meta, null, 2)}\n`)
  await writeTarget(runDir, { mode: 'local', root: repoPath })
  await logLine(runDir, {
    stage: 'local-diff',
    status: 'done',
    mergeBase: diff.mergeBase,
    baseRef: diff.baseRef,
  })
  return 0
}

async function cleanup(runDir: string): Promise<void> {
  // Names inside the run dir only: a local run's review root is the caller's repo.
  for (const name of [
    'worktree',
    'pr.json',
    'diff.patch',
    'diff.full.patch',
    'diff-source.json',
    'local.json',
    'target.json',
    'excluded-files.json',
    'shards',
    'incremental.json',
    'findings',
    'screen',
    'state',
  ]) {
    await rm(join(runDir, name), { recursive: true, force: true }).catch(() => {})
  }
}

async function runShard(runDir: string): Promise<void> {
  const manifest = await shardDiff(runDir)
  await logLine(runDir, {
    stage: 'shard',
    status: 'done',
    shards: manifest.shards.length,
    budget: manifest.budget,
    files: manifest.totalFiles,
    lines: manifest.totalLines,
  })
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
