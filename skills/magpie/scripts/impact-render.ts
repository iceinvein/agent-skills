import { COMMON_NAME_HITS, type ImpactLocation, type ImpactMap, type ImpactRef } from './impact.ts'
import type { ReviewFinding } from './types.ts'

export const IMPACT_FULL_CAP_BYTES = 8192
export const IMPACT_BRIEF_CAP_BYTES = 2048

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
  // Docs carry no shard, so they only render when no shard is asked for.
  shard: number | null
  files: string[]
  lines: string[]
}

function refLine(r: ImpactRef): string {
  return `  - ${r.file}:${r.line} \`${r.text}\``
}

function head(name: string, at: ImpactLocation): string {
  return `- \`${name}\` (diff: ${at.file}:${at.line})`
}

function firstLocation(list: ImpactLocation[], what: string): ImpactLocation {
  const at = list[0]
  if (!at) throw new Error(`Impact ${what} has no diff location`)
  return at
}

function entriesOf(map: ImpactMap): Entry[] {
  const entries: Entry[] = []
  for (const s of map.stores) {
    const anchor = firstLocation(s.usedIn, `store ${s.name}`)
    entries.push({
      section: 0,
      anchor,
      shard: s.shard,
      files: [...s.usedIn.map((u) => u.file), ...s.writers.map((w) => w.file)],
      lines: [head(s.name, anchor), ...s.writers.map(refLine)],
    })
  }
  for (const s of map.symbols) {
    const anchor = firstLocation(s.definedAt, `symbol ${s.name}`)
    const common = s.hits > COMMON_NAME_HITS
    const lines = common
      ? [`- \`${s.name}\`: ${s.hits} hits, too common to list`]
      : [head(s.name, anchor), ...s.references.map(refLine)]
    if (!common && s.hits > s.references.length) {
      lines.push(`  - ${s.references.length} of ${s.hits} shown`)
    }
    entries.push({
      section: s.kind === 'added' ? 2 : 1,
      anchor,
      shard: s.shard,
      files: [anchor.file, ...s.references.map((r) => r.file)],
      lines,
    })
  }
  for (const u of map.uses) {
    entries.push({
      section: 3,
      anchor: u.usedIn,
      shard: u.shard,
      files: [u.usedIn.file, ...u.definedAt.map((d) => d.file)],
      lines: [head(u.name, u.usedIn), ...u.definedAt.map(refLine)],
    })
  }
  for (const r of map.routes) {
    entries.push({
      section: 4,
      anchor: r.usedIn,
      shard: r.shard,
      files: [r.usedIn.file, ...r.siblings.map((s) => s.file)],
      lines: [head(r.path, r.usedIn), ...r.siblings.map(refLine)],
    })
  }
  for (const d of map.docs) {
    entries.push({
      section: 5,
      anchor: { file: d.file, line: d.line },
      shard: null,
      files: [d.file],
      lines: [`- ${d.file}:${d.line} \`${d.text}\` (names: ${d.mentions.join(', ')})`],
    })
  }
  return entries.sort((a, b) => {
    if (a.section !== b.section) return a.section - b.section
    if (a.anchor.file !== b.anchor.file) return a.anchor.file < b.anchor.file ? -1 : 1
    return a.anchor.line - b.anchor.line
  })
}

function renderEntries(entries: Entry[], kept: number): string {
  const lines: string[] = []
  let section = -1
  for (const e of entries.slice(0, kept)) {
    if (e.section !== section) {
      if (lines.length > 0) lines.push('')
      section = e.section
      lines.push(`### ${SECTIONS[section]}`)
    }
    lines.push(...e.lines)
  }
  const left = entries.length - kept
  if (left > 0) {
    if (lines.length > 0) lines.push('')
    lines.push(`${left} more entries in impact.json`)
  }
  return lines.join('\n')
}

function renderCapped(entries: Entry[], capBytes: number): string {
  let kept = entries.length
  let out = renderEntries(entries, kept)
  while (kept > 0 && Buffer.byteLength(out, 'utf8') > capBytes) {
    kept--
    out = renderEntries(entries, kept)
  }
  return out
}

export function renderImpactMarkdown(
  map: ImpactMap,
  opts: { shard: number | null; capBytes: number },
): string {
  const entries = entriesOf(map).filter((e) => opts.shard === null || e.shard === opts.shard)
  return renderCapped(entries, opts.capBytes)
}

export function renderImpactForCandidates(
  map: ImpactMap | null,
  candidates: ReviewFinding[],
): string {
  if (!map) return '(none)'
  const files = new Set(candidates.map((c) => c.file))
  const entries = entriesOf(map).filter((e) => e.files.some((f) => files.has(f)))
  if (entries.length === 0) return '(none)'
  return renderCapped(entries, IMPACT_FULL_CAP_BYTES)
}
