#!/usr/bin/env bun
// Builds the quality-eval corpus: one directory per labelled magpie run, holding
// the run's findings and a labels.json folded from what the reviewer posted or
// dismissed. The corpus holds client code, so it never lives inside the repo.

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { reviewHome } from '../../scripts/housekeeping-cmd.ts'
import { type FindingLabel, foldLabels, readJsonLines } from '../../scripts/labels.ts'
import { type PostStatusMap, parseFinding, type ReviewFinding } from '../../scripts/types.ts'
import { parseFlags } from './score.ts'

export const MAGPIE_ROOT = reviewHome()
export const DEFAULT_CORPUS_ROOT = join(MAGPIE_ROOT, 'corpus')

export const CORPUS_FILES = [
  'pr.json',
  'diff.patch',
  'findings.deduped.json',
  'findings.kept.json',
  'findings.final.json',
  'merge-candidates.json',
  'brief.json',
] as const

/** The directory holding `.git` above this script: the repo the corpus must stay out of. */
export function findRepoRoot(fromDir: string): string {
  let dir = fromDir
  while (!existsSync(join(dir, '.git'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no .git found above ${fromDir}`)
    dir = parent
  }
  return dir
}

export function assertOutsideRepo(corpusRoot: string, repoRoot: string): void {
  const rel = relative(repoRoot, corpusRoot)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(
      `corpus dir ${corpusRoot} is inside the repo at ${repoRoot}; it holds client code`,
    )
  }
}

/** `--out <dir>` overrides the corpus root, for tests and dry runs. */
export function resolveCorpusRoot(flags: Record<string, string>): string {
  const root = resolve(flags.out ?? DEFAULT_CORPUS_ROOT)
  assertOutsideRepo(root, findRepoRoot(dirname(new URL(import.meta.url).pathname)))
  return root
}

/** Runs under `magpieRoot`, active or archived, that posted and have final findings. */
export async function listSourceRuns(magpieRoot: string): Promise<string[]> {
  const names = (await readdir(magpieRoot)).filter((n) => !n.startsWith('preview-')).sort()
  const runs: string[] = []
  for (const name of names) {
    const dir = join(magpieRoot, name)
    if (!(await stat(dir)).isDirectory()) continue
    if (!existsSync(join(dir, 'post-status.json'))) continue
    if (!existsSync(join(dir, 'findings.final.json'))) continue
    runs.push(name)
  }
  return runs
}

async function readJsonFile(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err instanceof Error ? err.message : err}`)
  }
}

async function readOptionalJson(path: string): Promise<unknown | null> {
  if (!existsSync(path)) return null
  return readJsonFile(path)
}

function parseFindings(raw: unknown, path: string): ReviewFinding[] {
  if (!Array.isArray(raw)) throw new Error(`${path} is not a JSON array`)
  return raw.map((f, i) => {
    try {
      return parseFinding(f)
    } catch (err) {
      throw new Error(`${path}[${i}]: ${err instanceof Error ? err.message : err}`)
    }
  })
}

export async function readFindings(path: string): Promise<ReviewFinding[]> {
  return parseFindings(await readJsonFile(path), path)
}

async function readOptionalFindings(path: string): Promise<ReviewFinding[] | null> {
  const raw = await readOptionalJson(path)
  return raw === null ? null : parseFindings(raw, path)
}

const LABEL_KINDS = ['posted', 'dismissed', 'ignored']

function parseLabels(raw: unknown, path: string): FindingLabel[] {
  if (!Array.isArray(raw)) throw new Error(`${path} is not a JSON array`)
  for (const [i, l] of raw.entries()) {
    const entry = l as Record<string, unknown> | null
    if (typeof entry?.id !== 'string' || !LABEL_KINDS.includes(entry.label as string)) {
      throw new Error(`${path}[${i}] is not a finding label`)
    }
  }
  return raw as FindingLabel[]
}

export type CorpusRun = {
  runId: string
  dir: string
  pr: Record<string, unknown> | null
  deduped: ReviewFinding[] | null
  kept: ReviewFinding[] | null
  final: ReviewFinding[]
  labels: FindingLabel[]
  mergeCandidates: string[][] | null
}

/** Old runs predate merge candidates and briefs; those load as null. */
export async function loadCorpusRun(dir: string): Promise<CorpusRun> {
  const mergePath = join(dir, 'merge-candidates.json')
  const merge = await readOptionalJson(mergePath)
  if (
    merge !== null &&
    !(
      Array.isArray(merge) &&
      merge.every((g) => Array.isArray(g) && g.every((id) => typeof id === 'string'))
    )
  ) {
    throw new Error(`${mergePath} is not an array of id arrays`)
  }
  const prPath = join(dir, 'pr.json')
  const pr = await readOptionalJson(prPath)
  if (pr !== null && (typeof pr !== 'object' || Array.isArray(pr))) {
    throw new Error(`${prPath} is not a JSON object`)
  }
  const labelsPath = join(dir, 'labels.json')
  return {
    runId: dir.split('/').pop() as string,
    dir,
    pr: pr as Record<string, unknown> | null,
    deduped: await readOptionalFindings(join(dir, 'findings.deduped.json')),
    kept: await readOptionalFindings(join(dir, 'findings.kept.json')),
    final: await readFindings(join(dir, 'findings.final.json')),
    labels: parseLabels(await readJsonFile(labelsPath), labelsPath),
    mergeCandidates: merge as string[][] | null,
  }
}

export async function listCorpusRuns(corpusRoot: string): Promise<string[]> {
  const names = (await readdir(corpusRoot)).filter((n) => n !== 'results').sort()
  const runs: string[] = []
  for (const name of names) {
    if ((await stat(join(corpusRoot, name))).isDirectory()) runs.push(name)
  }
  return runs
}

/**
 * Copies one run into `outDir` and writes its labels.json. Labels cover every
 * final id plus kept ids that did not reach final (peer review dropped them);
 * those were never shown, so they fold to `ignored`.
 */
export async function buildCorpusRun(srcDir: string, outDir: string): Promise<FindingLabel[]> {
  const final = await readFindings(join(srcDir, 'findings.final.json'))
  const kept = await readOptionalFindings(join(srcDir, 'findings.kept.json'))
  const finalIds = final.map((f) => f.id)
  const finalSet = new Set(finalIds)
  const findingIds = [
    ...finalIds,
    ...(kept ?? []).map((f) => f.id).filter((id) => !finalSet.has(id)),
  ]

  const postStatusPath = join(srcDir, 'post-status.json')
  const postStatus = (await readJsonFile(postStatusPath)) as PostStatusMap
  if (typeof postStatus !== 'object' || postStatus === null || Array.isArray(postStatus)) {
    throw new Error(`${postStatusPath} is not a JSON object`)
  }
  const labels = foldLabels({
    findingIds,
    postStatus,
    events: await readJsonLines(join(srcDir, 'state', 'events')),
    log: await readJsonLines(join(srcDir, 'log.jsonl')),
  })

  // Every present JSON file is parsed before anything is copied, so a corrupt
  // source fails the build rather than landing in the corpus.
  for (const name of CORPUS_FILES) {
    if (name.endsWith('.json')) await readOptionalJson(join(srcDir, name))
  }
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  for (const name of CORPUS_FILES) {
    const src = join(srcDir, name)
    if (existsSync(src)) await copyFile(src, join(outDir, name))
  }
  await writeFile(join(outDir, 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`)
  return labels
}

/** The PR head the run reviewed, which a replay checks out to read the same code. */
export function headRefOid(run: CorpusRun): string {
  const sha = run.pr?.headRefOid
  if (typeof sha !== 'string' || sha === '') {
    throw new Error(`${join(run.dir, 'pr.json')} has no headRefOid`)
  }
  return sha
}

/** Copies the named corpus files that this run has into a scratch run dir. */
export async function copyCorpusFiles(
  run: CorpusRun,
  destDir: string,
  names: Array<(typeof CORPUS_FILES)[number]>,
): Promise<void> {
  for (const name of names) {
    const src = join(run.dir, name)
    if (existsSync(src)) await copyFile(src, join(destDir, name))
  }
}

function countLabels(labels: FindingLabel[], kind: FindingLabel['label']): number {
  return labels.filter((l) => l.label === kind).length
}

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv, ['out'])
  const corpusRoot = resolveCorpusRoot(flags)
  const runs = await listSourceRuns(MAGPIE_ROOT)
  for (const runId of runs) {
    const outDir = join(corpusRoot, runId)
    const labels = await buildCorpusRun(join(MAGPIE_ROOT, runId), outDir)
    const run = await loadCorpusRun(outDir)
    process.stdout.write(
      `${runId}\tdeduped=${run.deduped?.length ?? '-'} kept=${run.kept?.length ?? '-'} ` +
        `final=${run.final.length} posted=${countLabels(labels, 'posted')} ` +
        `dismissed=${countLabels(labels, 'dismissed')} ignored=${countLabels(labels, 'ignored')}\n`,
    )
  }
  process.stdout.write(`${runs.length} run(s) in ${corpusRoot}\n`)
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`corpus: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    },
  )
}
