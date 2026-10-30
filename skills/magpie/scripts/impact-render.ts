import { COMMON_NAME_HITS, type ImpactLocation, type ImpactMap, type ImpactRef } from './impact.ts'
import type { ReviewFinding } from './types.ts'

export const IMPACT_FULL_CAP_BYTES = 8192
export const IMPACT_BRIEF_CAP_BYTES = 2048
export const IMPACT_BRIEF_MAX_CHILDREN = 3

const SECTIONS = [
  'Other writers of the same data',
  'References to changed symbols',
  'References to added symbols',
  'Definitions this change relies on',
  'Sibling routes',
  'Docs naming what changed',
] as const

type Entry = {
  section: number
  anchor: ImpactLocation
  shards: number[]
  files: string[]
  head: string
  children: ImpactRef[]
  // Symbols report their hit count; every other kind reports its child count.
  total: number
}

function codeSpan(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``
}

function head(name: string, at: ImpactLocation): string {
  return `- \`${name}\` (diff: ${at.file}:${at.line})`
}

function firstLocation(list: ImpactLocation[], what: string): ImpactLocation {
  const at = list[0]
  if (!at) throw new Error(`Impact ${what} has no diff location`)
  return at
}

function shardList(shard: number | null): number[] {
  return shard === null ? [] : [shard]
}

// Entries with no facts outside the diff are left out: they tell a reviewer nothing.
function entriesOf(map: ImpactMap): Entry[] {
  const entries: Entry[] = []
  for (const s of map.stores) {
    if (s.writers.length === 0) continue
    const anchor = firstLocation(s.usedIn, `store ${s.name}`)
    entries.push({
      section: 0,
      anchor,
      shards: shardList(s.shard),
      files: [...s.usedIn.map((u) => u.file), ...s.writers.map((w) => w.file)],
      head: head(s.name, anchor),
      children: s.writers,
      total: s.writers.length,
    })
  }
  for (const s of map.symbols) {
    const common = s.hits > COMMON_NAME_HITS
    if (!common && s.references.length === 0) continue
    const anchor = firstLocation(s.definedAt, `symbol ${s.name}`)
    entries.push({
      section: s.kind === 'added' ? 2 : 1,
      anchor,
      shards: shardList(s.shard),
      files: [anchor.file, ...s.references.map((r) => r.file)],
      head: common ? `- \`${s.name}\`: ${s.hits} hits, too common to list` : head(s.name, anchor),
      children: common ? [] : s.references,
      total: common ? 0 : s.hits,
    })
  }
  for (const u of map.uses) {
    if (u.definedAt.length === 0) continue
    entries.push({
      section: 3,
      anchor: u.usedIn,
      shards: shardList(u.shard),
      files: [u.usedIn.file, ...u.definedAt.map((d) => d.file)],
      head: head(u.name, u.usedIn),
      children: u.definedAt,
      total: u.definedAt.length,
    })
  }
  for (const r of map.routes) {
    if (r.siblings.length === 0) continue
    entries.push({
      section: 4,
      anchor: r.usedIn,
      shards: shardList(r.shard),
      files: [r.usedIn.file, ...r.siblings.map((s) => s.file)],
      head: head(r.path, r.usedIn),
      children: r.siblings,
      total: r.siblings.length,
    })
  }
  for (const d of map.docs) {
    entries.push({
      section: 5,
      anchor: { file: d.file, line: d.line },
      shards: d.shards,
      files: [d.file],
      head: `- ${d.file}:${d.line} ${codeSpan(d.text)} (names: ${d.mentions.join(', ')})`,
      children: [],
      total: 0,
    })
  }
  return entries.sort((a, b) => {
    if (a.section !== b.section) return a.section - b.section
    if (a.anchor.file !== b.anchor.file) return a.anchor.file < b.anchor.file ? -1 : 1
    return a.anchor.line - b.anchor.line
  })
}

function entryLines(e: Entry, maxChildren: number): string[] {
  const shown = e.children.slice(0, maxChildren)
  const lines = [e.head, ...shown.map((r) => `  - ${r.file}:${r.line} ${codeSpan(r.text)}`)]
  if (e.total > shown.length) lines.push(`  - ${shown.length} of ${e.total} shown`)
  return lines
}

function renderEntries(kept: Entry[], left: number, maxChildren: number): string {
  const lines: string[] = []
  let section = -1
  for (const e of kept) {
    if (e.section !== section) {
      if (lines.length > 0) lines.push('')
      section = e.section
      lines.push(`### ${SECTIONS[section]}`)
    }
    lines.push(...entryLines(e, maxChildren))
  }
  if (left > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`${left} more entries in impact.json`)
  }
  return lines.join('\n')
}

function renderCapped(entries: Entry[], capBytes: number, maxChildren: number): string {
  const fits = (s: string): boolean => Buffer.byteLength(s, 'utf8') <= capBytes
  let kept: Entry[] = []
  for (const e of entries) {
    const trial = [...kept, e]
    // Counting every entry not yet kept bounds the final count line from above.
    if (fits(renderEntries(trial, entries.length - trial.length, maxChildren))) kept = trial
  }
  const out = renderEntries(kept, entries.length - kept.length, maxChildren)
  if (!fits(out)) {
    throw new Error(`Impact render cap of ${capBytes} bytes cannot hold its own count line`)
  }
  return out
}

export function renderImpactMarkdown(
  map: ImpactMap,
  opts: { shard: number | null; capBytes: number; maxChildren?: number },
): string {
  const { shard } = opts
  const entries = entriesOf(map).filter((e) => shard === null || e.shards.includes(shard))
  return renderCapped(entries, opts.capBytes, opts.maxChildren ?? Number.POSITIVE_INFINITY)
}

export function renderImpactForCandidates(
  map: ImpactMap | null,
  candidates: ReviewFinding[],
): string {
  if (!map) return '(none)'
  const files = new Set(candidates.map((c) => c.file))
  const entries = entriesOf(map).filter((e) => e.files.some((f) => files.has(f)))
  if (entries.length === 0) return '(none)'
  return renderCapped(entries, IMPACT_FULL_CAP_BYTES, Number.POSITIVE_INFINITY)
}
