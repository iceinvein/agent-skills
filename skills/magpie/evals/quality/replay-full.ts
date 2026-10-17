#!/usr/bin/env bun
// Re-runs stages 3 to 6 (context, specialists, dedupe, critic) on one corpus
// run's diff with a headless Claude session, matches the new kept findings to
// the labelled ones, and scores them. Spends real money: the whole review runs
// again, capped by --max-cost-usd.

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectMissingTests } from '../../scripts/tests-check.ts'
import {
  copyCorpusFiles,
  headRefOid,
  loadCorpusRun,
  readFindings,
  resolveCorpusRoot,
} from './corpus.ts'
import {
  DEFAULT_JUDGE_MODEL,
  judgeRecall,
  loadMisses,
  type RecallScore,
  type RecallVerdict,
  scoreRecall,
} from './recall.ts'
import { claudeFailureMessage, worktreeRemoveCommand } from './replay-critic.ts'
import {
  formatRatio,
  parseClaudeResult,
  parseFlags,
  positiveNumberFlag,
  resultTimestamp,
  scoreReplay,
} from './score.ts'

const SKILL_DIR = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const MAGPIE_BIN = join(SKILL_DIR, 'bin', 'magpie.ts')
const DEFAULT_MAX_COST_USD = 10

export type ReplayDiagnostics = {
  log: Array<Record<string, unknown>>
  shardManifest: unknown | null
  findingsFiles: string[]
  dedupedCount: number | null
  criticDropped: unknown | null
}

async function readJsonIfPresent(path: string): Promise<unknown | null> {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : err}`)
  }
}

/** What the scratch run dir says about the session, read before the dir is deleted:
 *  without it a thin result cannot be told apart as missed shards or critic drops. */
export async function replayDiagnostics(runDir: string): Promise<ReplayDiagnostics> {
  const logPath = join(runDir, 'log.jsonl')
  const log: Array<Record<string, unknown>> = []
  for (const [i, line] of (await readFile(logPath, 'utf8')).split('\n').entries()) {
    if (line.trim() === '') continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch (err) {
      throw new Error(
        `${logPath} line ${i + 1} is not valid JSON: ${err instanceof Error ? err.message : err}`,
      )
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${logPath} line ${i + 1} is not a JSON object`)
    }
    log.push(entry as Record<string, unknown>)
  }

  const dedupedPath = join(runDir, 'findings.deduped.json')
  const deduped = await readJsonIfPresent(dedupedPath)
  if (deduped !== null && !Array.isArray(deduped)) {
    throw new Error(`${dedupedPath} is not a JSON array`)
  }

  return {
    log,
    shardManifest: await readJsonIfPresent(join(runDir, 'shards', 'manifest.json')),
    findingsFiles: (await readdir(join(runDir, 'findings'))).sort(),
    dedupedCount: deduped === null ? null : deduped.length,
    criticDropped: await readJsonIfPresent(join(runDir, 'critic-dropped.json')),
  }
}

/** Shards some specialist wrote a findings file for, out of the manifest's shards.
 *  A single-shard run takes the unsharded path, so its files are `<focus>.json`;
 *  `tests.json` is the deterministic setup finding and proves no specialist ran. */
export function shardCoverageCount(
  manifest: unknown | null,
  findingsFiles: string[],
): { reviewed: number; total: number } {
  if (manifest === null) return { reviewed: 0, total: 0 }
  const shards =
    typeof manifest === 'object' && 'shards' in manifest ? manifest.shards : undefined
  if (!Array.isArray(shards)) throw new Error('shard manifest has no shards array')
  if (shards.length <= 1) {
    const reviewed = findingsFiles.some((f) => /^[^.]+\.json$/.test(f) && f !== 'tests.json')
    return { reviewed: reviewed && shards.length === 1 ? 1 : 0, total: shards.length }
  }
  const ids = new Set(
    shards.map((s, i) => {
      const id = typeof s === 'object' && s !== null && 'id' in s ? s.id : undefined
      if (typeof id !== 'number') throw new Error(`shard manifest shards[${i}] has no numeric id`)
      return id
    }),
  )
  const reviewed = new Set<number>()
  for (const f of findingsFiles) {
    const m = /^[^.]+\.shard-(\d+)\.json$/.exec(f)
    if (m && ids.has(Number(m[1]))) reviewed.add(Number(m[1]))
  }
  return { reviewed: reviewed.size, total: shards.length }
}

