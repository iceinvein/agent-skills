import type { CapCoverage } from './coverage.ts'

// The owner-attested half of forecasting. Everything measured lives in the
// store and in the adapter's throughput; everything here is a judgment, and
// the file carries who made it and when.
//
// The shape follows the flow target's forecast-assumptions.md (quartex/Nexus
// at c2464ac, plugins/stack/templates/docs/modernisation/), because the
// territory-and-multiplier model is both less to attest and more honest than
// the per-requirement weighting table the parent spec first described: a
// campaign names a handful of territories rather than a number per
// requirement.
//
// One section of flow's file is deliberately absent. Its Economics table
// carries dollar rates and token budgets derived from slice telemetry, which
// this tool does not have and must not pretend to.

export type Scenario = {
  label: string
  // `as-is` and `active` extrapolate a measured velocity. A positive number is
  // an owner's target that no measurement backs, and the projection labels it
  // so, which is the whole point of admitting all three.
  rate: 'as-is' | 'active' | number
  streams: number
  tax: number
  note: string
}

export type Assumptions = {
  attestedBy: string
  attestedDate: string
  territories: Record<string, string>
  multipliers: Record<string, number>
  scenarios: Scenario[]
  caveats: string[]
}

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

// Markdown table rows minus the header and separator, cells trimmed. The file
// is documentation and input at once, which is why it is a table rather than
// TOML: the owner reads it as often as the tool does.
function tableRows(block: string): string[][] {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
    .slice(2)
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim()),
    )
}

export function parseAssumptions(raw: string, path: string): Assumptions {
  const { data, body } = parseFrontmatter(raw)
  for (const field of ['attestedBy', 'attestedDate']) {
    if (!data[field]) {
      throw new Error(`forecast assumptions: missing ${field} in ${path}`)
    }
  }
  const sections = extractSections(body)
  for (const name of ['Territories', 'Multipliers', 'Scenarios']) {
    if (sections[name] === undefined) {
      throw new Error(`forecast assumptions: missing section "${name}" in ${path}`)
    }
  }

  const territories: Record<string, string> = {}
  for (const row of tableRows(sections.Territories ?? '')) {
    if (row.length !== 2 || !row[0] || !row[1]) {
      throw new Error(`forecast assumptions: bad territory row in ${path}: [${row.join(' | ')}]`)
    }
    territories[row[0]] = row[1]
  }

  const multipliers: Record<string, number> = {}
  for (const row of tableRows(sections.Multipliers ?? '')) {
    const value = Number(row[1])
    if (row.length !== 2 || !row[0] || !Number.isFinite(value) || value <= 0) {
      throw new Error(`forecast assumptions: bad multiplier row in ${path}: [${row.join(' | ')}]`)
    }
    multipliers[row[0]] = value
  }

  const scenarios: Scenario[] = tableRows(sections.Scenarios ?? '').map((row) => {
    const [label, rateRaw, streamsRaw, taxRaw, note] = row
    if (row.length !== 5 || !label) {
      throw new Error(`forecast assumptions: bad scenario row in ${path}: [${row.join(' | ')}]`)
    }
    let rate: Scenario['rate']
    if (rateRaw === 'as-is' || rateRaw === 'active') {
      rate = rateRaw
    } else {
      const n = Number(rateRaw)
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(
          `forecast assumptions: scenario "${label}" rate must be as-is, active, or a positive requirements-per-day number in ${path}`,
        )
      }
      rate = n
    }
    const streams = Number(streamsRaw)
    if (!Number.isFinite(streams) || streams <= 0) {
      throw new Error(
        `forecast assumptions: scenario "${label}" streams must be a positive number in ${path}`,
      )
    }
    const tax = Number(taxRaw)
    if (!Number.isFinite(tax) || tax < 0 || tax >= 1) {
      throw new Error(`forecast assumptions: scenario "${label}" tax must be in [0, 1) in ${path}`)
    }
    return { label, rate, streams, tax, note: note ?? '' }
  })

  const caveats = (sections.Caveats ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2))

  return {
    attestedBy: data.attestedBy ?? '',
    attestedDate: data.attestedDate ?? '',
    territories,
    multipliers,
    scenarios,
    caveats,
  }
}

// Validated against measured coverage, not against itself. A capability with
// nothing confirmed needs no territory, because it contributes nothing to
// demand; one with confirmed requirements and no territory would silently
// weigh whatever the fallback happened to be.
export function validateAssumptions(a: Assumptions, coverage: CapCoverage[]): string[] {
  const errors: string[] = []
  for (const c of coverage) {
    if (c.confirmedTotal > 0 && !a.territories[c.slug]) {
      errors.push(
        `capability ${c.slug} has ${c.confirmedTotal} confirmed requirement(s) but no territory in the forecast assumptions`,
      )
    }
  }
  for (const [slug, territory] of Object.entries(a.territories)) {
    if (!(territory in a.multipliers)) {
      errors.push(`territory "${territory}" (${slug}) has no multiplier`)
    }
  }
  if (a.scenarios.length === 0) errors.push('no scenarios defined')
  return errors
}
