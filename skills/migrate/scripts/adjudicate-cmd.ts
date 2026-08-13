import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.ts'
import { withStoreLock } from './lock.ts'
import { storePaths } from './paths.ts'
import { recordBatch } from './phases.ts'
import { loadQueue, parseQueueItem } from './queue.ts'
import { readTextFile, writeAtomically } from './store.ts'
import type { QueueItem, Severity } from './types.ts'

const SEVERITIES: Severity[] = ['critical', 'moderate', 'minor']

// The three keys this command owns. Everything else in a queue item's
// frontmatter belongs to whoever wrote the item and passes through untouched.
const OWNED = ['status', 'ruling', 'adjudicated'] as const

// The review sheet exists so an owner can adjudicate a whole queue in one
// sitting, which is what phase 6 asks for. Pulling each item's first
// recommendation line into the list is the part that makes one pass possible:
// without it the owner opens every file to find out what they are deciding.
// Only the first line, because a recommendation may run to paragraphs and this
// is an index, not the document.
export function renderReviewSheet(items: QueueItem[]): string {
  const sorted = [...items].sort((a, b) => {
    const bySeverity = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id)
  })
  const lines = sorted.map((item) => {
    const head = `${item.id} [${item.severity}] ${item.status}`
    const first = item.recommendation.split('\n')[0]?.trim() ?? ''
    return first ? `${head} - ${first}` : head
  })
  const open = items.filter((i) => i.status === 'open').length
  return [...lines, '', `${open} open`].join('\n')
}

