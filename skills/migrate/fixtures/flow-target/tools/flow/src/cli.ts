#!/usr/bin/env bun
// A faithful subset of the flow target's own capability parser, standing in
// for `tools/flow/src/cli.ts` in a real Nexus `stack` target.
//
// This is NOT the target. It is a vendored subset of the rules in
// quartex/Nexus at c2464ac, plugins/stack/templates/tools/flow/src/
// capability.ts, reproduced so the migrate flow adapter has something to be
// checked against. Every rule below cites the line it came from, and the
// conformance test in scripts/__tests__/adapter-flow.test.ts asserts each one
// independently, so a rule drifting in the real target shows up as a test that
// no longer describes reality rather than as silence.
//
// Commands: `map` (no-op regeneration), `map --check` (validate every
// capability file), `parity --json` (emit CapabilityCoverage[]).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CAP_STATUSES = ['done', 'partial', 'minimal', 'todo'] // capability.ts:3
const CONFIDENCES = ['Confirmed', 'Inferred', 'Speculative'] // capability.ts:6
const ORIGINS = ['intended', 'poss-accidental', 'cruft'] // capability.ts:9
const REQUIRED_FRONTMATTER = ['cap', 'ns', 'title', 'status'] // capability.ts:43
const REQUIRED_SECTIONS = ['Functional requirements', 'Built', 'Remaining'] // capability.ts:44

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// capability.ts:42
const frIdPattern = (ns: string): RegExp => new RegExp(`^${escapeRegex(ns)}-\\d{3}$`)

type Fr = { id: string; conf: string; origin: string }
type Capability = { cap: string; ns: string; title: string; status: string; frs: Fr[]; built: string }

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const lines = raw.split('\n')
  if (lines[0]?.trim() !== '---') return { data: {}, body: raw }
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (close === -1) return { data: {}, body: raw }
  const data: Record<string, string> = {}
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(':')
    if (at === -1) continue
    data[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { data, body: lines.slice(close + 1).join('\n') }
}

// capability.ts:48. Sections are split on a line beginning '## ', which is why
// an emitter must never put '## ' at the start of a line inside a table.
function extractSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const parts = body.split(/\n## /).map((p, i) => (i === 0 ? p : `## ${p}`))
  for (const part of parts) {
    const m = part.match(/^## (.+)\n/)
    if (!m?.[1]) continue
    sections[m[1].trim()] = part.slice(m[0].length).trim()
  }
  return sections
}

function parseFrTable(block: string, path: string, ns: string): Fr[] {
  const frId = frIdPattern(ns)
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
  const seen = new Set<string>()
  return lines.slice(2).map((line) => {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    const [id, , , , , conf, origin] = cells
    if (cells.length !== 7 || !id) throw new Error(`malformed FR row: ${id ?? line} in ${path}`) // capability.ts:74
    if (!frId.test(id)) throw new Error(`invalid FR id: ${id} in ${path}`)
    if (seen.has(id)) throw new Error(`duplicate FR id: ${id} in ${path}`)
    seen.add(id)
    if (!CONFIDENCES.includes(conf ?? '')) throw new Error(`invalid confidence: ${conf} in ${path}`)
    if (!ORIGINS.includes(origin ?? '')) throw new Error(`invalid origin: ${origin} in ${path}`)
    return { id, conf: conf ?? '', origin: origin ?? '' }
  })
}

export function parseCapability(raw: string, path: string): Capability {
  const { data, body } = parseFrontmatter(raw)
  for (const field of REQUIRED_FRONTMATTER) {
    if (!data[field]) throw new Error(`missing field: ${field} in ${path}`)
  }
  if (!CAP_STATUSES.includes(data.status ?? '')) {
    throw new Error(`invalid status: ${data.status} in ${path}`)
  }
  const sections = extractSections(body)
  for (const name of REQUIRED_SECTIONS) {
    if (sections[name] === undefined) throw new Error(`missing section: ${name} in ${path}`)
  }
  return {
    cap: data.cap ?? '',
    ns: data.ns ?? '',
    title: data.title ?? '',
    status: data.status ?? '',
    built: sections.Built ?? '',
    frs: parseFrTable(sections['Functional requirements'] ?? '', path, data.ns ?? ''),
  }
}

function loadAll(cwd: string): Capability[] {
  const dir = join(cwd, 'docs/modernisation/capability-map')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md') && n !== 'pre-ledger-baseline.md')
    .sort()
    .map((n) => parseCapability(readFileSync(join(dir, n), 'utf8'), n))
}

const argv = process.argv.slice(2)
const cwd = process.cwd()

try {
  if (argv[0] === 'map' && argv[1] === '--check') {
    loadAll(cwd)
    process.stdout.write('map: ok\n')
  } else if (argv[0] === 'map') {
    loadAll(cwd)
    process.stdout.write('map: ok (regenerated)\n')
  } else if (argv[0] === 'parity' && argv[1] === '--json') {
    // The real computeParity (parity.ts:17) derives covered ids from merged
    // slices plus a baseline, which needs a slice ledger this fixture has no
    // reason to carry. The emitted shape is the real one; the derivation reads
    // the `## Built` section instead, so a test can drive coverage.
    const caps = loadAll(cwd)
    process.stdout.write(
      `${JSON.stringify(
        caps.map((c) => {
          const built = new Set(c.built.split(/[\s,]+/).filter((t) => t.length > 0))
          const confirmed = c.frs.filter((f) => f.conf === 'Confirmed')
          return {
            cap: c.cap,
            ns: c.ns,
            title: c.title,
            status: c.status,
            confirmedTotal: confirmed.length,
            covered: confirmed.filter((f) => built.has(f.id)).length,
            coveredIds: confirmed.filter((f) => built.has(f.id)).map((f) => f.id),
            uncoveredIds: confirmed.filter((f) => !built.has(f.id)).map((f) => f.id),
          }
        }),
        null,
        2,
      )}\n`,
    )
  } else {
    process.stderr.write(`flow: unhandled command: ${argv.join(' ')}\n`)
    process.exit(1)
  }
} catch (e) {
  process.stderr.write(`${(e as Error).message}\n`)
  process.exit(1)
}
