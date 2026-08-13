import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 6: parity coverage. A requirement whose confidence is `queued` is
// waiting on an owner decision, so it is not yet expected to carry a parity
// plan; every other requirement is.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  for (const req of ctx.requirements) {
    if (req.confidence.kind !== 'queued' && req.parity === null) {
      violations.push({ gate: 'parity', message: `${req.id} has no parity plan` })
    }
  }
  return violations
}
