export type Lens = 'code' | 'nav' | 'docs' | 'runtime'

export type Ref =
  | { kind: 'src'; path: string; lines?: [number, number] }
  | { kind: 'ledger'; id: string }
  | { kind: 'doc'; path: string; note?: string }
  | { kind: 'observed'; host: string; path: string; behavior: string }

export type Disposition =
  | { kind: 'unaccounted' }
  | { kind: 'mapped'; fr: string }
  | { kind: 'out-of-scope'; queue: string }

export type Element = {
  id: string
  surface: string
  element: string
  found_by: Lens[]
  disposition: Disposition
  refs: Ref[]
  lens: Lens
  batch: string
  notes: string
}

export type Confidence =
  | { kind: 'confirmed' }
  | { kind: 'inferred' }
  | { kind: 'queued'; queue: string }

export type Parity =
  | { kind: 'golden-master'; ref: string }
  | { kind: 'differential'; ref: string }
  | { kind: 'rubric'; level: 'high' }
  | { kind: 'rubric'; level: 'moderate' | 'low' | 'unknown'; queue: string }

export type Requirement = {
  id: string
  cap: string
  requirement: string
  actors: string
  objects: string
  rules: string
  origin: 'intended' | 'accidental-candidate'
  confidence: Confidence
  citations: Ref[]
  parity: Parity | null
  batch: string
}

export type Capability = {
  slug: string
  title: string
  ns: string
  elements: string[]
}

export type Delta = {
  id: string
  scope: string
  rationale: string
  parity_exclusion: string
  validation: string
  owner_signed: string | null
  batch: string
}

export type Skipped = { element: string; reason: string }

// A direction records both how many findings it produced and how that count
// was produced. The evidence is free text because some directions are
// judgment walks rather than commands, so the gate is presence, not
// executability; the field exists so a reviewer can retrace a count, and so a
// later re-run verb has somewhere to read the command from.
export type Direction = { count: number; evidence: string }

export type Census =
  | {
      kind: 'lens'
      surface: string
      phase: string
      directions: Record<string, Direction>
      total: number
      in_ledger: number
      added: number
      skipped: Skipped[]
      queued: string[]
      batch: string
    }
  | {
      kind: 'attribute'
      surface: string
      subject: string
      phase: string
      directions: Record<string, Direction>
      total: number
      behavioral: number
      explained: number
      queued: string[]
      batch: string
    }
  | {
      kind: 'rule-sweep'
      subject: string
      phase: string
      probes: number
      found: number
      as_requirements: number
      queued: string[]
      batch: string
    }
  | {
      kind: 'closer'
      closer: string
      phase: string
      checked: number
      findings: number
      fixed: number
      queued: string[]
      batch: string
    }

export type Severity = 'critical' | 'moderate' | 'minor'

export type QueueItem = {
  id: string
  severity: Severity
  status: 'open' | 'adjudicated'
  ruling?: string
  adjudicated?: string
  evidence: string
  options: string
  recommendation: string
  path: string
}

export type Violation = { gate: string; message: string }

// A unit of dependency-ordered work handed to a delivery medium. One work item
// is one capability, uniformly across every adapter, because `dependsOn` is
// only meaningful at that granularity: the store holds no per-requirement
// edges of any kind. An adapter is free to expand one item into several
// artifacts, and the github adapter deliberately does, into a milestone plus
// an issue per requirement.
export type WorkItem = {
  // Stable across runs, so apply() is idempotent. The capability slug.
  key: string
  title: string
  body: string
  frs: string[]
  dependsOn: string[]
  weight: number
}

// What apply() did, keyed by work-item key. `refs` maps a key to whatever
// external identity the adapter minted (an issue number, a file path), and it
// is what makes a second apply() an update rather than a duplicate.
export type ApplyResult = {
  created: string[]
  updated: string[]
  unchanged: string[]
  refs: Record<string, string>
}

// `doneAt` is nullable because not every medium dates a completion. The github
// adapter reads closedAt and always has one; the flow adapter reads coverage
// from the target's own parity command, which reports which requirements are
// covered and not when. Coverage counts an undated completion as built and
// says how many were undated; forecast excludes them from its rate.
export type Completion = { fr: string; doneAt: string | null }

// The completions plus a sentence naming where they came from. The basis
// travels with the data rather than being reconstructed by the caller, so a
// figure derived from it can always print its own provenance.
export type Throughput = { completions: Completion[]; basis: string }

// A measured or attested number that may not exist. A null value propagates
// through every figure derived from it, and those figures print as omitted
// rather than as a guess.
export type Rate = { value: number | null; basis: string }
