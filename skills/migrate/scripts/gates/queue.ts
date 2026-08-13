import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 4: queue grammar. loadQueue does the parsing and collects one error
// string per grammar violation; this gate only labels them, because a queue
// file that will not parse is equally a problem for `queue list`, `report`
// and `adjudicate`, all of which call loadQueue directly.
export const gate: Gate = (ctx): Violation[] =>
  ctx.queueErrors.map((message) => ({ gate: 'queue', message }))
