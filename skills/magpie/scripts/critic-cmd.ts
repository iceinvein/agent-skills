import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applyCriticVerdicts,
  buildCriticPrompts,
  type CriticVerdict,
  DEFAULT_BATCH_SIZE,
  DEFAULT_DESIGN_CAP,
  parseCriticVerdicts,
} from './critic.ts'
import { parseBrief, parseFinding, type ReviewFinding, type ReviewRule } from './types.ts'

const DEFAULT_TEMPLATE_PATH = new URL('../references/critic.md', import.meta.url).pathname

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify({ ...entry, ts: Date.now() })}\n`
  await appendFile(join(runDir, 'log.jsonl'), line)
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** The prompt is the body of the fenced block tagged `magpie-critic` (3 or 4 backticks). */
function extractTemplate(doc: string, path: string): string {
  const match = doc.match(/^(`{3,4})magpie-critic\n([\s\S]*?)\n\1[ \t]*$/m)
  if (!match?.[2]) throw new Error(`${path}: no magpie-critic fenced block`)
  return match[2]
}

async function readCandidates(runDir: string): Promise<ReviewFinding[]> {
  const path = join(runDir, 'findings.deduped.json')
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`)
  return raw.map(parseFinding)
}

/** Runs from before merge candidates existed have no file; that means no groups. */
async function readMergeCandidates(runDir: string): Promise<string[][]> {
  const path = join(runDir, 'merge-candidates.json')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return []
    throw err
  }
  const raw: unknown = JSON.parse(text)
  if (
    !Array.isArray(raw) ||
    !raw.every((g) => Array.isArray(g) && g.every((id) => typeof id === 'string'))
  ) {
    throw new Error(`${path}: expected an array of id arrays`)
  }
  return raw as string[][]
}

/** The scout stage is optional, so a run without a brief has no repo rules. */
async function readReviewRules(runDir: string): Promise<ReviewRule[]> {
  let text: string
  try {
    text = await readFile(join(runDir, 'brief.json'), 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return []
    throw err
  }
  return parseBrief(JSON.parse(text))?.reviewRules ?? []
}

export type RunCriticPromptOptions = {
  batchSize?: number
  /** Markdown file holding the `magpie-critic` block. Defaults to `references/critic.md`. */
  templatePath?: string
}

export async function runCriticPrompt(
  runDir: string,
  options: RunCriticPromptOptions = {},
): Promise<number> {
  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE_PATH
  try {
    const template = extractTemplate(await readFile(templatePath, 'utf8'), templatePath)
    const prompts = buildCriticPrompts({
      template,
      candidates: await readCandidates(runDir),
      mergeCandidates: await readMergeCandidates(runDir),
      reviewRules: await readReviewRules(runDir),
      worktree: join(runDir, 'worktree'),
      diffPath: join(runDir, 'diff.patch'),
      runDir,
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    })
    const lines: string[] = []
    for (const p of prompts) {
      const promptPath = join(
        runDir,
        prompts.length === 1 ? 'critic-prompt.md' : `critic-prompt-${p.batch}.md`,
      )
      await writeFile(promptPath, p.prompt)
      lines.push(`${promptPath}\t${p.outputPath}\n`)
    }
    process.stdout.write(lines.join(''))
    return 0
  } catch (err) {
    process.stderr.write(`critic-prompt: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

const NUMBERED_CRITIC_FILE = /^critic-(\d+)\.json$/

/** Null when no critic output file exists at all. */
async function readVerdicts(runDir: string): Promise<CriticVerdict[] | null> {
  const entries = await readdir(runDir)
  const numbered = entries
    .flatMap((name) => {
      const m = name.match(NUMBERED_CRITIC_FILE)
      return m ? [{ name, k: Number(m[1]) }] : []
    })
    .sort((a, b) => a.k - b.k)
    .map((e) => e.name)
  const hasSingle = entries.includes('critic.json')
  if (hasSingle && numbered.length > 0) {
    throw new Error(
      `both critic.json and ${numbered.join(', ')} exist in ${runDir}; remove the stale ones`,
    )
  }
  const files = hasSingle ? ['critic.json'] : numbered
  if (files.length === 0) return null
  const verdicts: CriticVerdict[] = []
  for (const name of files) {
    const path = join(runDir, name)
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path, 'utf8'))
    } catch (err) {
      // A subagent that wraps its array in a fence or prose fails here; the path
      // tells the agent which batch to re-dispatch.
      throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
    verdicts.push(...parseCriticVerdicts(raw, path))
  }
  return verdicts
}

export type RunCriticApplyOptions = {
  designCap?: number
}

export async function runCriticApply(
  runDir: string,
  options: RunCriticApplyOptions = {},
): Promise<number> {
  try {
    const candidates = await readCandidates(runDir)
    const verdicts = await readVerdicts(runDir)
    if (candidates.length > 0 && verdicts === null) {
      throw new Error(`no critic verdicts: ${join(runDir, 'critic.json')} does not exist`)
    }
    const result = applyCriticVerdicts({
      candidates,
      verdicts: verdicts ?? [],
      designCap: options.designCap ?? DEFAULT_DESIGN_CAP,
    })
    await writeFile(join(runDir, 'findings.kept.json'), `${JSON.stringify(result.kept, null, 2)}\n`)
    await writeFile(
      join(runDir, 'critic-dropped.json'),
      `${JSON.stringify(result.dropped, null, 2)}\n`,
    )
    await logLine(runDir, {
      stage: 'critic',
      status: 'done',
      kept: result.kept.length,
      dropped: result.dropped.length,
      merged: result.merged,
      capped: result.capped,
    })
    return 0
  } catch (err) {
    process.stderr.write(`critic-apply: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
