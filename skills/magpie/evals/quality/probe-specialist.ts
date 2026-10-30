#!/usr/bin/env bun
// Runs one specialist on one shard of a corpus run, with or without the impact
// map in its prompt, and judges its findings against chosen misses. A narrower
// and cheaper question than a full replay: does this focus, on this shard, find
// these defects. Spends real money unless --dry-run: one `claude -p` per repeat,
// capped by --max-cost-usd, plus one judge call.

import { constants, existsSync } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ShardEntry } from '../../scripts/shard.ts'
import { type PrBrief, parseBrief, parseFinding, type ReviewFinding } from '../../scripts/types.ts'
import {
  copyCorpusFiles,
  type CorpusRun,
  headRefOid,
  loadCorpusRun,
  resolveCorpusRoot,
} from './corpus.ts'
import {
  DEFAULT_JUDGE_MODEL,
  judgeRecall,
  loadMisses,
  type Miss,
  type RecallVerdict,
} from './recall.ts'
import { worktreeRemoveCommand } from './replay-critic.ts'
import { exec } from './replay-full.ts'
import { parseFlags, positiveNumberFlag, resultTimestamp } from './score.ts'

const SKILL_DIR = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const MAGPIE_BIN = join(SKILL_DIR, 'bin', 'magpie.ts')
const SPECIALISTS_MD = join(SKILL_DIR, 'references', 'specialists.md')
const DEFAULT_MAX_COST_USD = 3
const ARMS = ['base', 'impact'] as const
type Arm = (typeof ARMS)[number]

// Parts 2, 4 and the close of part 5 are fenced blocks the orchestrator copies
// by position, with no tag to find them by, so they are held here; a test checks
// each is still in references/specialists.md word for word.
export const RUN_HEADER_UNSHARDED = `You are reviewing <TARGET>.
Working directory: <WORKTREE>
Diff: <RUN_DIR>/diff.patch`

export const RUN_HEADER_SHARDED = `You are reviewing <TARGET>.
Working directory: <WORKTREE>
Shard: <n> of <N>
Diff: <RUN_DIR>/shards/shard-<n>.patch

This shard is your review scope. The other shards belong to other agents working
in parallel: do not review files outside your shard, and do not report findings
anchored to them. Reading any file in the worktree for context is expected and
encouraged.`

export const EXCLUDED_FILES_BLOCK = `Files excluded by the path filter are absent from your diff but present in the
worktree, with their full patches in <RUN_DIR>/diff.full.patch and the exclusion
list in <RUN_DIR>/excluded-files.json. When a change in your scope implies a change
in an excluded file (a migration implies a model snapshot, a schema change implies
generated types), open it and cross-check rather than treating it as out of scope.`

export const BRIEF_CLOSING = `This brief is the author's claim as understood by a reader who has not reviewed the
code. It is not ground truth. Where the diff contradicts it, that is a finding in
your domain, not a correction to the brief. A watch item is a pointer, not a verdict:
escalate it into a finding with your own risk fields, or leave it alone. A repository
review rule is a convention the maintainers wrote down: a change that breaks one is a
finding in your domain when the rule bears on it, citing the rule's source.`

function taggedBlock(md: string, tag: string): string {
  const open = `\`\`\`${tag}\n`
  const start = md.indexOf(open)
  if (start === -1) throw new Error(`specialists.md has no ${tag} block`)
  const end = md.indexOf('\n```', start + open.length)
  if (end === -1) throw new Error(`specialists.md ${tag} block is not closed`)
  return md.slice(start + open.length, end)
}

// The section runs to the next `## ` heading outside a fence; its own fenced
// schema must not end it.
function outputContract(md: string): string {
  const lines = md.split('\n')
  const start = lines.indexOf('## Output Contract')
  if (start === -1) throw new Error('specialists.md has no ## Output Contract section')
  let inFence = false
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string
    if (line.startsWith('```')) inFence = !inFence
    else if (!inFence && line.startsWith('## ')) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n').trimEnd()
}

