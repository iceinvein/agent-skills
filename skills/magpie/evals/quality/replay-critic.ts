#!/usr/bin/env bun
// Re-runs only the critic stage on one corpus run, against the same deduped
// candidates and the same PR head, and scores the new selection against the
// run's labels. Spends money: one `claude -p` per critic batch.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { originalSelection } from './baseline.ts'
import {
  copyCorpusFiles,
  headRefOid,
  loadCorpusRun,
  readFindings,
  resolveCorpusRoot,
} from './corpus.ts'
import {
  formatRatio,
  parseClaudeResult,
  parseFlags,
  resultTimestamp,
  scoreSelection,
} from './score.ts'

const MAGPIE_BIN = new URL('../../bin/magpie.ts', import.meta.url).pathname

/**
 * A non-zero `claude -p` exit often says why only in its JSON result on
 * stdout (budget, turns), so stderr alone hides the cause.
 */
export function claudeFailureMessage(
  label: string,
  exit: number,
  stdout: string,
  stderr: string,
): string {
  let detail = `stdout: ${stdout.trim()}`
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (parsed && typeof parsed === 'object') {
      const result = parsed as Record<string, unknown>
      detail = `is_error ${String(result.is_error)}, subtype ${String(result.subtype)}`
    }
  } catch {
    // Not JSON, so the raw stdout is the best account of the failure.
  }
  return `${label}: claude -p exit ${exit}; ${detail}; stderr: ${stderr.trim()}`
}

// Removing a worktree that `worktree add` never created fails and its error
// would bury the one that stopped the run.
export function worktreeRemoveCommand(
  repo: string,
  worktree: string,
  created: boolean,
): string[] | null {
  return created ? ['git', '-C', repo, 'worktree', 'remove', '--force', worktree] : null
}

async function exec(
  cmd: string[],
  options: {
    cwd?: string
    stdinPath?: string
    claudeLabel?: string
    inFlight?: Set<Subprocess>
  } = {},
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdin: options.stdinPath ? Bun.file(options.stdinPath) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  options.inFlight?.add(proc)
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  options.inFlight?.delete(proc)
  if (exit !== 0) {
    throw new Error(
      options.claudeLabel === undefined
        ? `${cmd.slice(0, 3).join(' ')} exit ${exit}: ${stderr.trim()}`
        : claudeFailureMessage(options.claudeLabel, exit, stdout, stderr),
    )
  }
  return stdout
}

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv, ['corpus', 'repo', 'out'])
  if (!flags.corpus || !flags.repo) {
    throw new Error('usage: replay-critic.ts --corpus <runId> --repo <path> [--out <corpus-dir>]')
  }
  const corpusRoot = resolveCorpusRoot(flags)
  const run = await loadCorpusRun(join(corpusRoot, flags.corpus))
  if (!run.deduped) throw new Error(`${run.dir} has no findings.deduped.json to replay`)
  const deduped = run.deduped
  const sha = headRefOid(run)
  await exec(['git', '-C', flags.repo, 'cat-file', '-e', `${sha}^{commit}`]).catch((err) => {
    throw new Error(
      `commit ${sha} is not in ${flags.repo}; fetch the PR head there first (${err.message})`,
    )
  })

  const scratch = await mkdtemp(join(tmpdir(), 'magpie-replay-critic-'))
  const worktree = join(scratch, 'worktree')
  let worktreeCreated = false
  try {
    await exec(['git', '-C', flags.repo, 'worktree', 'add', '--detach', worktree, sha])
    worktreeCreated = true
    await copyCorpusFiles(run, scratch, [
      'pr.json',
      'diff.patch',
      'findings.deduped.json',
      'merge-candidates.json',
      'brief.json',
    ])

    const batches = (await exec(['bun', MAGPIE_BIN, 'critic-prompt', scratch]))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [promptPath, outputPath] = line.split('\t')
        if (!promptPath || !outputPath) throw new Error(`critic-prompt printed ${line}`)
        return { promptPath, outputPath }
      })

    // One failed batch fails the replay, so the others are killed rather than
    // left spending money and writing into a worktree about to be removed.
    const inFlight = new Set<Subprocess>()
    let costs: Array<number | null>
    try {
      costs = await Promise.all(
        batches.map(async (b, i) => {
          const label = `critic batch ${i + 1}`
          const stdout = await exec(
            [
              'claude',
              '-p',
              '--allowedTools',
              'Read,Grep,Glob,Write',
              '--output-format',
              'json',
              '--add-dir',
              scratch,
            ],
            { cwd: worktree, stdinPath: b.promptPath, claudeLabel: label, inFlight },
          )
          const { costUsd } = parseClaudeResult(stdout, label)
          if (!(await Bun.file(b.outputPath).exists())) {
            throw new Error(`${label} finished without writing ${b.outputPath}`)
          }
          return costUsd
        }),
      )
    } catch (err) {
      const children = [...inFlight]
      for (const child of children) child.kill()
      await Promise.all(children.map((child) => child.exited))
      throw err
    }

    await exec(['bun', MAGPIE_BIN, 'critic-apply', scratch])
    const kept = await readFindings(join(scratch, 'findings.kept.json'))
    const score = scoreSelection({
      labels: run.labels,
      keptIds: kept.map((f) => f.id),
      findings: deduped,
    })
    const baseline = scoreSelection(originalSelection(run))
    const reported = costs.filter((c): c is number => c !== null)
    const costUsd =
      reported.length === costs.length ? reported.reduce((sum, c) => sum + c, 0) : null

    const resultsDir = join(corpusRoot, 'results')
    await mkdir(resultsDir, { recursive: true })
    const outPath = join(resultsDir, `${resultTimestamp(new Date())}-critic-${run.runId}.json`)
    const result = {
      tier: 'critic',
      runId: run.runId,
      sha,
      batches: batches.length,
      costUsd,
      keptIds: kept.map((f) => f.id),
      score,
      baseline,
    }
    await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`)
    process.stdout.write(
      `${run.runId}: kept ${score.kept} (was ${baseline.kept}), ` +
        `precision ${formatRatio(score.precision)} (was ${formatRatio(baseline.precision)}), ` +
        `recall ${formatRatio(score.recall)} (was ${formatRatio(baseline.recall)}), ` +
        `cost ${costUsd === null ? 'unreported' : `$${costUsd.toFixed(2)}`}\nwrote ${outPath}\n`,
    )
    return 0
  } finally {
    // A failed removal must not mask the error that got us here, but it must be seen.
    const removeCommand = worktreeRemoveCommand(flags.repo, worktree, worktreeCreated)
    if (removeCommand) {
      await exec(removeCommand).catch((err) => {
        process.stderr.write(`replay-critic: worktree removal failed: ${err.message}\n`)
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
      process.stderr.write(`replay-critic: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    },
  )
}
