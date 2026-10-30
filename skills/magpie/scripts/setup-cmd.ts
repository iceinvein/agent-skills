import { appendFile, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fetchPr } from './gh.ts'
import { resolvePrHead } from './git-diff.ts'
import { buildIncrementalContext, changedFilesSince, findPreviousRun } from './incremental.ts'
import { diffSha256, localBranchDiff, localBranchMeta } from './local-diff.ts'
import { filterDiff, loadPathFilterConfig } from './path-filter.ts'
import { fetchPrActivity } from './pr-activity.ts'
import { type Deps, defaultDeps, preflight, renderInstallHint } from './preflight.ts'
import { readPreviousFindings, writePreviousFindings } from './previous-findings.ts'
import { shardDiff } from './shard.ts'
import { writeTarget } from './target.ts'
import { detectMissingTests } from './tests-check.ts'
import { createWorktree, removeWorktree } from './worktree.ts'

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
  // Resolved once so the inside-repo guard checks the same path mkdir creates:
  // left raw, the OS would follow `..` through a symlink the guard resolved textually.
  const runDir = resolve(input.runDir)
  if (input.mode === 'local') {
    const repoStat = await stat(repoPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    if (repoStat === null) {
      process.stderr.write(`magpie: --repo ${repoPath} does not exist\n`)
      return 2
    }
    if (!repoStat.isDirectory()) {
      process.stderr.write(`magpie: --repo ${repoPath} is not a directory\n`)
      return 2
    }
    // Checked before any mkdir: a --repo below the root would otherwise let a
    // run dir elsewhere in the repo pass the guard below and be created there.
    const top = await gitToplevel(deps.git, repoPath)
    if (!top.ok) {
      process.stderr.write(`magpie: ${top.error}\n`)
      return 2
    }
    if ((await realpath(repoPath)) !== (await realpath(top.root))) {
      process.stderr.write(`magpie: --repo ${repoPath} is not the repository root ${top.root}\n`)
      return 2
    }
    // Local mode reviews the repo in place, so a run dir inside it would be
    // written to and its rollback would delete the caller's files.
    if (await isWithin(runDir, top.root)) {
      process.stderr.write(
        `magpie: run dir ${runDir} is inside the repository under review ${top.root}\n`,
      )
      return 2
    }
  }
  await mkdir(runDir, { recursive: true })
  await mkdir(join(runDir, 'findings'), { recursive: true })
  await mkdir(join(runDir, 'screen'), { recursive: true })
  await mkdir(join(runDir, 'state'), { recursive: true })

  const preResult = await preflight(deps)
  if (!preResult.ok) {
    await logLine(runDir, { stage: 'setup', status: 'error', missing: preResult.missing })
    process.stderr.write(`magpie: missing dependencies:\n${renderInstallHint(preResult.missing)}\n`)
    await cleanup(runDir)
    return 3
  }
  if (preResult.missingOptional.length > 0) {
    await logLine(runDir, {
      stage: 'preflight',
      status: 'done',
      missingOptional: preResult.missingOptional,
    })
    process.stderr.write(
      `magpie: optional dependency unavailable, some stages will be skipped:\n${renderInstallHint(preResult.missingOptional)}\n`,
    )
  } else {
    await logLine(runDir, { stage: 'preflight', status: 'done' })
  }

  const diffExit =
    input.mode === 'local'
      ? await writeLocalDiff(runDir, deps.git, repoPath, input.baseRef, input.intentFile)
      : await writePrDiff(runDir, deps, repoPath, input.prNumber)
  if (diffExit !== 0) {
    await cleanup(runDir)
    return diffExit
  }
  if (input.mode === 'pr') {
    const activityExit = await writePrActivity(runDir, deps, repoPath, input.prNumber)
    if (activityExit !== 0) {
      await cleanup(runDir)
      return activityExit
    }
  }

  await applyPathFilter(runDir, repoPath)

  try {
    await runShard(runDir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logLine(runDir, { stage: 'shard', status: 'error', error: message })
    process.stderr.write(`magpie: ${message}\n`)
    await cleanup(runDir)
    return 6
  }

  await runTestsCheck(runDir)

  if (input.mode === 'local') {
    await logLine(runDir, { stage: 'setup', status: 'done', root: repoPath })
    return 0
  }

  const prJson = (await Bun.file(join(runDir, 'pr.json')).json()) as { headRefOid: string }
  const head = await resolvePrHead({
    gitBin: deps.git,
    repoPath,
    prNumber: input.prNumber,
    headRefOid: prJson.headRefOid,
  })
  if (!head.ok) {
    await logLine(runDir, { stage: 'worktree', status: 'error', error: head.error })
    process.stderr.write(`magpie: ${head.error}\n`)
    await cleanup(runDir)
    return 5
  }

  let previous: { runId: string; runDir: string } | null
  try {
    previous = await detectIncrementalReview(runDir, deps.git, repoPath, input.prNumber)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logLine(runDir, { stage: 'incremental', status: 'error', error: message })
    process.stderr.write(`magpie: ${message}\n`)
    await cleanup(runDir)
    return 4
  }

  const wt = await createWorktree({
    gitBin: deps.git,
    repoPath,
    branch: head.sha,
    runDir: runDir,
  })
  if (!wt.ok) {
    await logLine(runDir, { stage: 'worktree', status: 'error', error: wt.error })
    process.stderr.write(`magpie: ${wt.error}\n`)
    await cleanup(runDir)
    return 5
  }
  try {
    await writeTarget(runDir, { mode: 'pr', root: resolve(runDir, 'worktree') })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logLine(runDir, { stage: 'worktree', status: 'error', error: message })
    process.stderr.write(`magpie: ${message}\n`)
    // The worktree is registered in the caller's repo; deleting the dir alone would leave it listed.
    const removed = await removeWorktree({
      gitBin: deps.git,
      repoPath,
      worktreePath: wt.worktreePath,
    })
    if (!removed.ok) process.stderr.write(`magpie: ${removed.error}\n`)
    await cleanup(runDir)
    return 5
  }
  if (previous) {
    try {
      await carryPreviousFindings(runDir, previous, wt.worktreePath)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logLine(runDir, { stage: 'previous-findings', status: 'error', error: message })
      process.stderr.write(`magpie: ${message}\n`)
      const removed = await removeWorktree({
        gitBin: deps.git,
        repoPath,
        worktreePath: wt.worktreePath,
      })
      if (!removed.ok) process.stderr.write(`magpie: ${removed.error}\n`)
      await cleanup(runDir)
      return 5
    }
  }
  await logLine(runDir, { stage: 'setup', status: 'done', worktree: wt.worktreePath })
  return 0
}

async function writePrActivity(
  runDir: string,
  deps: Deps,
  repoPath: string,
  prNumber: number,
): Promise<number> {
  const fail = async (error: string): Promise<number> => {
    await logLine(runDir, { stage: 'pr-activity', status: 'error', error })
    process.stderr.write(`magpie: ${error}\n`)
    return 4
  }
  const prJson = (await Bun.file(join(runDir, 'pr.json')).json()) as { url?: unknown }
  if (typeof prJson.url !== 'string') return fail('pr.json has no url')
  let result: Awaited<ReturnType<typeof fetchPrActivity>>
  try {
    result = await fetchPrActivity({
      ghBin: deps.gh,
      prNumber,
      prUrl: prJson.url,
      runDir,
      cwd: repoPath,
    })
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  if (!result.ok) return fail(result.error)
  await logLine(runDir, {
    stage: 'pr-activity',
    status: 'done',
    checks: result.activity.checks.length,
    threads: result.activity.threads.length,
    comments: result.activity.comments.length,
  })
  return 0
}

async function carryPreviousFindings(
  runDir: string,
  previous: { runId: string; runDir: string },
  worktree: string,
): Promise<void> {
  const carried = await readPreviousFindings({
    runDir: previous.runDir,
    runId: previous.runId,
    worktree,
  })
  if (!carried) {
    await logLine(runDir, {
      stage: 'previous-findings',
      status: 'none',
      previousRunId: previous.runId,
    })
    return
  }
  await writePreviousFindings(runDir, carried)
  await logLine(runDir, {
    stage: 'previous-findings',
    status: 'done',
    previousRunId: previous.runId,
    findings: carried.findings.length,
  })
}

/** realpath of the nearest existing ancestor, with the not-yet-created tail re-appended. */
async function realpathAllowingMissing(path: string): Promise<string> {
  const absolute = resolve(path)
  try {
    return await realpath(absolute)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
    const parent = dirname(absolute)
    if (parent === absolute) throw err
    return join(await realpathAllowingMissing(parent), basename(absolute))
  }
}

async function gitToplevel(
  gitBin: string,
  repoPath: string,
): Promise<{ ok: true; root: string } | { ok: false; error: string }> {
  const proc = Bun.spawn([gitBin, 'rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if ((await proc.exited) !== 0) {
    return {
      ok: false,
      error: `--repo ${repoPath} is not inside a git work tree: ${stderr.trim()}`,
    }
  }
  return { ok: true, root: stdout.trim() }
}

async function isWithin(path: string, root: string): Promise<boolean> {
  const rel = relative(await realpathAllowingMissing(root), await realpathAllowingMissing(path))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
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
  if (intentPath !== null) {
    const intentStat = await stat(intentPath).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null
      throw err
    })
    let error: string | null = null
    if (intentStat === null) error = `intent file ${intentPath} does not exist`
    else if (!intentStat.isFile()) error = `intent file ${intentPath} is not a file`
    if (error !== null) {
      await logLine(runDir, { stage: 'local-diff', status: 'error', error })
      process.stderr.write(`magpie: ${error}\n`)
      return 4
    }
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
    'pr-activity.json',
    'previous-findings.json',
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

/** The previous run, for setup to carry its findings forward once the worktree exists. */
async function detectIncrementalReview(
  runDir: string,
  gitBin: string,
  repoPath: string,
  prNumber: number,
): Promise<{ runId: string; runDir: string } | null> {
  const currentPr = (await Bun.file(join(runDir, 'pr.json')).json()) as Record<string, unknown>
  if (typeof currentPr.url !== 'string') throw new Error('pr.json has no url')
  const previous = await findPreviousRun(prNumber, currentPr.url, runDir)
  if (!previous) {
    await logLine(runDir, { stage: 'incremental', status: 'first-run' })
    return null
  }
  const context = buildIncrementalContext(currentPr, previous)
  if (!context) {
    await logLine(runDir, { stage: 'incremental', status: 'missing-sha' })
    return previous
  }
  const changedSincePrevious = context.sameSha
    ? []
    : await changedFilesSince({
        gitBin,
        repoPath,
        fromSha: context.previousSha,
        toSha: context.currentSha,
      })
  await writeFile(
    join(runDir, 'incremental.json'),
    `${JSON.stringify({ ...context, changedSincePrevious }, null, 2)}\n`,
  )
  await logLine(runDir, {
    stage: 'incremental',
    status: 'done',
    previousRunId: context.previousRunId,
    sameSha: context.sameSha,
  })
  return previous
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