function fillRunPlaceholders(
  text: string,
  values: { runDir: string; worktree: string; target: string; focus: string },
): string {
  return text
    .replaceAll('<RUN_DIR>', values.runDir)
    .replaceAll('<WORKTREE>', values.worktree)
    .replaceAll('<TARGET>', values.target)
    .replaceAll('<focus>', values.focus)
}

/** The specialist prompt as references/specialists.md tells the orchestrator to build it. */
export function assembleSpecialistPrompt(input: {
  specialistsMd: string
  focus: string
  runDir: string
  worktree: string
  target: string
  shard: { n: number; total: number } | null
  brief: string | null
  excludedFiles: boolean
  impact: { path: string; inline: string } | null
}): string {
  const focusBlock = taggedBlock(input.specialistsMd, `magpie-specialist-${input.focus}`)
  const impactPart =
    input.impact === null
      ? null
      : // Replacer functions, because the entries are source code and `$&` or `$'`
        // in a string replacement would splice in other text.
        taggedBlock(input.specialistsMd, 'magpie-impact-part')
          .replace('<top entries>', () => input.impact?.inline ?? '')
          .replace('<the path above>', () => input.impact?.path ?? '')

  const headerTemplate =
    input.shard === null
      ? RUN_HEADER_UNSHARDED
      : RUN_HEADER_SHARDED.replaceAll('<n>', String(input.shard.n)).replace(
          '<N>',
          String(input.shard.total),
        )
  let header = fillRunPlaceholders(headerTemplate, input)
  const impactPath = input.impact?.path
  if (input.impact !== null) {
    header = header.replace(
      /^Diff: .*$/m,
      (diffLine) => `${diffLine}\nOutside the diff: ${impactPath}`,
    )
  }

  const parts = [
    focusBlock,
    header,
    fillRunPlaceholders(outputContract(input.specialistsMd), input),
  ]
  if (input.excludedFiles) parts.push(fillRunPlaceholders(EXCLUDED_FILES_BLOCK, input))
  if (input.brief !== null) parts.push(input.brief)
  if (impactPart !== null) parts.push(impactPart)
  return parts.join('\n\n')
}

function bulletSection(heading: string, items: string[]): string {
  return [heading, ...items.map((item) => `- ${item}`)].join('\n')
}

/** Part 5 of the specialist prompt, rendered from brief.json. */
export function renderBriefPart(brief: PrBrief): string {
  const sections = [
    `## What this PR is for\n\n${brief.purpose}`,
    bulletSection('What it does:', brief.changes),
  ]
  if (brief.watchItems.length > 0) sections.push(bulletSection('Watch items:', brief.watchItems))
  if (brief.unclear.length > 0) {
    sections.push(bulletSection('Open questions the scout could not resolve:', brief.unclear))
  }
  if (brief.reviewRules.length > 0) {
    sections.push(
      bulletSection(
        'Repository review rules:',
        brief.reviewRules.map((r) => `${r.rule} (${r.source})`),
      ),
    )
  }
  sections.push(BRIEF_CLOSING)
  return sections.join('\n\n')
}

// A killed session leaves its last line cut off. The lines before it still say
// what the session did, so a line that does not parse is counted, not fatal.
function streamEvents(streamJson: string): {
  events: Array<Record<string, unknown>>
  badLines: number
} {
  const events: Array<Record<string, unknown>> = []
  let badLines = 0
  for (const line of streamJson.split('\n')) {
    if (line.trim() === '') continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      badLines++
      continue
    }
    if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
      events.push(event as Record<string, unknown>)
    }
  }
  return { events, badLines }
}

/** Transcript lines that are not JSON, most often one cut off when the session was killed. */
export function transcriptBadLines(streamJson: string): number {
  return streamEvents(streamJson).badLines
}

/** Whether the session opened `path` with the Read tool. A Bash `cat` is not counted. */
export function transcriptReadPath(streamJson: string, path: string): boolean {
  return streamEvents(streamJson).events.some((event) => {
    if (event.type !== 'assistant') return false
    const message = event.message as { content?: unknown } | undefined
    if (!Array.isArray(message?.content)) return false
    return message.content.some((block: unknown) => {
      const b = block as { type?: unknown; name?: unknown; input?: { file_path?: unknown } }
      return b.type === 'tool_use' && b.name === 'Read' && b.input?.file_path === path
    })
  })
}

