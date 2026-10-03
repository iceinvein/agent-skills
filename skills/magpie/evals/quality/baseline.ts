#!/usr/bin/env bun
// Scores each corpus run's original critic selection (findings.kept.json)
// against its labels: the number a replayed critic has to beat.

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type CorpusRun, listCorpusRuns, loadCorpusRun, resolveCorpusRoot } from './corpus.ts'
import {
  formatRatio,
  parseFlags,
  poolRuns,
  type QualityScore,
  resultTimestamp,
  scoreSelection,
} from './score.ts'

/** The critic chose from findings.deduped.json, so that is the pool recall counts against. */
export function originalSelection(run: CorpusRun) {
  if (!run.kept) throw new Error(`${run.dir} has no findings.kept.json`)
  if (!run.deduped) throw new Error(`${run.dir} has no findings.deduped.json`)
  return {
    runId: run.runId,
    labels: run.labels,
    keptIds: run.kept.map((f) => f.id),
    findings: run.deduped,
  }
}

const DISMISS_COLUMNS = ['wrong', 'not-worth-it', 'duplicate', 'style']

function row(name: string, s: QualityScore): string[] {
  return [
    name,
    String(s.kept),
    String(s.posted),
    String(s.postedKept),
    formatRatio(s.precision),
    formatRatio(s.recall),
    ...DISMISS_COLUMNS.map((r) => String(s.dismissedKept[r] ?? 0)),
  ]
}

function renderTable(rows: string[][]): string {
  const header = ['run', 'kept', 'posted', 'postedKept', 'precision', 'recall', ...DISMISS_COLUMNS]
  const all = [header, ...rows]
  const widths = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? '').length)))
  return all.map((r) => r.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ')).join('\n')
}

async function main(argv: string[]): Promise<number> {
  const corpusRoot = resolveCorpusRoot(parseFlags(argv, ['out']))
  const selections = []
  for (const runId of await listCorpusRuns(corpusRoot)) {
    selections.push(originalSelection(await loadCorpusRun(join(corpusRoot, runId))))
  }
  if (selections.length === 0) throw new Error(`no corpus runs in ${corpusRoot}; run corpus.ts`)

  const runs = selections.map((s) => ({ runId: s.runId, score: scoreSelection(s) }))
  const total = scoreSelection(poolRuns(selections))
  process.stdout.write(
    `${renderTable([...runs.map((r) => row(r.runId, r.score)), row('TOTAL', total)])}\n`,
  )

  const resultsDir = join(corpusRoot, 'results')
  await mkdir(resultsDir, { recursive: true })
  const outPath = join(resultsDir, `${resultTimestamp(new Date())}-baseline.json`)
  await writeFile(outPath, `${JSON.stringify({ tier: 'baseline', runs, total }, null, 2)}\n`)
  process.stdout.write(`wrote ${outPath}\n`)
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`baseline: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    },
  )
}
