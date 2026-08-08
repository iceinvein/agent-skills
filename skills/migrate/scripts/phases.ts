import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { withStoreLock } from './lock.ts'
import { storePaths } from './paths.ts'
import { writeAtomically } from './store.ts'

export const PHASES = [
  'probe',
  'enumerate',
  'seam',
  'extract',
  'parity',
  'queue',
  'adjudicate',
  'handoff',
] as const

export type Phase = (typeof PHASES)[number]

export type Batch = { id: string; count: number }

export type PhaseState = {
  status: 'pending' | 'running' | 'blocked' | 'done'
  batches: Batch[]
  pending: string[]
}

export type PhasesFile = { version: 1; phases: Record<Phase, PhaseState> }

export function isPhase(s: string): s is Phase {
  return (PHASES as readonly string[]).includes(s)
}

function empty(): Record<Phase, PhaseState> {
  const out = {} as Record<Phase, PhaseState>
  for (const p of PHASES) out[p] = { status: 'pending', batches: [], pending: [] }
  return out
}

export async function loadPhases(root: string): Promise<Record<Phase, PhaseState>> {
  const path = storePaths(root).phases
  if (!existsSync(path)) return empty()
  const text = await readFile(path, 'utf8')
  let parsed: PhasesFile
  try {
    parsed = JSON.parse(text) as PhasesFile
  } catch {
    throw new Error(`${path}: malformed JSON`)
  }
  const state = empty()
  for (const p of PHASES) {
    const found = parsed.phases?.[p]
    if (found)
      state[p] = {
        status: found.status,
        batches: found.batches ?? [],
        pending: found.pending ?? [],
      }
  }
  return state
}

// Writes phases.json atomically using temp-plus-rename. Atomicity alone does
// not make a read-modify-write safe: two callers can still read the same base
// and one rename still discards the other's batches. That is closed by the
// store lock, not here. This function deliberately does not take it, because
// every caller already holds it -- recordBatch runs inside import's and
// census's critical sections, setPhaseStatus takes it itself, and reset-cmd.ts
// wraps its whole mutation in it -- and withStoreLock is not reentrant, so a
// lock taken here would deadlock all three.
export async function savePhases(
  root: string,
  phases: Record<Phase, PhaseState>,
  sourcePath: string,
): Promise<void> {
  const path = storePaths(root).phases
  const file: PhasesFile = { version: 1, phases }
  await writeAtomically(path, `${JSON.stringify(file, null, 2)}\n`, sourcePath)
}

export async function recordBatch(
  root: string,
  phase: Phase,
  batch: Batch,
  sourcePath: string,
): Promise<void> {
  const phases = await loadPhases(root)
  const state = phases[phase]
  if (!state.batches.some((b) => b.id === batch.id)) state.batches.push(batch)
  if (state.status !== 'done') state.status = 'running'
  await savePhases(root, phases, sourcePath)
}

export async function setPhaseStatus(
  root: string,
  phase: Phase,
  status: PhaseState['status'],
  sourcePath: string,
  forceUnlock?: boolean,
): Promise<void> {
  // Same read-modify-write hazard as recordBatch. The orchestrator is the
  // only expected caller and is serial, but the cost of holding the lock for
  // a status flip is a few milliseconds and it removes the question.
  await withStoreLock(
    root,
    async () => {
      const phases = await loadPhases(root)
      phases[phase].status = status
      await savePhases(root, phases, sourcePath)
    },
    { cmd: 'phase', ...(forceUnlock ? { force: true } : {}) },
  )
}