/** What a finished session cost and, if it failed, why. Never throws: the
 *  session is paid for whatever happened, so its result file must still be written. */
export function sessionOutcome(
  streamJson: string,
  exit: number,
  stderr: string,
): { costUsd: number | null; error: string | null } {
  const errors: string[] = []
  let costUsd: number | null = null
  const result = streamEvents(streamJson).events.find((event) => event.type === 'result')
  if (result === undefined) {
    errors.push('stream-json has no result event')
  } else {
    if (typeof result.total_cost_usd === 'number') costUsd = result.total_cost_usd
    if (result.is_error === true) {
      errors.push(`session ended in error (${String(result.subtype)}): ${String(result.result)}`)
    }
  }
  if (exit !== 0) errors.push(`exit ${exit}: ${stderr.trim()}`)
  return { costUsd, error: errors.length === 0 ? null : errors.join('; ') }
}

const CITATION = /([^\s`'"()[\],:]+):(\d+)/g

function citations(text: string): string[] {
  return [...text.matchAll(CITATION)].map((m) => `${m[1]}:${m[2]}`)
}

/** Findings that cite, anywhere in their description, a file:line the impact map lists
 *  in a file outside the shard: the locations the map exists to point at. */
export function countOutsideCitations(
  findings: ReviewFinding[],
  impactMarkdown: string,
  shardFiles: string[],
): number {
  const inShard = new Set(shardFiles)
  const outside = new Set(
    citations(impactMarkdown).filter((c) => !inShard.has(c.slice(0, c.lastIndexOf(':')))),
  )
  return findings.filter((f) => citations(f.description).some((c) => outside.has(c))).length
}

/** A probe judges findings straight from the specialist, before dedupe has
 *  given every one an id, so a missing id is filled from its position. */
export function numberProbeFindings(
  raw: unknown,
  focus: string,
  shard: number,
  path: string,
): ReviewFinding[] {
  if (!Array.isArray(raw)) throw new Error(`${path} is not a JSON array`)
  return raw.map((entry, i) => {
    const withId =
      entry !== null && typeof entry === 'object' && !('id' in entry)
        ? { ...entry, id: `${focus}-s${shard}-${i + 1}` }
        : entry
    try {
      return parseFinding(withId)
    } catch (err) {
      throw new Error(`${path}[${i}]: ${err instanceof Error ? err.message : err}`)
    }
  })
}

/** A failure after the session was paid for, with its result file already written.
 *  It belongs to one repeat; any other failure is systematic and stops them all. */
export class PostSessionError extends Error {}

/** Runs repeats in order, returning how many failed after their session. */
export async function runRepeats(
  count: number,
  runOne: (repeat: number) => Promise<void>,
  warn: (line: string) => void,
): Promise<number> {
  let failed = 0
  for (let repeat = 1; repeat <= count; repeat++) {
    try {
      await runOne(repeat)
    } catch (err) {
      if (!(err instanceof PostSessionError)) throw err
      warn(`repeat ${repeat} failed after its session: ${err.message}\n`)
      failed++
    }
  }
  return failed
}

type ProbeOptions = {
  run: CorpusRun
  repo: string
  sha: string
  target: string
  focus: string
  file: string
  misses: Miss[]
  arm: Arm
  repeat: number
  maxCostUsd: number
  judgeModel: string
  corpusRoot: string
  dryRun: boolean
}

async function readShards(runDir: string): Promise<ShardEntry[]> {
  const manifest = (await Bun.file(join(runDir, 'shards', 'manifest.json')).json()) as {
    shards?: unknown
  }
  if (!Array.isArray(manifest.shards)) throw new Error('shard manifest has no shards array')
  return manifest.shards as ShardEntry[]
}

async function readOptionalText(path: string): Promise<string | null> {
  return existsSync(path) ? readFile(path, 'utf8') : null
}

async function readBriefPart(runDir: string): Promise<string | null> {
  const path = join(runDir, 'brief.json')
  if (!existsSync(path)) return null
  const brief = parseBrief(JSON.parse(await readFile(path, 'utf8')))
  if (brief === null) throw new Error(`${path} has no purpose, so it cannot be rendered as part 5`)
  return renderBriefPart(brief)
}

// The shard's own impact file when sharded, the run's when not: never the whole
// run's map for one shard.
function impactPrefix(scratch: string, shard: { n: number; total: number } | null): string {
  return join(scratch, shard === null ? 'impact' : `impact.shard-${shard.n}`)
}

/** The impact arm's part 6. A shard with no impact file has nothing to measure,
 *  so it is refused before any money is spent on it. */
export async function readImpactPart(
  runDir: string,
  shard: { n: number; total: number } | null,
): Promise<{ path: string; inline: string }> {
  const prefix = impactPrefix(runDir, shard)
  const path = `${prefix}.md`
  if (!existsSync(path)) {
    const scope = shard === null ? 'the run' : `shard ${shard.n}`
    throw new Error(
      `magpie impact wrote no ${path} for ${scope}; the impact arm would measure nothing`,
    )
  }
  const inline = await readOptionalText(`${prefix}.brief.md`)
  if (inline === null) throw new Error(`${path} exists without ${prefix}.brief.md`)
  return { path, inline: inline.trimEnd() }
}

async function runImpactStage(scratch: string): Promise<void> {
  await exec(['bun', MAGPIE_BIN, 'impact', scratch])
  // `magpie impact` exits 0 when it skips; an impact arm with no map is a base arm.
  const lines = (await readFile(join(scratch, 'log.jsonl'), 'utf8')).trim().split('\n')
  const last = JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>
  if (last.stage !== 'impact' || last.status !== 'done') {
    throw new Error(`magpie impact did not finish: ${JSON.stringify(last)}`)
  }
}

// Not `exec`: a failed session still has a transcript and a cost to record.
async function runSession(
  prompt: string,
  worktree: string,
  scratch: string,
  maxCostUsd: number,
): Promise<{ stdout: string; stderr: string; exit: number }> {
  const proc = Bun.spawn(
    [
      'claude',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--allowedTools',
      'Bash,Read,Grep,Glob,Write',
      '--max-budget-usd',
      String(maxCostUsd),
      '--add-dir',
      scratch,
    ],
    { cwd: worktree, stdin: new Blob([prompt]), stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exit }
}

async function probeOnce(opts: ProbeOptions): Promise<void> {
  const { run, focus } = opts
  // Resolved so the path in the prompt is the one the session's Read calls carry.
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'magpie-probe-')))
  const worktree = join(scratch, 'worktree')
  let worktreeCreated = false
  try {
    await exec(['git', '-C', opts.repo, 'worktree', 'add', '--detach', worktree, opts.sha])
    worktreeCreated = true
    await copyCorpusFiles(run, scratch, ['pr.json', 'diff.patch', 'brief.json'])
    if (!existsSync(join(scratch, 'diff.patch'))) throw new Error(`${run.dir} has no diff.patch`)
    // Not corpus files today, but a run that has them gets part 4 as setup would.
    const excludedFiles = existsSync(join(run.dir, 'excluded-files.json'))
    for (const name of ['excluded-files.json', 'diff.full.patch']) {
      if (existsSync(join(run.dir, name))) await copyFile(join(run.dir, name), join(scratch, name))
    }
    await mkdir(join(scratch, 'findings'))
    await writeFile(
      join(scratch, 'log.jsonl'),
      `${JSON.stringify({ stage: 'setup', status: 'done', worktree, ts: Date.now() })}\n`,
    )
    await exec(['bun', MAGPIE_BIN, 'shard', scratch])

    const shards = await readShards(scratch)
    const chosen = shards.find((s) => s.files.includes(opts.file))
    if (chosen === undefined) throw new Error(`no shard of ${run.runId} contains ${opts.file}`)
    const shard = shards.length > 1 ? { n: chosen.id, total: shards.length } : null

    if (opts.arm === 'impact') await runImpactStage(scratch)
    const impact = opts.arm === 'impact' ? await readImpactPart(scratch, shard) : null
    const prompt = assembleSpecialistPrompt({
      specialistsMd: await readFile(SPECIALISTS_MD, 'utf8'),
      focus,
      runDir: scratch,
      worktree,
      target: opts.target,
      shard,
      brief: await readBriefPart(scratch),
      excludedFiles,
      impact,
    })

    if (opts.dryRun) {
      process.stdout.write(
        `repeat ${opts.repeat}: shard ${chosen.id} of ${shards.length} (${chosen.files.length} files), ` +
          `impact ${impact === null ? 'none' : impact.path}, prompt ${prompt.length} chars\n` +
          `${prompt}\n`,
      )
      return
    }

    // Checked before the session so a corpus root that cannot take the result fails
    // before anything is spent.
    const resultsDir = join(opts.corpusRoot, 'results')
    await mkdir(resultsDir, { recursive: true })
    await access(resultsDir, constants.W_OK)
    const outPath = join(
      resultsDir,
      `${resultTimestamp(new Date())}-probe-${run.runId}-${focus}-s${chosen.id}-${opts.arm}-r${opts.repeat}.json`,
    )

    const session = await runSession(prompt, worktree, scratch, opts.maxCostUsd)
    const outcome = sessionOutcome(session.stdout, session.exit, session.stderr)
    const findingsName = shard === null ? `${focus}.json` : `${focus}.shard-${shard.n}.json`
    const findingsPath = join(scratch, 'findings', findingsName)
    // Null fields are steps not yet reached; a probe that stops early leaves them null
    // and says why in `error`.
    const result = {
      tier: 'probe',
      runId: run.runId,
      focus,
      shard: chosen.id,
      arm: opts.arm,
      repeat: opts.repeat,
      missIds: opts.misses.map((m) => m.id),
      caught: [] as string[],
      verdicts: [] as RecallVerdict[],
      judged: false,
      notJudged: null as string | null,
      findings: null as number | null,
      missingFindings: null as string | null,
      /** Kept only when the session wrote no findings file, the case no one could explain. */
      transcript: null as string | null,
      readImpact: null as boolean | null,
      citesOutside: null as number | null,
      costUsd: outcome.costUsd,
      judgeCostUsd: null as number | null,
      sessionError: outcome.error,
      transcriptBadLines: transcriptBadLines(session.stdout),
      error: null as string | null,
    }
    const save = () => writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`)
    // Saved before anything else can throw, so a paid session's cost is never lost.
    await save()

    try {
      const findings = existsSync(findingsPath)
        ? numberProbeFindings(
            JSON.parse(await readFile(findingsPath, 'utf8')),
            focus,
            chosen.id,
            findingsPath,
          )
        : []
      result.findings = findings.length
      result.missingFindings = existsSync(findingsPath) ? null : `session wrote no ${findingsName}`
      if (result.missingFindings !== null) {
        const transcript = outPath.replace(/\.json$/, '.transcript.jsonl')
        await writeFile(transcript, session.stdout)
        result.transcript = transcript
      }
      result.readImpact = impact === null ? null : transcriptReadPath(session.stdout, impact.path)
      await save()

      // A base-arm session has ended before this map exists, so it cannot have read
      // it; computing it here lets both arms count outside citations the same way.
      if (opts.arm === 'base') await runImpactStage(scratch)
      const impactMarkdown = (await readOptionalText(`${impactPrefix(scratch, shard)}.md`)) ?? ''
      result.citesOutside = countOutsideCitations(findings, impactMarkdown, chosen.files)
      await save()

      // With no findings every verdict is null, so the judge is not paid to say so.
      if (findings.length === 0) {
        result.notJudged = result.missingFindings ?? 'no findings to judge'
      } else {
        const judged = await judgeRecall({
          misses: opts.misses,
          findings,
          model: opts.judgeModel,
          cwd: scratch,
        })
        result.verdicts = judged.verdicts
        result.caught = judged.verdicts.filter((v) => v.findingId !== null).map((v) => v.missId)
        result.judgeCostUsd = judged.costUsd
        result.judged = true
      }
      await save()
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err)
      await save()
      throw new PostSessionError(`${result.error} (probe result written to ${outPath})`)
    }

    if (outcome.error !== null) process.exitCode = 1
    process.stdout.write(
      `${run.runId} ${focus} s${chosen.id} ${opts.arm} r${opts.repeat}: ` +
        `caught ${result.caught.length}/${opts.misses.length}${result.judged ? '' : ' (not judged)'}, ` +
        `findings ${result.findings}, ` +
        `read impact ${result.readImpact === null ? '-' : result.readImpact}, ` +
        `cites outside ${result.citesOutside}, ` +
        `cost ${outcome.costUsd === null ? 'unreported' : `$${outcome.costUsd.toFixed(2)}`}` +
        `${outcome.error === null ? '' : `, session error: ${outcome.error}`}\nwrote ${outPath}\n`,
    )
  } finally {
    // A failed removal must not mask the error that got us here, but it must be seen.
    const removeCommand = worktreeRemoveCommand(opts.repo, worktree, worktreeCreated)
    if (removeCommand) {
      await exec(removeCommand).catch((err) => {
        process.stderr.write(`probe-specialist: worktree removal failed: ${err.message}\n`)
        process.exitCode = 1
      })
    }
    await rm(scratch, { recursive: true, force: true })
  }
}

