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

export type Census =
  | {
      kind: 'lens'
      surface: string
      phase: string
      directions: Record<string, number>
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
      directions: Record<string, number>
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
