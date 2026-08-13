import type { Assumptions } from './assumptions.ts'
import type { CapCoverage } from './coverage.ts'
import type { Completion, Rate } from './types.ts'

const DAY_MS = 86_400_000

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

export type TerritoryDemand = {
  territory: string
  capabilities: string[]
  remainingRaw: number
  multiplier: number
  frEquivalents: number
}

export type Demand = {
  territories: TerritoryDemand[]
  remainingRaw: number
  remainingWeighted: number
}

// Demand is reported both ways on purpose. `raw` is a count anyone can check
// against the store; `weighted` is that count through the owner's attested
// multipliers. Printing only the weighted figure would bury a judgment inside
// something that looks like a measurement.
//
// Territories come out in Multipliers-table order, which is the order the
// milestone sequence walks: the owner decides what gets finished first by
// deciding how to write that table.
export function demandOf(assumptions: Assumptions, coverage: CapCoverage[]): Demand {
  const territories: TerritoryDemand[] = Object.entries(assumptions.multipliers).map(
    ([territory, multiplier]) => {
      const caps = coverage.filter((c) => assumptions.territories[c.slug] === territory)
      const remainingRaw = caps.reduce((n, c) => n + (c.confirmedTotal - c.covered), 0)
      return {
        territory,
        capabilities: caps.map((c) => c.slug),
        remainingRaw,
        multiplier,
        frEquivalents: remainingRaw * multiplier,
      }
    },
  )
  return {
    territories,
    remainingRaw: territories.reduce((n, t) => n + t.remainingRaw, 0),
    remainingWeighted: territories.reduce((n, t) => n + t.frEquivalents, 0),
  }
}

const UNMEASURED = 'not enough dated completions to measure a rate; one point is not a rate'

// Two measured velocities from the same completions, and the difference
// between them is the honest uncertainty band. `as-is` divides by every
// calendar day since the first completion, quiet days included, and is the
// pessimistic base. `active` divides only by the days something completed, and
// is the optimistic one.
//
// The era runs from the earliest completion rather than from an attested
// baseline, so both stay measured and the assumptions file holds judgment
// only. Undated completions contribute to neither: they are counted as built
// by coverage and say nothing about pace.
export function velocities(completions: Completion[], today: string): { asIs: Rate; active: Rate } {
  const dates = completions
    .map((c) => c.doneAt)
    .filter((d): d is string => d !== null)
    .sort()
  if (dates.length < 2) {
    return { asIs: { value: null, basis: UNMEASURED }, active: { value: null, basis: UNMEASURED } }
  }
  const first = dates[0] as string
  const eraDays = Math.max(
    1,
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS,
  )
  const activeDays = new Set(dates).size
  return {
    asIs: {
      value: dates.length / eraDays,
      basis: `${dates.length} dated completion(s) over ${eraDays} calendar day(s) since ${first}, quiet days included`,
    },
    active: {
      value: dates.length / activeDays,
      basis: `${dates.length} dated completion(s) over ${activeDays} day(s) something completed`,
    },
  }
}

export type Projection = {
  label: string
  // The epistemic family. `as-is` and `active` extrapolate something measured;
  // `target` scales a rate the owner attested and nothing backs. Views keep
  // the two apart so an aspiration never reads as a fact.
  basis: 'as-is' | 'active' | 'target'
  streams: number
  tax: number
  note: string
  ratePerStream: number | null
  perDay: number | null
  daysRaw: number | null
  finishRaw: string | null
  daysWeighted: number | null
  finishWeighted: string | null
  band: { optimistic: string | null; pessimistic: string | null } | null
  milestones: { territory: string; finish: string | null }[]
}

// Null propagates. Every figure whose input is unmeasured comes out null and
// renders as omitted, rather than as a zero or a guess. That is what makes the
// no-dates case degrade cleanly: the flow adapter supplies coverage without
// dates, so measured rows project nothing and say why, while target rows still
// project because they never needed a measurement.
const daysFor = (remaining: number, rate: number | null): number | null =>
  rate !== null && rate > 0 && remaining > 0 ? Math.ceil(remaining / rate) : null

