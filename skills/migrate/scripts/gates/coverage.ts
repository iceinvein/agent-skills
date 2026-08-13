import type { Violation } from '../types.ts'
import type { Gate } from './context.ts'

// Gate 1: coverage. Every element must carry a terminal disposition.
//
// The summary line runCheck returns ("612/612 mapped, ...") counts the same
// three dispositions this gate walks, but it is built in check.ts rather than
// here, because report-cmd.ts reads it out of CheckResult on a store that is
// expected to have violations. A gate returns violations; the summary is a
// property of the run.
export const gate: Gate = (ctx): Violation[] => {
  const violations: Violation[] = []
  for (const el of ctx.elements) {
    if (el.disposition.kind === 'mapped') continue
    if (el.disposition.kind === 'out-of-scope') continue
    violations.push({
      gate: 'coverage',
      message: `${el.id} (${el.surface}) is still unaccounted`,
    })
  }
  return violations
}
