import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { assertNotUnderSource, storePaths } from './paths.ts'

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
  const parsed = JSON.parse(await readFile(path, 'utf8')) as PhasesFile
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

export async function savePhases(
  root: string,
  phases: Record<Phase, PhaseState>,
  sourcePath: string,
): Promise<void> {
  const path = storePaths(root).phases
  assertNotUnderSource(path, sourcePath)
  const file: PhasesFile = { version: 1, phases }
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`)
  await rename(tmp, path)
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
): Promise<void> {
  const phases = await loadPhases(root)
  phases[phase].status = status
  await savePhases(root, phases, sourcePath)
}
