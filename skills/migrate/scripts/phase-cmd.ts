import { loadConfig } from './config.ts'
import { LockError } from './lock.ts'
import { isPhase, loadPhases, PHASES, type PhaseState, setPhaseStatus } from './phases.ts'

const STATUSES: readonly PhaseState['status'][] = ['pending', 'running', 'blocked', 'done']

function line(name: string, state: PhaseState): string {
  return `${name.padEnd(11)} ${state.status.padEnd(8)} ${state.batches.length} batch(es)\n`
}

// Reading is the default because phase state should be inspectable before it
// is writable: an orchestrator resuming a run needs to see where it stopped
// far more often than it needs to move the marker.
export async function runPhase(opts: {
  root: string
  name?: string
  status?: string
  forceUnlock?: boolean
}): Promise<number> {
  const phases = await loadPhases(opts.root)
  if (!opts.name) {
    for (const p of PHASES) process.stdout.write(line(p, phases[p]))
    return 0
  }
  if (!isPhase(opts.name)) {
    process.stderr.write(`phase: unknown phase ${opts.name}; want one of ${PHASES.join(', ')}\n`)
    return 2
  }
  const name = opts.name
  if (!opts.status) {
    process.stdout.write(line(name, phases[name]))
    return 0
  }
  if (!(STATUSES as readonly string[]).includes(opts.status)) {
    process.stderr.write(
      `phase: unknown status ${opts.status}; want one of ${STATUSES.join(', ')}\n`,
    )
    return 2
  }
  const cfg = await loadConfig(opts.root)
  try {
    await setPhaseStatus(
      opts.root,
      name,
      opts.status as PhaseState['status'],
      cfg.source.path,
      opts.forceUnlock,
    )
  } catch (e) {
    // A lock failure is neither a bad status value nor an unknown phase: the
    // request is fine and would succeed on retry, so it gets the same
    // dedicated exit code census-cmd.ts and import-cmd.ts already use for it
    // (3), not the generic usage-error code (2) a thrown LockError would
    // otherwise fall through to in main()'s catch-all.
    if (e instanceof LockError) {
      process.stderr.write(`phase: ${e.message}\n`)
      return 3
    }
    throw e
  }
  process.stdout.write(`phase: ${name} is now ${opts.status}\n`)
  return 0
}