// Rewrites only the three owned frontmatter keys, in place, and returns the
// whole file. Two properties are load-bearing and both are asserted by test:
//
// Keys this command does not own keep their original position, rather than the
// block being regenerated from a parsed map. A queue item's frontmatter is
// hand-authored and may carry whatever the run found useful; reordering it
// would show up as noise in every diff of an adjudicated item.
//
// The body is returned byte for byte. It is the audit record of why a ruling
// was made, and a rewrite that reflows it destroys the thing being audited.
// That is also why this works on lines rather than round-tripping through
// parseQueueItem: the parser is lossy by design.
export function applyRuling(text: string, ruling: string, date: string): string {
  if (ruling.trim().length === 0) {
    throw new Error('a ruling cannot be empty')
  }
  if (/[\n\r]/.test(ruling)) {
    // A line break would let the value inject further frontmatter keys, or a
    // closing fence, into the block it is written into. A value containing
    // ':' or '---' is harmless by comparison: neither can reach line start.
    throw new Error('a ruling cannot contain a newline')
  }

  // Normalised exactly as queue.ts normalises on read, and the fence located
  // by the same rule it uses (a line STARTING with ---, not a line equal to it
  // after trimming). The two disagreeing was not cosmetic: an indented `  ---`
  // inside the frontmatter was invisible to the parser and taken as the fence
  // here, so the owned keys were written above the real fence and the parser's
  // last-key-wins read still saw `status: open`. `migrate adjudicate` printed
  // "open -> adjudicated" and recorded a batch while the item stayed open
  // forever, unreachable even with --force because its status never changed.
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text
  const unix = normalized.replace(/\r\n/g, '\n')
  const lines = unix.split('\n')
  if (lines[0] !== '---') {
    throw new Error('missing --- frontmatter block')
  }
  const close = lines.findIndex((line, i) => i > 0 && line.startsWith('---'))
  if (close === -1) {
    throw new Error('unterminated --- frontmatter block')
  }

  const updates = new Map<string, string>([
    ['status', 'adjudicated'],
    ['ruling', ruling],
    ['adjudicated', date],
  ])
  const owned = new Set<string>(OWNED)
  const seen = new Set<string>()
  const rewritten: string[] = []
  for (const line of lines.slice(1, close)) {
    const sep = line.indexOf(':')
    // An indented key belongs to a nested map, not to this document's top
    // level. Trimming before comparing rewrote `  status: draft` under a
    // `meta:` key into a de-indented top-level `status: adjudicated`, leaving
    // two `status:` lines and a destroyed `meta` block.
    if (sep === -1 || line !== line.trimStart()) {
      rewritten.push(line)
      continue
    }
    const key = line.slice(0, sep).trim()
    seen.add(key)
    if (owned.has(key)) rewritten.push(`${key}: ${updates.get(key)}`)
    else rewritten.push(line)
  }
  for (const key of OWNED) {
    if (!seen.has(key)) rewritten.push(`${key}: ${updates.get(key)}`)
  }

  return ['---', ...rewritten, ...lines.slice(close)].join('\n')
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function runAdjudicate(opts: {
  root: string
  id?: string
  ruling?: string
  force?: boolean
  forceUnlock?: boolean
  now?: () => string
}): Promise<number> {
  const cfg = await loadConfig(opts.root)
  const paths = storePaths(opts.root)
  const { items, errors } = await loadQueue(paths.queueDir)

  if (!opts.id) {
    for (const e of errors) process.stderr.write(`adjudicate: ${e}\n`)
    process.stdout.write(`${renderReviewSheet(items)}\n`)
    return errors.length > 0 ? 1 : 0
  }

  if (opts.ruling === undefined) {
    process.stderr.write('adjudicate: want --ruling <text> when an id is given\n')
    return 2
  }

  const item = items.find((i) => i.id === opts.id)
  if (!item) {
    // Two different failures reach here and they are not the same class. A
    // file that exists but will not parse is a real item whose content is
    // broken: a content failure, and the parse errors are what the caller
    // needs. An id with no file at all was never an item, so the request
    // could not be serviced as posed: a usage error, the same code `queue
    // add` returns for a file it cannot read.
    const path = join(paths.queueDir, `${opts.id}.md`)
    if (existsSync(path)) {
      for (const e of errors) {
        if (e.includes(path)) process.stderr.write(`adjudicate: ${e}\n`)
      }
      return 1
    }
    process.stderr.write(`adjudicate: no queue item ${opts.id}\n`)
    return 2
  }

  if (item.status === 'adjudicated' && !opts.force) {
    // The existing ruling is printed rather than merely referred to, so the
    // caller can see what a --force would have replaced. An owner's recorded
    // decision is not something a re-run should quietly overwrite, which is
    // the one place this deliberately diverges from respec's applyRuling.
    process.stderr.write(
      `adjudicate: ${item.id} is already adjudicated: ${item.ruling ?? '<no ruling recorded>'}\n` +
        'adjudicate: pass --force to replace it\n',
    )
    return 1
  }

  let text: string
  try {
    text = await readTextFile(item.path)
  } catch (e) {
    // The item was in the index a moment ago; its file vanishing between load
    // and write is a domain failure on an otherwise well-formed request.
    process.stderr.write(`adjudicate: ${(e as Error).message}\n`)
    return 1
  }

  let next: string
  try {
    next = applyRuling(text, opts.ruling, (opts.now ?? today)())
    // Checked against the parser every other command reads this file with,
    // rather than trusted. A write that reports success while leaving the item
    // open or unparseable is worse than a refusal, because the queue gate then
    // blocks handoff over a decision the owner believes they recorded.
    const reparsed = parseQueueItem(next, item.path)
    if (!reparsed.ok) {
      throw new Error(
        `the rewritten file would not parse (${reparsed.errors.join('; ')}); the item's frontmatter is shaped in a way this command cannot safely edit`,
      )
    }
    if (reparsed.value.status !== 'adjudicated' || reparsed.value.ruling !== opts.ruling) {
      throw new Error(
        "the rewritten file does not read back as adjudicated; the item's frontmatter is shaped in a way this command cannot safely edit",
      )
    }
  } catch (e) {
    // Every applyRuling throw is about the ruling text or the file's own
    // frontmatter fence, both of which mean the request was malformed.
    process.stderr.write(`adjudicate: ${(e as Error).message}\n`)
    return 2
  }

  const before = item.status
  await withStoreLock(
    opts.root,
    async () => {
      await writeAtomically(item.path, next, cfg.source.path)
      // The batch is what lets the run-state gate see that phase 6 ran at all,
      // the same role census records play for enumerate and extract. Keyed by
      // item id so re-ruling one item does not add a second entry.
      await recordBatch(
        opts.root,
        'adjudicate',
        { id: `b-adjudicate-${item.id}`, count: 1 },
        cfg.source.path,
      )
    },
    { cmd: 'adjudicate', ...(opts.forceUnlock ? { force: true } : {}) },
  )

  process.stdout.write(
    `adjudicate: ${item.id}\n` +
      `  status  ${before} -> adjudicated\n` +
      `  ruling  recorded\n` +
      // This command deliberately writes no row file, so the consequence of
      // the ruling (an element's disposition, a requirement's confidence) is
      // still outstanding and goes through the writer that already validates
      // it. Printing the command is how the phase manual's instruction
      // reaches the operator at the moment it applies.
      'next: apply the consequence with `migrate import`\n',
  )
  return 0
}
