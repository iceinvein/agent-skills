import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 11: adjudication. Every queue item carries an owner's ruling.
//
// The queue gate already refuses an `adjudicated` item with no ruling, and
// this gate checks the same thing independently rather than leaning on it. A
// gate whose soundness depends on another gate having run first is not
// independently a gate, and the two are asking different questions: the queue
// gate asks whether the file is well formed, this one asks whether the
// decision was made.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  for (const item of ctx.queueItems) {
    if (item.status !== 'adjudicated') {
      violations.push({
        gate: 'adjudication',
        message: `${item.id} [${item.severity}] is still ${item.status}; every queue item needs a ruling before handoff`,
      })
      continue
    }
    if (!item.ruling || item.ruling.trim().length === 0) {
      violations.push({
        gate: 'adjudication',
        message: `${item.id} [${item.severity}] is adjudicated with no ruling recorded`,
      })
    }
  }
  return violations
}