export function replaySummary(input: {
  runId: string
  kept: number
  unlabelled: number
  precision: number | null
  recall: number | null
  costUsd: number | null
  missedRecall: { caught: number; misses: number } | null
  coverage: { reviewed: number; total: number }
  outPath: string
}): string {
  const missed =
    input.missedRecall === null
      ? ''
      : `, missed-recall ${input.missedRecall.caught}/${input.missedRecall.misses}`
  return (
    `${input.runId}: kept ${input.kept} (${input.unlabelled} unlabelled), ` +
    `precision ${formatRatio(input.precision)}, recall ${formatRatio(input.recall)}, ` +
    `cost ${input.costUsd === null ? 'unreported' : `$${input.costUsd.toFixed(2)}`}${missed}, ` +
    `shards ${input.coverage.reviewed}/${input.coverage.total}\n` +
    `wrote ${input.outPath}\n`
  )
}

async function exec(
  cmd: string[],
  options: { cwd?: string; stdinText?: string; claudeLabel?: string } = {},
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdin: options.stdinText === undefined ? 'ignore' : new Blob([options.stdinText]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0) {
    throw new Error(
      options.claudeLabel === undefined
        ? `${cmd.slice(0, 3).join(' ')} exit ${exit}: ${stderr.trim()}`
        : claudeFailureMessage(options.claudeLabel, exit, stdout, stderr),
    )
  }
  return stdout
}

