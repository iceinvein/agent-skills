import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Adapter, HandoffInput } from '../handoff.ts'
import { buildWorkItems } from '../handoff.ts'
import { readTextFile, writeAtomically } from '../store.ts'
import type {
  ApplyResult,
  Completion,
  Confidence,
  Requirement,
  Throughput,
  WorkItem,
} from '../types.ts'

// Everything in this file is written against the flow target's own parser:
// quartex/Nexus at c2464ac, plugins/stack/templates/tools/flow/src/
// capability.ts. That parser is an executable specification of what a
// capability file must look like, and each rule it enforces is cited at the
// line it comes from. scripts/__tests__/adapter-flow.test.ts asserts each rule
// independently, so if the target's grammar moves, the drift is visible here
// rather than surfacing as a parse error inside someone else's repo.
const CAP_DIR = join('docs', 'modernisation', 'capability-map')
const WORK = join('docs', 'WORK.md')
const FLOW_CLI = join('tools', 'flow', 'src', 'cli.ts')
const PROPOSED = /^## Proposed\s*$/m

// capability.ts:6. The store's three confidence kinds map onto the target's
// three vocabulary terms; `queued` becomes Speculative, which is what respec's
// own handoff does.
function confidenceFor(c: Confidence): string {
  if (c.kind === 'confirmed') return 'Confirmed'
  if (c.kind === 'inferred') return 'Inferred'
  return 'Speculative'
}

// capability.ts:9. The target admits intended, poss-accidental and cruft; the
// store says intended or accidental-candidate. Emitting the store's spelling
// would produce a file the target refuses to parse.
function originFor(origin: Requirement['origin']): string {
  return origin === 'accidental-candidate' ? 'poss-accidental' : 'intended'
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// capability.ts:42. The pattern is derived per capability from its declared
// `ns`, so it also rejects an id that belongs to a different namespace.
const frIdPattern = (ns: string): RegExp => new RegExp(`^${escapeRegex(ns)}-\\d{3}$`)

// capability.ts:48 splits sections on a line beginning '## ', and every cell
// sits on one table row, so a newline anywhere in a value would both break the
// row and risk opening a section. Collapsed rather than escaped, because the
// target's grammar has no way to represent a multi-line cell at all.
function cell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function renderCapability(item: WorkItem, ns: string, reqs: Requirement[]): string {
  const own = reqs.filter((r) => r.cap === item.key)
  const lines = [
    '---',
    `cap: ${item.key}`,
    `ns: ${ns}`,
    `title: ${item.title}`,
    // capability.ts:3. A capability handed over has not been started.
    'status: todo',
    '---',
    '',
    // capability.ts:44. All three sections are required and the target checks
    // for their presence, not their content.
    '## Functional requirements',
    '',
    '| id | requirement | actors | objects | rules | confidence | origin |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const r of own) {
    // capability.ts:74. Exactly seven cells, in this order.
    lines.push(
      `| ${r.id} | ${cell(r.requirement)} | ${cell(r.actors)} | ${cell(r.objects)} | ${cell(r.rules)} | ${confidenceFor(r.confidence)} | ${originFor(r.origin)} |`,
    )
  }
  lines.push(
    '',
    '## Built',
    '',
    '(none)',
    '',
    '## Remaining',
    '',
    'All functional requirements.',
    '',
  )
  return lines.join('\n')
}

function nsFor(input: HandoffInput, key: string): string {
  return input.capabilities.find((c) => c.slug === key)?.ns ?? ''
}

// Refuses in plan(), before anything is written. The store's requirement ids
// are free text; the target derives a pattern from each capability's declared
// namespace and rejects anything else. Catching it here is the adapter earning
// its keep: the alternative is a half-written capability-map directory and a
// parse error in a repo this tool does not own.
function assertIdGrammar(items: WorkItem[], input: HandoffInput): void {
  const bad: string[] = []
  for (const item of items) {
    const ns = nsFor(input, item.key)
    const pattern = frIdPattern(ns)
    for (const fr of item.frs) {
      if (!pattern.test(fr)) bad.push(`${fr} (capability ${item.key}, ns ${ns})`)
    }
  }
  if (bad.length > 0) {
    throw new Error(
      `flow: ${bad.length} requirement id(s) do not match their capability's namespace pattern <ns>-NNN, which the flow target requires:\n  ${bad.join('\n  ')}`,
    )
  }
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readTextFile(path)
  } catch {
    return null
  }
}

// The adapter's own lines are fenced by an HTML comment pair, and ONLY the
// region between them is ever rewritten.
//
// The previous version stripped every line under `## Proposed` matching
// `- [something]` before re-adding its own, on the assumption that such a line
// could only be adapter output. It cannot: `- [W07] Replace the auth provider`
// is exactly the notation the target's own WORK.md teaches, so a team keeping
// a shortlist there lost it on the first handoff. The fence makes ownership
// explicit rather than inferred from shape, which is the only way to edit a
// file somebody else writes in.
const FENCE_OPEN = '<!-- migrate:proposed -->'
const FENCE_CLOSE = '<!-- /migrate:proposed -->'