const USAGE =
  'usage: probe-specialist.ts --corpus <runId> --repo <path> --focus <focus> --file <diff path> ' +
  '--misses <id,id> --arm base|impact --repeats <n> [--max-cost-usd N] [--judge-model M] ' +
  '[--out <corpus-dir>] [--dry-run]'

async function main(argv: string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const flags = parseFlags(
    argv.filter((a) => a !== '--dry-run'),
    [
      'corpus',
      'repo',
      'focus',
      'file',
      'misses',
      'arm',
      'repeats',
      'max-cost-usd',
      'judge-model',
      'out',
    ],
  )
  const { corpus, repo, focus, file, arm, repeats } = flags
  if (!corpus || !repo || !focus || !file || !flags.misses || !arm || !repeats)
    throw new Error(USAGE)
  if (!ARMS.includes(arm as Arm)) throw new Error(`--arm ${arm}: want base or impact`)
  if (!/^[1-9]\d*$/.test(repeats)) throw new Error(`--repeats ${repeats}: want an integer >= 1`)
  const maxCostUsd = positiveNumberFlag(flags, 'max-cost-usd') ?? DEFAULT_MAX_COST_USD
  const judgeModel = flags['judge-model'] ?? DEFAULT_JUDGE_MODEL

  const corpusRoot = resolveCorpusRoot(flags)
  const run = await loadCorpusRun(join(corpusRoot, corpus))
  const sha = headRefOid(run)
  const prNumber = run.pr?.number
  if (typeof prNumber !== 'number') throw new Error(`${join(run.dir, 'pr.json')} has no number`)
  const missesPath = join(corpusRoot, 'misses', `${run.runId}.json`)
  const allMisses = await loadMisses(missesPath)
  if (allMisses === null) throw new Error(`${missesPath} does not exist`)
  const misses = flags.misses.split(',').map((id) => {
    const miss = allMisses.find((m) => m.id === id)
    if (miss === undefined) throw new Error(`${missesPath} has no miss ${id}`)
    return miss
  })
  await exec(['git', '-C', repo, 'cat-file', '-e', `${sha}^{commit}`]).catch((err) => {
    throw new Error(
      `commit ${sha} is not in ${repo}; fetch the PR head there first (${err.message})`,
    )
  })

  const failed = await runRepeats(
    Number(repeats),
    (repeat) =>
      probeOnce({
        run,
        repo,
        sha,
        target: `PR #${prNumber}`,
        focus,
        file,
        misses,
        arm: arm as Arm,
        repeat,
        maxCostUsd,
        judgeModel,
        corpusRoot,
        dryRun,
      }),
    (line) => process.stderr.write(line),
  )
  if (failed > 0) process.exitCode = 1
  return 0
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(process.exitCode || code),
    (err) => {
      process.stderr.write(
        `probe-specialist: ${err instanceof Error ? err.message : String(err)}\n`,
      )
      process.exit(1)
    },
  )
}
