import { runCheck } from './check.ts'
import type { Phase } from './phases.ts'

export async function runCheckCmd(opts: {
  root: string
  citations?: boolean
  leaks?: boolean
  phase?: Phase
}): Promise<number> {
  const result = await runCheck(opts)
  process.stdout.write(`${result.summary}\n`)
  if (result.violations.length === 0) return 0

  process.stdout.write(`\nViolations (${result.violations.length}):\n`)
  let lastGate = ''
  for (const v of result.violations) {
    if (v.gate !== lastGate) {
      process.stdout.write(`  ${v.gate}:\n`)
      lastGate = v.gate
    }
    process.stdout.write(`    ${v.message}\n`)
  }
  return 1
}
