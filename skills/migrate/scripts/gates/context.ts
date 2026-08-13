import type { Config } from '../config.ts'
import type { LoadedHandoff } from '../handoff.ts'
import type { StorePaths } from '../paths.ts'
import type { Phase, PhaseState } from '../phases.ts'
import type {
  Capability,
  Census,
  Delta,
  Element,
  QueueItem,
  Requirement,
  Violation,
} from '../types.ts'

// One census.jsonl row, validated, in file order. A failed row keeps its raw
// value and 1-based line: the line is the only label a hand-edited row has,
// and the raw value still names the surface or closer the row claims to
// cover, which gate 2 registers so it does not also report that surface as
// having no census record at all.
//
// Kept as one ordered list rather than split into valid and invalid halves,
// because gate 2 reports both kinds and its message order follows the file.
// Splitting them would group every shape error ahead of every arithmetic
// error, which reorders the output for any store holding both.
export type CensusRow =
  | { ok: true; line: number; record: Census }
  | { ok: false; line: number; raw: unknown; errors: string[] }

export function validCensus(rows: CensusRow[]): Census[] {
  const out: Census[] = []
  for (const row of rows) {
    if (row.ok) out.push(row.record)
  }
  return out
}

// Everything the gates read, loaded once by runCheck and handed to each gate
// unchanged. A gate is a pure function of this record: it may not read the
// filesystem for store content, so the store is parsed exactly once per run
// no matter how many gates consult it.
//
// `censusRows` is the one field this record does work for rather than merely
// carrying. validateCensus runs once, in runCheck, because two gates need the
// result and neither should re-derive it: gate 2 reports the shape failures
// and does the balance arithmetic, and gate 10 cross-checks the valid records'
// batch fields against phases.json. Before the split those two shared a local
// variable inside one function; this is what replaces that sharing without
// making one gate depend on another having run first.
export type GateContext = {
  root: string
  cfg: Config
  paths: StorePaths
  elements: Element[]
  requirements: Requirement[]
  capabilities: Capability[]
  deltas: Delta[]
  censusRows: CensusRow[]
  // Loaded lazily, immediately before the handoff gate runs, because it is the
  // only gate that reads it and a corrupt file must not break the others.
  // `undefined` means "not loaded yet"; every other state is a LoadedHandoff.
  handoff: LoadedHandoff | undefined
  queueItems: QueueItem[]
  queueErrors: string[]
  phases: Record<Phase, PhaseState>
  // The index in PHASES of the last phase this invocation gates. Only the
  // run-state gate reads it today; every other gate reads the whole store
  // regardless, because a coverage or census gap is a real failure whenever it
  // is found rather than only once the run claims to have reached that phase.
  // An index rather than a name, because both consumers compare positions.
  terminusIndex: number
  citations: boolean
  leaks: boolean
  gitBin: string
}

export type Gate = (ctx: GateContext) => Violation[] | Promise<Violation[]>
