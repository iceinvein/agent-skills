import { isCalendarDate } from './dates.ts'
import type { HandoffFile } from './handoff.ts'
import type { Requirement, Throughput } from './types.ts'

export type CapCoverage = {
  slug: string
  title: string
  confirmedTotal: number
  covered: number
  coveredIds: string[]
  uncoveredIds: string[]
}

export type CoverageReport = {
  caps: CapCoverage[]
  built: number
  confirmed: number
  // Completions that were counted as built but carry no date. They contribute
  // to coverage and contribute nothing to forecast's measured rate, so the
  // count is printed rather than folded away.
  undated: number
  // Completions naming a requirement the store does not have. Not a
  // degradation: it means the emitted work and the store have diverged, so the
  // caller treats it as a failure.
  unknown: string[]
  nonConfirmed: { slug: string; count: number }[]
  // Capabilities the store has requirements in that the emitted order does not
  // name: the handoff predates them, so the emitted work is out of date.
  stale: string[]
  basis: string
}

// The denominator is confirmed requirements only.
//
// This is the method's position rather than a choice made here: flow's own
// computeParity divides by `conf === "Confirmed"`, and reports the excluded
// count separately. Parity is a promise about behaviour the run confirmed, and
// holding a build team to an inferred requirement would assert a confidence
// the extract phase explicitly declined to claim. Handoff still emits every
// requirement, so nothing is hidden; it is only the denominator that narrows,
// and the exclusions are printed underneath.
export function computeCoverage(input: {
  requirements: Requirement[]
  handoff: HandoffFile
  throughput: Throughput
}): CoverageReport {
  const { requirements, handoff, throughput } = input
  const known = new Set(requirements.map((r) => r.id))
  const byId = new Map(requirements.map((r) => [r.id, r]))

  const unknown: string[] = []
  const builtIds = new Set<string>()
  let undated = 0
  for (const c of throughput.completions) {
    if (!known.has(c.fr)) {
      unknown.push(c.fr)
      continue
    }
    builtIds.add(c.fr)
    // A date that is not a real calendar day cannot date anything, so it is
    // reported the same way a missing one is rather than counted as dated.
    if (c.doneAt === null || !isCalendarDate(c.doneAt)) undated++
  }

  const titleOf = new Map(handoff.items.map((i) => [i.key, i.title]))
  const caps: CapCoverage[] = []
  const nonConfirmed: { slug: string; count: number }[] = []

  // Every capability the STORE has requirements in, not only those the emitted
  // order happens to name. Walking `basis.order` alone let a stale handoff.json
  // narrow both numerator and denominator silently: a store with three
  // confirmed requirements in a capability absent from `order` reported
  // "built 7/7 confirmed requirements (100%)" while three were unbuilt and the
  // capability appeared nowhere in the output. The order still decides the
  // display sequence; anything it omits is appended and named as stale.
  const inStore = [...new Set(requirements.map((r) => r.cap))]
  const stale = inStore.filter((slug) => !handoff.basis.order.includes(slug)).sort()
  for (const slug of [...handoff.basis.order, ...stale]) {
    const own = requirements.filter((r) => r.cap === slug)
    const confirmed = own.filter((r) => r.confidence.kind === 'confirmed')
    const coveredIds = confirmed.filter((r) => builtIds.has(r.id)).map((r) => r.id)
    const uncoveredIds = confirmed.filter((r) => !builtIds.has(r.id)).map((r) => r.id)
    caps.push({
      slug,
      title: titleOf.get(slug) ?? slug,
      confirmedTotal: confirmed.length,
      covered: coveredIds.length,
      coveredIds,
      uncoveredIds,
    })
    const excluded = own.length - confirmed.length
    if (excluded > 0) nonConfirmed.push({ slug, count: excluded })
  }

  // Counted off the per-capability rows rather than off builtIds, so a
  // completion for a non-confirmed requirement cannot inflate the figure that
  // sits above a breakdown which excludes it.
  const built = caps.reduce((n, c) => n + c.covered, 0)
  const confirmed = caps.reduce((n, c) => n + c.confirmedTotal, 0)

  // A requirement whose capability never reached a work item is invisible to
  // the loop above, which walks the emitted order. Gate 12 names it, so this
  // does not report it again; it only avoids counting it.
  void byId

  return { caps, built, confirmed, undated, unknown, stale, nonConfirmed, basis: throughput.basis }
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

export function renderCoverage(r: CoverageReport): string {
  // Never round to a number the fraction beside it contradicts. Math.round
  // printed 199/200 as 100% and 1/250 as 0%, and the percentage is the figure
  // that gets quoted onward while the fraction stays behind.
  const pct =
    r.confirmed === 0
      ? 0
      : r.built === r.confirmed
        ? 100
        : r.built === 0
          ? 0
          : Math.min(99, Math.max(1, Math.round((r.built / r.confirmed) * 100)))
  const lines = [
    `built ${r.built}/${r.confirmed} confirmed requirements (${pct}%)`,
    `evidence: ${r.basis}`,
  ]
  if (r.undated > 0) {
    lines.push(
      `undated: ${r.undated} completion(s) carry no date; they count as built and contribute nothing to forecast's measured rate`,
    )
  }
  if (r.nonConfirmed.length > 0) {
    const total = r.nonConfirmed.reduce((n, e) => n + e.count, 0)
    const detail = r.nonConfirmed.map((e) => `${e.slug} ${e.count}`).join(', ')
    lines.push(`excluded: ${total} non-confirmed (${detail})`)
  }
  if (r.stale.length > 0) {
    lines.push(
      `stale: ${r.stale.length} capability(ies) not in the emitted work (${r.stale.join(', ')}); re-run migrate handoff`,
    )
  }
  lines.push('')
  const width = Math.max(4, ...r.caps.map((c) => c.slug.length))
  for (const c of r.caps) {
    const done = c.confirmedTotal > 0 && c.covered === c.confirmedTotal ? '  done' : ''
    lines.push(`${pad(c.slug, width)}  ${c.covered}/${c.confirmedTotal}${done}`)
  }
  return lines.join('\n')
}