function updateWorkLedger(text: string, items: WorkItem[]): string {
  const block = [
    FENCE_OPEN,
    ...items.map((i) => `- [${i.key}] ${i.title} (${i.frs.length} FRs)`),
    FENCE_CLOSE,
  ].join('\n')

  const open = text.indexOf(FENCE_OPEN)
  const close = text.indexOf(FENCE_CLOSE)
  if (open !== -1 && close > open) {
    return text.slice(0, open) + block + text.slice(close + FENCE_CLOSE.length)
  }

  let out = text
  if (!PROPOSED.test(out)) {
    out = `${out.replace(/\n*$/, '')}\n\n## Proposed\n`
  }
  const at = PROPOSED.exec(out)
  if (!at) return out
  // Inserted directly under the heading, ahead of whatever the team already
  // keeps there. Nothing outside the fence is read, moved or removed, so a
  // heading of any level below this point is simply none of the adapter's
  // business: the earlier `\n## ` scan for a section end was both wrong (it
  // missed `#` and `###`) and unnecessary once ownership is explicit.
  const headEnd = at.index + at[0].length
  return `${out.slice(0, headEnd)}\n\n${block}\n${out.slice(headEnd)}`
}

type FlowCoverage = { cap: string; coveredIds: string[] }

async function runFlow(
  input: HandoffInput,
  args: string[],
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(['bun', join(input.root, FLOW_CLI), ...args], {
    cwd: input.root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? -1, out, err }
}

export const flow: Adapter = {
  name: 'flow',

  async plan(input: HandoffInput): Promise<WorkItem[]> {
    const items = buildWorkItems(input.capabilities, input.requirements)
    assertIdGrammar(items, input)
    return items
  },

  async apply(items: WorkItem[], input: HandoffInput): Promise<ApplyResult> {
    assertIdGrammar(items, input)
    const src = input.config.source.path
    await mkdir(join(input.root, CAP_DIR), { recursive: true })

    const created: string[] = []
    const updated: string[] = []
    const unchanged: string[] = []
    const refs: Record<string, string> = {}

    for (const item of items) {
      const rel = join(CAP_DIR, `${item.key}.md`)
      const path = join(input.root, rel)
      const next = renderCapability(item, nsFor(input, item.key), input.requirements)
      const before = await readIfPresent(path)
      if (before === null) created.push(item.key)
      else if (before !== next) updated.push(item.key)
      else unchanged.push(item.key)
      if (before !== next) await writeAtomically(path, next, src)
      refs[item.key] = rel
    }

    const workPath = join(input.root, WORK)
    const work = await readIfPresent(workPath)
    let workChanged = false
    if (work !== null) {
      const nextWork = updateWorkLedger(work, items)
      if (nextWork !== work) {
        await writeAtomically(workPath, nextWork, src)
        workChanged = true
      }
    }
    // A run that rewrote WORK.md has not left the target unchanged, whatever
    // the capability files did. Reporting every item `unchanged` while a file
    // was rewritten makes the idempotency claim untestable from the result.
    if (workChanged && created.length === 0) {
      for (const key of unchanged.splice(0, unchanged.length)) updated.push(key)
    }

    // The oracle. When the target carries its own flow CLI, the emission is
    // validated by the parser that will actually read it, and its failure is
    // reported verbatim rather than paraphrased. When it does not, that is
    // said plainly: an unvalidated emission must not read as a checked one.
    if (existsSync(join(input.root, FLOW_CLI))) {
      const map = await runFlow(input, ['map'])
      if (map.code !== 0) throw new Error(`flow map failed:\n${map.err || map.out}`)
      const check = await runFlow(input, ['map', '--check'])
      if (check.code !== 0) throw new Error(`flow map --check failed:\n${check.err || check.out}`)
    } else {
      process.stderr.write(
        `flow: no ${FLOW_CLI} in the target, so the emitted capability files were not validated against the target's own parser\n`,
      )
    }

    return { created, updated, unchanged, refs }
  },

  async throughput(input: HandoffInput): Promise<Throughput> {
    const basis =
      'flow parity --json in the target, coveredIds (undated: the flow slice ledger holds the dates)'
    if (!existsSync(join(input.root, FLOW_CLI))) {
      throw new Error(
        `flow: no ${FLOW_CLI} in the target, so coverage cannot be read back; run \`flow parity\` there instead`,
      )
    }
    const result = await runFlow(input, ['parity', '--json'])
    if (result.code !== 0)
      throw new Error(`flow parity --json failed:\n${result.err || result.out}`)
    const coverage = JSON.parse(result.out) as FlowCoverage[]
    const completions: Completion[] = []
    for (const entry of coverage) {
      // Every date this adapter could report would be invented: the target
      // computes covered from merged slices plus a baseline and keeps the
      // dates in a slice ledger. Undated is the honest answer, and forecast
      // says so rather than projecting from nothing.
      for (const fr of entry.coveredIds) completions.push({ fr, doneAt: null })
    }
    completions.sort((a, b) => a.fr.localeCompare(b.fr))
    return { completions, basis }
  },
}
