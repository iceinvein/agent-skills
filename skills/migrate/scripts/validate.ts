import type { Config } from './config.ts'
import { validateElementId } from './ids.ts'
import type {
  Confidence,
  Delta,
  Disposition,
  Element,
  Lens,
  Parity,
  Ref,
  Requirement,
} from './types.ts'

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] }

const LENSES: Lens[] = ['code', 'nav', 'docs', 'runtime']

function str(v: unknown): v is string {
  return typeof v === 'string'
}

// A row must be a JSON object. null, arrays and primitives all fail this, and
// must be rejected here rather than left to crash on the first property read:
// `null.id` throws, but a normal validation error is what every validator in
// this file (and census.ts) expects to return instead.
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkRef(ref: unknown, where: string, errors: string[]): void {
  const r = ref as Record<string, unknown>
  const kind = r?.kind
  if (kind === 'src') {
    if (!str(r.path)) errors.push(`${where}: src ref needs a path`)
    if (r.lines !== undefined) {
      const lines = r.lines as unknown[]
      const ok =
        Array.isArray(lines) &&
        lines.length === 2 &&
        typeof lines[0] === 'number' &&
        typeof lines[1] === 'number' &&
        (lines[0] as number) <= (lines[1] as number)
      if (!ok) errors.push(`${where}: src ref lines must be [start, end] with start <= end`)
    }
  } else if (kind === 'ledger') {
    if (!str(r.id)) errors.push(`${where}: ledger ref needs an id`)
  } else if (kind === 'doc') {
    if (!str(r.path)) errors.push(`${where}: doc ref needs a path`)
  } else if (kind === 'observed') {
    if (!str(r.host) || !str(r.path) || !str(r.behavior)) {
      errors.push(`${where}: observed ref needs host, path and behavior`)
    }
  } else {
    errors.push(`${where}: unknown ref kind ${String(kind)}`)
  }
}

export function validateElement(row: unknown, cfg: Config): Validated<Element> {
  if (!isRecord(row)) return { ok: false, errors: ['element: row must be a JSON object'] }
  const errors: string[] = []
  const r = row
  const id = str(r.id) ? r.id : ''
  const surface = str(r.surface) ? r.surface : ''
  const where = `element ${id || '<no id>'}`

  if (!id) errors.push('element: missing id')
  if (!surface) errors.push(`${where}: missing surface`)
  else if (!cfg.surfaces.includes(surface)) {
    errors.push(
      `${where}: surface ${surface} is not in the declared set [${cfg.surfaces.join(', ')}]`,
    )
  } else if (id) {
    const idError = validateElementId(id, surface, cfg.surfaceSingular)
    if (idError) errors.push(`${where}: ${idError}`)
  }
  if (!str(r.element) || r.element.length === 0) errors.push(`${where}: missing element text`)

  const foundBy = r.found_by as unknown[]
  if (!Array.isArray(foundBy) || foundBy.length === 0) {
    errors.push(`${where}: found_by must list at least one lens`)
  } else {
    for (const l of foundBy) {
      if (!LENSES.includes(l as Lens))
        errors.push(`${where}: unknown lens ${String(l)} in found_by`)
    }
  }
  if (!LENSES.includes(r.lens as Lens)) errors.push(`${where}: unknown lens ${String(r.lens)}`)

  const d = r.disposition as Record<string, unknown> | undefined
  const dk = d?.kind
  if (dk === 'unaccounted') {
    // nothing further
  } else if (dk === 'mapped') {
    if (!str(d?.fr)) errors.push(`${where}: mapped disposition needs an fr id`)
  } else if (dk === 'out-of-scope') {
    if (!str(d?.queue)) errors.push(`${where}: out-of-scope disposition needs a queue id`)
  } else {
    errors.push(`${where}: unknown disposition kind ${String(dk)}`)
  }

  const refs = (r.refs ?? []) as unknown[]
  if (!Array.isArray(refs)) errors.push(`${where}: refs must be an array`)
  else
    refs.forEach((ref, i) => {
      checkRef(ref, `${where} refs[${i}]`, errors)
    })

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      id,
      surface,
      element: r.element as string,
      found_by: foundBy as Lens[],
      disposition: r.disposition as Disposition,
      refs: refs as Ref[],
      lens: r.lens as Lens,
      batch: '',
      notes: str(r.notes) ? r.notes : '',
    },
  }
}

