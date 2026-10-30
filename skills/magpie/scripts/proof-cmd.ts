import { appendFile, copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applyProofResults,
  buildProofPrompts,
  DEFAULT_PROOF_CAP,
  type ProofResult,
  parseProofResult,
  selectForProof,
} from './proof.ts'
import { reviewRoot } from './target.ts'
import { parseFinding, type ReviewFinding } from './types.ts'

const DEFAULT_TEMPLATE_PATH = new URL('../references/proof.md', import.meta.url).pathname

async function logLine(runDir: string, entry: Record<string, unknown>): Promise<void> {
  const line = `${JSON.stringify({ ...entry, ts: Date.now() })}\n`
  await appendFile(join(runDir, 'log.jsonl'), line)
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

/** The prompt is the body of the fenced block tagged `magpie-proof` (3 or 4 backticks). */
function extractTemplate(doc: string, path: string): string {
  const match = doc.match(/^(`{3,4})magpie-proof\n([\s\S]*?)\n\1[ \t]*$/m)
  if (!match?.[2]) throw new Error(`${path}: no magpie-proof fenced block`)
  return match[2]
}

async function readFindings(path: string): Promise<ReviewFinding[]> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`)
  return raw.map(parseFinding)
}

/**
 * proof-apply rewrites findings.final.json, so the findings as the peer review
 * left them are kept aside on the first proof-prompt. Selecting from that copy
 * makes a re-run of either command land on the same findings.
 */
async function readUnproven(runDir: string): Promise<ReviewFinding[]> {
  const unproven = join(runDir, 'findings.unproven.json')
  try {
    return await readFindings(unproven)
  } catch (err) {
    if (!isMissingFile(err)) throw err
  }
  await copyFile(join(runDir, 'findings.final.json'), unproven)
  return readFindings(unproven)
}

export type RunProofPromptOptions = {
  /** Markdown file holding the `magpie-proof` block. Defaults to `references/proof.md`. */
  templatePath?: string
}

export async function runProofPrompt(
  runDir: string,
  options: RunProofPromptOptions = {},
): Promise<number> {
  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE_PATH
  try {
    const template = extractTemplate(await readFile(templatePath, 'utf8'), templatePath)
    const prompts = buildProofPrompts({
      template,
      findings: selectForProof(await readUnproven(runDir), DEFAULT_PROOF_CAP),
      worktree: await reviewRoot(runDir),
      diffPath: join(runDir, 'diff.patch'),
      runDir,
    })
    const lines: string[] = []
    for (const p of prompts) {
      const promptPath = join(runDir, `proof-prompt-${p.id}.md`)
      await writeFile(promptPath, p.prompt)
      lines.push(`${promptPath}\t${p.outputPath}\n`)
    }
    process.stdout.write(lines.join(''))
    return 0
  } catch (err) {
    process.stderr.write(`proof-prompt: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

/** Null when the subagent wrote no file, so the caller can name every missing one. */
async function readResult(path: string, id: string): Promise<ProofResult | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if (isMissingFile(err)) return null
    throw err
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const result = parseProofResult(raw, path)
  if (result.id !== id) throw new Error(`${path}: id is ${result.id}, expected ${id}`)
  return result
}

// Provers name their file `magpie-proof-<id>`, or `MagpieProof<id>` where a name must be an identifier.
const REPRO_NAME = /magpie[-_]?proof/i

/** A prover that crashed or skipped its cleanup leaves its test in the tree, which in local mode is the author's. */
async function leftoverRepros(root: string, gitBin: string): Promise<string[]> {
  const proc = Bun.spawn([gitBin, 'ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exit, out, err] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (exit !== 0) throw new Error(`git ls-files in ${root} exit ${exit}: ${err.trim()}`)
  return out.split('\0').filter((path) => REPRO_NAME.test(path.split('/').at(-1) ?? ''))
}

/** Runner output carries the worktree's absolute path, which names the reviewer's home directory on GitHub. */
function relativise(result: ProofResult, root: string): ProofResult {
  if (result.outcome === 'not-proven') return result
  const strip = (text: string) => text.replaceAll(root, '.')
  const { path, command, source, output } = result.repro
  return {
    ...result,
    repro: { path, command: strip(command), source: strip(source), output: strip(output) },
  }
}

export async function runProofApply(
  runDir: string,
  opts: { gitBin?: string } = {},
): Promise<number> {
  try {
    const root = await reviewRoot(runDir)
    const unprovenPath = join(runDir, 'findings.unproven.json')
    let findings: ReviewFinding[]
    try {
      findings = await readFindings(unprovenPath)
    } catch (err) {
      if (isMissingFile(err)) throw new Error(`${unprovenPath} is missing; run proof-prompt first`)
      throw err
    }
    const missing: string[] = []
    const results: ProofResult[] = []
    for (const f of selectForProof(findings, DEFAULT_PROOF_CAP)) {
      const path = join(runDir, `proof-${f.id}.json`)
      const result = await readResult(path, f.id)
      if (result === null) missing.push(path)
      else results.push(relativise(result, root))
    }
    if (missing.length > 0) throw new Error(`no proof result: ${missing.join(', ')}`)
    const leftovers = await leftoverRepros(root, opts.gitBin ?? 'git')
    if (leftovers.length > 0) {
      throw new Error(`provers left files in ${root}; delete them: ${leftovers.join(', ')}`)
    }
    const applied = applyProofResults({ findings, results })
    await writeFile(
      join(runDir, 'findings.final.json'),
      `${JSON.stringify(applied.findings, null, 2)}\n`,
    )
    await writeFile(
      join(runDir, 'proof-dropped.json'),
      `${JSON.stringify(applied.dropped, null, 2)}\n`,
    )
    await logLine(runDir, {
      stage: 'proof',
      status: 'done',
      reproduced: results.filter((r) => r.outcome === 'reproduced').length,
      notProven: results.filter((r) => r.outcome === 'not-proven').length,
      disproved: applied.dropped.length,
    })
    return 0
  } catch (err) {
    process.stderr.write(`proof-apply: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