export function project(input: {
  assumptions: Assumptions
  demand: Demand
  velocity: { asIs: Rate; active: Rate }
  today: string
}): Projection[] {
  const { assumptions, demand, velocity, today } = input
  const finishFor = (remaining: number, rate: number | null): string | null => {
    const d = daysFor(remaining, rate)
    return d === null ? null : addDays(today, d)
  }

  return assumptions.scenarios.map((s) => {
    const scaled = (base: number | null): number | null =>
      base === null ? null : base * s.streams * (1 - s.tax)
    const basis =
      typeof s.rate === 'number'
        ? ('target' as const)
        : s.rate === 'as-is'
          ? ('as-is' as const)
          : ('active' as const)
    const ratePerStream =
      typeof s.rate === 'number'
        ? s.rate
        : s.rate === 'as-is'
          ? velocity.asIs.value
          : velocity.active.value
    const perDay = scaled(ratePerStream)

    const milestones: { territory: string; finish: string | null }[] = []
    let cumulative = 0
    for (const t of demand.territories) {
      if (t.remainingRaw <= 0) continue
      cumulative += t.frEquivalents
      milestones.push({ territory: t.territory, finish: finishFor(cumulative, perDay) })
    }

    return {
      label: s.label,
      basis,
      streams: s.streams,
      tax: s.tax,
      note: s.note,
      ratePerStream,
      perDay,
      daysRaw: daysFor(demand.remainingRaw, perDay),
      finishRaw: finishFor(demand.remainingRaw, perDay),
      daysWeighted: daysFor(demand.remainingWeighted, perDay),
      finishWeighted: finishFor(demand.remainingWeighted, perDay),
      // A target row has no measured spread behind it, so offering a band
      // would dress an attested number as an observed range.
      band:
        typeof s.rate === 'number'
          ? null
          : {
              optimistic: finishFor(demand.remainingWeighted, scaled(velocity.active.value)),
              pessimistic: finishFor(demand.remainingWeighted, scaled(velocity.asIs.value)),
            },
      milestones,
    }
  })
}

export function renderForecast(input: {
  assumptions: Assumptions
  demand: Demand
  velocity: { asIs: Rate; active: Rate }
  projections: Projection[]
  today: string
  undated: number
}): string {
  const { assumptions, demand, velocity, projections, today, undated } = input
  const lines = [
    `forecast from ${today}, attested by ${assumptions.attestedBy} on ${assumptions.attestedDate}`,
    `remaining ${demand.remainingRaw} requirement(s), ${demand.remainingWeighted} weighted by attested multipliers`,
    '',
    'measured velocity',
    `  as-is   ${velocity.asIs.value === null ? 'unmeasured' : `${velocity.asIs.value.toFixed(2)}/day`}  (${velocity.asIs.basis})`,
    `  active  ${velocity.active.value === null ? 'unmeasured' : `${velocity.active.value.toFixed(2)}/day`}  (${velocity.active.basis})`,
  ]
  if (undated > 0) {
    lines.push(`  ${undated} completion(s) carry no date and contribute to neither rate`)
  }
  lines.push('')

  for (const p of projections) {
    const kind =
      p.basis === 'target'
        ? 'target (owner-attested, nothing measures this)'
        : `measured (${p.basis})`
    lines.push(`${p.label}: ${kind}`)
    lines.push(`  ${p.streams} stream(s), tax ${p.tax}, ${p.note}`)
    if (p.perDay === null) {
      lines.push('  not projected: no measured rate to extrapolate from')
    } else {
      lines.push(`  ${p.perDay.toFixed(2)} requirement(s)/day`)
      lines.push(`  raw       ${p.finishRaw ?? 'omitted'} (${p.daysRaw ?? 0} day(s))`)
      lines.push(`  weighted  ${p.finishWeighted ?? 'omitted'} (${p.daysWeighted ?? 0} day(s))`)
      if (p.band) {
        lines.push(
          `  band      ${p.band.optimistic ?? 'omitted'} to ${p.band.pessimistic ?? 'omitted'}`,
        )
      }
      for (const m of p.milestones) {
        lines.push(`  ${m.territory} done by ${m.finish ?? 'omitted'}`)
      }
    }
    lines.push('')
  }

  if (assumptions.caveats.length > 0) {
    lines.push('caveats')
    for (const c of assumptions.caveats) lines.push(`  - ${c}`)
  }
  return lines.join('\n')
}
