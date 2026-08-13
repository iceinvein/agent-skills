import { validateCensus } from './census.ts'
import { loadConfig } from './config.ts'
import { gate as adjudicationGate } from './gates/adjudication.ts'
import { gate as censusGate } from './gates/census.ts'
import { gate as citationsGate } from './gates/citations.ts'
import type { CensusRow, Gate, GateContext } from './gates/context.ts'
import { gate as coverageGate } from './gates/coverage.ts'
import { gate as deltasGate } from './gates/deltas.ts'
import { gate as handoffGate } from './gates/handoff.ts'
import { gate as leaksGate } from './gates/leaks.ts'
import { gate as parityGate } from './gates/parity.ts'
import { gate as queueGate } from './gates/queue.ts'
import { gate as refsGate } from './gates/refs.ts'
import { gate as runStateGate } from './gates/run-state.ts'
import { gate as sourceGate } from './gates/source.ts'
import { loadHandoff } from './handoff.ts'
import { storePaths } from './paths.ts'
import { loadPhases, PHASES, type Phase } from './phases.ts'
import { loadQueue } from './queue.ts'
import { readRawRows, readRows } from './store.ts'
import type { Capability, Delta, Element, Requirement, Violation } from './types.ts'

export type CheckResult = { summary: string; violations: Violation[] }

export const GATE_ORDER = [
  'coverage',
  'census',
  'refs',
  'queue',
  'deltas',
  'parity',
  'citations',
  'leaks',
  'source',
  'run-state',
  'adjudication',
  'handoff',
] as const

// A gate may declare the earliest phase at which it becomes applicable, and is
// skipped when the checked terminus has not reached it.
//
// Every other gate reads the whole store regardless of --phase, which is right
// for them: a coverage or census gap at phase 5 is a real failure whenever it
// is found. These two describe phases 6 and 7, so firing them unconditionally
// would make `migrate check --phase queue` red for an entire mid-run campaign,
// which is the exact failure the posture split exists to prevent. The rule is
// deliberately narrow: a gate is skipped only when it describes work the
// checked terminus has not reached.
const GATE_PHASE: Partial<Record<(typeof GATE_ORDER)[number], Phase>> = {
  adjudication: 'adjudicate',
  handoff: 'handoff',
}

const GATES: Record<(typeof GATE_ORDER)[number], Gate> = {
  coverage: coverageGate,
  census: censusGate,
  refs: refsGate,
  queue: queueGate,
  deltas: deltasGate,
  parity: parityGate,
  citations: citationsGate,
  leaks: leaksGate,
  source: sourceGate,
  'run-state': runStateGate,
  adjudication: adjudicationGate,
  handoff: handoffGate,
}

// census.jsonl is the one store file that cannot be assumed to have been
// written by census-cmd.ts, since nothing stops a hand edit, and readRows only
// asserts a type onto whatever JSON.parse returns rather than checking it. So
// every row goes through the same validateCensus every real write goes
// through, once, here. Two gates consume the result and neither re-derives it:
// gate 2 reports the shape failures and does the arithmetic, gate 10
// cross-checks the valid records' batch fields. Doing it in one place is also
// what keeps a gate from depending on another gate having run first. File
// order is preserved, because gate 2's messages follow it.
function validateRows(rows: { line: number; raw: unknown }[]): CensusRow[] {
  return rows.map(({ line, raw }) => {
    const result = validateCensus(raw)
    return result.ok
      ? ({ ok: true, line, record: result.value } as const)
      : ({ ok: false, line, raw, errors: result.errors } as const)
  })
}

export async function runCheck(opts: {
  root: string
  citations?: boolean
  leaks?: boolean
  gitBin?: string
  phase?: Phase
}): Promise<CheckResult> {
  const cfg = await loadConfig(opts.root)
  const paths = storePaths(opts.root)
  const gitBin = opts.gitBin ?? 'git'

  const elements = await readRows<Element>(paths.elements)
  const requirements = await readRows<Requirement>(paths.requirements)
  const capabilities = await readRows<Capability>(paths.capabilities)
  const deltas = await readRows<Delta>(paths.deltas)
  const censusRows = validateRows(await readRawRows(paths.census))
  const { items: queueItems, errors: queueErrors } = await loadQueue(paths.queueDir)
  const phases = await loadPhases(opts.root)
  const handoff = await loadHandoff(opts.root)

  const terminusIndex = opts.phase ? PHASES.indexOf(opts.phase) : PHASES.length - 1

  const ctx: GateContext = {
    root: opts.root,
    cfg,
    paths,
    elements,
    requirements,
    capabilities,
    deltas,
    censusRows,
    handoff,
    queueItems,
    queueErrors,
    phases,
    terminusIndex,
    citations: opts.citations !== false,
    leaks: opts.leaks === true,
    gitBin,
  }

  const violations: Violation[] = []
  for (const name of GATE_ORDER) {
    const from = GATE_PHASE[name]
    if (from && PHASES.indexOf(from) > terminusIndex) continue
    violations.push(...(await GATES[name](ctx)))
  }

  // Built here rather than inside the coverage gate: report-cmd.ts reads this
  // out of CheckResult on a store that is expected to still have violations,
  // so it is a property of the run rather than something a gate returns.
  let mapped = 0
  let outOfScope = 0
  let unaccounted = 0
  for (const el of elements) {
    if (el.disposition.kind === 'mapped') mapped++
    else if (el.disposition.kind === 'out-of-scope') outOfScope++
    else unaccounted++
  }
  const summary = `${mapped}/${elements.length} mapped, ${outOfScope} out-of-scope, ${unaccounted} unaccounted`

  // The gates already run in GATE_ORDER, so this sort is only load-bearing for
  // violations a gate did not label with its own name. Kept because the gate
  // field is what check-cmd.ts groups its output by, and a mislabelled
  // violation should still land in a predictable place rather than wherever
  // its producing gate happened to sit.
  const order = new Map(GATE_ORDER.map((g, i) => [g as string, i]))
  violations.sort((a, b) => (order.get(a.gate) ?? 99) - (order.get(b.gate) ?? 99))

  return { summary, violations }
}
