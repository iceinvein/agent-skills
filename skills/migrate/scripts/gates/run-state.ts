import { PHASES, type Phase } from '../phases.ts'
import type { Violation } from '../types.ts'
import { type Gate, validCensus } from './context.ts'

// Gate 10: run-state. Every other gate proves the store is internally
// consistent, which an empty store satisfies. This one asks whether the run
// that was supposed to fill it actually happened, which is the only reason
// exit 0 can mean "complete" rather than "nothing contradicts anything".
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  const terminusName = PHASES[ctx.terminusIndex]

  for (let i = 0; i <= ctx.terminusIndex; i++) {
    const p = PHASES[i]
    if (!p) continue
    const status = ctx.phases[p].status
    if (status !== 'done') {
      violations.push({
        gate: 'run-state',
        message: `phase ${p} is ${status}; every phase through ${terminusName} must be done`,
      })
    }
  }

  // Checked across all eight phases, not just up to the terminus: a later
  // phase marked done over a pending predecessor is hand-edited state, and it
  // is worth naming whether or not the caller asked about that phase.
  for (let i = 1; i < PHASES.length; i++) {
    const current = PHASES[i]
    const previous = PHASES[i - 1]
    if (!current || !previous) continue
    if (ctx.phases[current].status === 'done' && ctx.phases[previous].status === 'pending') {
      violations.push({
        gate: 'run-state',
        message: `phase ${current} is done while ${previous} is still pending`,
      })
    }
  }

  // A census record naming a batch phases.json never committed means the two
  // disagree about what happened. Only checked when the record exists, since
  // gate 2 already names a declared surface or closer that has none.
  const committedIn = (phase: Phase): Set<string> =>
    new Set(ctx.phases[phase].batches.map((b) => b.id))
  const census = validCensus(ctx.censusRows)
  const enumerateBatches = committedIn('enumerate')
  for (const surface of ctx.cfg.surfaces) {
    const record = census.find((r) => r.kind === 'lens' && r.surface === surface)
    if (record && !enumerateBatches.has(record.batch)) {
      violations.push({
        gate: 'run-state',
        message: `lens census for ${surface} names batch ${record.batch}, which phases.json has no record of committing in enumerate`,
      })
    }
  }
  const extractBatches = committedIn('extract')
  for (const closer of ctx.cfg.closers) {
    const record = census.find((r) => r.kind === 'closer' && r.closer === closer)
    if (record && !extractBatches.has(record.batch)) {
      violations.push({
        gate: 'run-state',
        message: `closer census for ${closer} names batch ${record.batch}, which phases.json has no record of committing in extract`,
      })
    }
  }
  return violations
}
