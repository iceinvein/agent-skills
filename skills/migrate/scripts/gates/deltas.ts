import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 5: deltas. A sanctioned delta is only sanctioned once an owner has
// signed it; an unsigned row at gate time is a difference from the source
// nobody agreed to.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  for (const delta of ctx.deltas) {
    if (!delta.owner_signed) {
      violations.push({ gate: 'deltas', message: `${delta.id} is not owner-signed` })
    }
  }
  return violations
}
