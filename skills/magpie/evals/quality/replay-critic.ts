#!/usr/bin/env bun
// Re-runs only the critic stage on one corpus run, against the same deduped
// candidates and the same PR head, and scores the new selection against the
// run's labels. Spends money: one `claude -p` per critic batch.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

async function exec(
  cmd: string[],
  options: { cwd?: string; stdinPath?: string } = {},
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    stdin: options.stdinPath ? Bun.file(options.stdinPath) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exit !== 0) throw new Error(`${cmd.slice(0, 3).join(' ')} exit ${exit}: ${stderr.trim()}`)
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
  try {
    await exec(['git', '-C', flags.repo, 'worktree', 'add', '--detach', worktree, sha])
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

    const costs = await Promise.all(
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
          { cwd: worktree, stdinPath: b.promptPath },
        )
        const { costUsd } = parseClaudeResult(stdout, label)
        if (!(await Bun.file(b.outputPath).exists())) {
          throw new Error(`${label} finished without writing ${b.outputPath}`)
        }
        return costUsd
      }),
    )

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
    await exec(['git', '-C', flags.repo, 'worktree', 'remove', '--force', worktree]).catch(
      (err) => {
        process.stderr.write(`replay-critic: worktree removal failed: ${err.message}\n`)
        process.exitCode = 1
      },
    )
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