function resumePrompt(runDir: string, prNumber: number): string {
  return `Read ${SKILL_DIR}/SKILL.md and follow it to resume the magpie review run at ${runDir}
(PR #${prNumber}). Wherever SKILL.md says \`magpie <args>\`, run
\`bun ${MAGPIE_BIN} <args>\` instead, so this checkout's CLI is the one under test.

Setup is already done: the worktree is ${runDir}/worktree and shards are written.
Run \`bun ${MAGPIE_BIN} status ${runDir}\` and resume from \`next\` through stage 3
(context), stage 4 (specialists), stage 5 (dedupe) and stage 6 (critic). Stop as soon
as ${runDir}/findings.kept.json is written by critic-apply.

This is an unattended evaluation run:
- Skip stage 2 (serve) and every progress re-render.
- Do not run peer review, report, post or cleanup, and post nothing to GitHub.
- If the shard gate would stop to ask, proceed as sharded.
- Never ask a question; there is no one to answer it.`
}

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv, ['corpus', 'repo', 'out', 'max-cost-usd', 'judge-model'])
  if (!flags.corpus || !flags.repo) {
    throw new Error(
      'usage: replay-full.ts --corpus <runId> --repo <path> [--max-cost-usd N] ' +
        '[--judge-model M] [--out <corpus-dir>]',
    )
  }
  const maxCostUsd = positiveNumberFlag(flags, 'max-cost-usd') ?? DEFAULT_MAX_COST_USD
  const judgeModel = flags['judge-model'] ?? DEFAULT_JUDGE_MODEL
  const corpusRoot = resolveCorpusRoot(flags)
  const run = await loadCorpusRun(join(corpusRoot, flags.corpus))
  const sha = headRefOid(run)
  const prNumber = run.pr?.number
  if (typeof prNumber !== 'number') throw new Error(`${join(run.dir, 'pr.json')} has no number`)
  await exec(['git', '-C', flags.repo, 'cat-file', '-e', `${sha}^{commit}`]).catch((err) => {
    throw new Error(
      `commit ${sha} is not in ${flags.repo}; fetch the PR head there first (${err.message})`,
    )
  })

  const scratch = await mkdtemp(join(tmpdir(), 'magpie-replay-full-'))
  const worktree = join(scratch, 'worktree')
  let worktreeCreated = false
  try {
    await exec(['git', '-C', flags.repo, 'worktree', 'add', '--detach', worktree, sha])
    worktreeCreated = true
    await copyCorpusFiles(run, scratch, ['pr.json', 'diff.patch'])
    if (!(await Bun.file(join(scratch, 'diff.patch')).exists())) {
      throw new Error(`${run.dir} has no diff.patch to review`)
    }

    // Stand in for `magpie setup`, which needs gh and the live PR: the tests
    // domain finding and the setup log line are what stage 3 onwards expect.
    await mkdir(join(scratch, 'findings'))
    const testsFindings = detectMissingTests(await Bun.file(join(scratch, 'diff.patch')).text())
    if (testsFindings.length > 0) {
      await writeFile(
        join(scratch, 'findings', 'tests.json'),
        `${JSON.stringify(testsFindings, null, 2)}\n`,
      )
    }
    await writeFile(
      join(scratch, 'log.jsonl'),
      `${JSON.stringify({ stage: 'setup', status: 'done', worktree, ts: Date.now() })}\n`,
    )
    await exec(['bun', MAGPIE_BIN, 'shard', scratch])

    const stdout = await exec(
      [
        'claude',
        '-p',
        '--allowedTools',
        'Bash,Read,Grep,Glob,Write,Edit,Agent',
        '--max-budget-usd',
        String(maxCostUsd),
        '--output-format',
        'json',
        '--add-dir',
        scratch,
        '--add-dir',
        SKILL_DIR,
      ],
      { cwd: worktree, stdinText: resumePrompt(scratch, prNumber), claudeLabel: 'full replay' },
    )
    const { costUsd } = parseClaudeResult(stdout, 'full replay')

    const newKept = await readFindings(join(scratch, 'findings.kept.json'))
    const { score, unlabelled, matches } = scoreReplay({
      labels: run.labels,
      labelled: run.final,
      newKept,
    })

    const diagnostics = await replayDiagnostics(scratch)

    const resultsDir = join(corpusRoot, 'results')
    await mkdir(resultsDir, { recursive: true })
    const outPath = join(resultsDir, `${resultTimestamp(new Date())}-full-${run.runId}.json`)
    const result = {
      tier: 'full',
      runId: run.runId,
      sha,
      maxCostUsd,
      costUsd,
      unlabelled,
      matches: Object.fromEntries(matches),
      newKept,
      score,
      recall: null as RecallScore | null,
      recallVerdicts: null as RecallVerdict[] | null,
      judgeModel: null as string | null,
      judgeCostUsd: null as number | null,
      ...diagnostics,
    }
    // Written before the judge runs so a judge failure cannot lose a paid replay.
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`)

    try {
      const misses = await loadMisses(join(corpusRoot, 'misses', `${run.runId}.json`))
      if (misses !== null) {
        const judged = await judgeRecall({
          misses,
          findings: newKept,
          model: judgeModel,
          cwd: scratch,
        })
        result.recall = scoreRecall(misses, judged.verdicts)
        result.recallVerdicts = judged.verdicts
        result.judgeModel = judgeModel
        result.judgeCostUsd = judged.costUsd
        await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`)
      }
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : err} (replay result already written to ${outPath})`,
      )
    }

    process.stdout.write(
      replaySummary({
        runId: run.runId,
        kept: score.kept,
        unlabelled,
        precision: score.precision,
        recall: score.recall,
        costUsd,
        missedRecall: result.recall,
        coverage: shardCoverageCount(diagnostics.shardManifest, diagnostics.findingsFiles),
        outPath,
      }),
    )
    return 0
  } finally {
    // A failed removal must not mask the error that got us here, but it must be seen.
    const removeCommand = worktreeRemoveCommand(flags.repo, worktree, worktreeCreated)
    if (removeCommand) {
      await exec(removeCommand).catch((err) => {
        process.stderr.write(`replay-full: worktree removal failed: ${err.message}\n`)
        process.exitCode = 1
      })
    }
    await rm(scratch, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(process.exitCode || code),
    (err) => {
      process.stderr.write(`replay-full: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    },
  )
}
