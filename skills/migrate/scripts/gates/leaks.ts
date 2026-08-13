import { scanLeaks } from '../leaks.ts'
import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 8: leaks, opt-in. Unlike citations, the scan shells out to `git log -S`
// per secret and its cost scales with history depth rather than with store
// size, which is why it stays behind a flag while citations do not.
export const gate: Gate = async (ctx): Promise<Violation[]> => {
  if (!ctx.leaks) return []
  return scanLeaks({ root: ctx.root, gitBin: ctx.gitBin })
}
