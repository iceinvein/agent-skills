import { resolveCitations } from '../citations.ts'
import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 7: citations. On unless explicitly disabled. An FR citing a path that
// does not exist is the never-fabricate rule's only mechanical expression, so
// it should not be something a run has to remember to ask for.
export const gate: Gate = async (ctx): Promise<Violation[]> => {
  if (!ctx.citations) return []
  return resolveCitations(ctx.requirements, ctx.cfg.source.path)
}