export function validateRequirement(row: unknown, _cfg: Config): Validated<Requirement> {
  if (!isRecord(row)) return { ok: false, errors: ['requirement: row must be a JSON object'] }
  const errors: string[] = []
  const r = row
  const id = str(r.id) ? r.id : ''
  const where = `requirement ${id || '<no id>'}`

  if (!id) errors.push('requirement: missing id')
  if (!str(r.cap) || r.cap.length === 0) errors.push(`${where}: missing cap`)
  if (!str(r.requirement) || r.requirement.length === 0)
    errors.push(`${where}: missing requirement text`)
  if (r.origin !== 'intended' && r.origin !== 'accidental-candidate') {
    errors.push(`${where}: origin must be intended or accidental-candidate`)
  }

  const c = r.confidence as Record<string, unknown> | undefined
  if (c?.kind === 'queued') {
    if (!str(c.queue)) errors.push(`${where}: queued confidence needs a queue id`)
  } else if (c?.kind !== 'confirmed' && c?.kind !== 'inferred') {
    errors.push(`${where}: unknown confidence kind ${String(c?.kind)}`)
  }

  const citations = (r.citations ?? []) as unknown[]
  if (!Array.isArray(citations) || citations.length === 0) {
    errors.push(`${where}: at least one citation is required`)
  } else {
    citations.forEach((ref, i) => {
      checkRef(ref, `${where} citations[${i}]`, errors)
    })
  }

  const p = r.parity as Record<string, unknown> | null | undefined
  if (p !== null && p !== undefined) {
    if (p.kind === 'golden-master' || p.kind === 'differential') {
      if (!str(p.ref)) errors.push(`${where}: ${String(p.kind)} parity needs a ref`)
    } else if (p.kind === 'rubric') {
      const level = p.level
      if (level === 'high') {
        // no queue id needed
      } else if (level === 'moderate' || level === 'low' || level === 'unknown') {
        if (!str(p.queue)) errors.push(`${where}: rubric:${level} parity needs a queue id`)
      } else {
        errors.push(`${where}: unknown rubric level ${String(level)}`)
      }
    } else {
      errors.push(`${where}: unknown parity kind ${String(p.kind)}`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      id,
      cap: r.cap as string,
      requirement: r.requirement as string,
      actors: str(r.actors) ? r.actors : '-',
      objects: str(r.objects) ? r.objects : '-',
      rules: str(r.rules) ? r.rules : '-',
      origin: r.origin as Requirement['origin'],
      confidence: r.confidence as Confidence,
      citations: citations as Ref[],
      parity: (r.parity ?? null) as Parity | null,
      batch: '',
    },
  }
}

export function validateDelta(row: unknown, _cfg: Config): Validated<Delta> {
  if (!isRecord(row)) return { ok: false, errors: ['delta: row must be a JSON object'] }
  const errors: string[] = []
  const r = row
  const id = str(r.id) ? r.id : ''
  const where = `delta ${id || '<no id>'}`
  if (!id.startsWith('delta-')) errors.push(`${where}: id must start with delta-`)
  for (const key of ['scope', 'rationale', 'parity_exclusion', 'validation']) {
    const v = r[key]
    if (!str(v) || v.length === 0) errors.push(`${where}: missing ${key}`)
  }
  const signed = r.owner_signed
  if (signed !== null && signed !== undefined && !str(signed)) {
    errors.push(`${where}: owner_signed must be a date string or null`)
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      id,
      scope: r.scope as string,
      rationale: r.rationale as string,
      parity_exclusion: r.parity_exclusion as string,
      validation: r.validation as string,
      owner_signed: (signed ?? null) as string | null,
      batch: '',
    },
  }
}
