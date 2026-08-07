import { isValidSlug } from './ids.ts'
import type { Census, Direction, Skipped } from './types.ts'
import type { Validated } from './validate.ts'
import { isRecord } from './validate.ts'

const QUEUE_PREFIX = 'q-'

// A queue id is q- followed by a lowercase kebab-case slug (ids.ts's own
// shape, reused rather than a second regex). This is deliberately a format
// constraint, not a blocklist of specific cosmetic defects: an uppercase
// letter, a stray space, or trailing punctuation are all rejected because
// none of them produces a well-formed slug, not because each was chased
// down individually.
function isValidQueueId(s: string): boolean {
  return s.startsWith(QUEUE_PREFIX) && isValidSlug(s.slice(QUEUE_PREFIX.length))
}

// Trim and case-fold, and stop there: this is the comparison form used for
// duplicate and cross-list checks, never the stored form. Element names are
// free text naming real things in a legacy source, so nothing past
// whitespace and case is safe to normalize away; 'orders.' and 'orders' can
// legitimately be two different elements, and collapsing punctuation or
// internal whitespace would start rejecting valid input.
function normalizeForComparison(s: string): string {
  return s.trim().toLowerCase()
}

export function censusKey(record: Census): string {
  if (record.kind === 'lens') return `lens:${record.surface}`
  if (record.kind === 'attribute') return `attribute:${record.subject}`
  if (record.kind === 'rule-sweep') return `rule-sweep:${record.subject}`
  return `closer:${record.closer}`
}

export function balanceOf(record: Census): string | null {
  if (record.kind === 'lens') {
    const sum = record.in_ledger + record.added + record.skipped.length + record.queued.length
    if (sum !== record.total) {
      return `lens census for ${record.surface} does not balance: total ${record.total} but in_ledger ${record.in_ledger} + added ${record.added} + skipped ${record.skipped.length} + queued ${record.queued.length} = ${sum}`
    }
    return null
  }
  if (record.kind === 'attribute') {
    const sum = record.explained + record.queued.length
    if (sum !== record.behavioral) {
      return `attribute census for ${record.subject} does not balance: behavioral ${record.behavioral} but explained ${record.explained} + queued ${record.queued.length} = ${sum}`
    }
    return null
  }
  if (record.kind === 'rule-sweep') {
    const sum = record.as_requirements + record.queued.length
    if (sum !== record.found) {
      return `rule-sweep census for ${record.subject} does not balance: found ${record.found} but as_requirements ${record.as_requirements} + queued ${record.queued.length} = ${sum}`
    }
    return null
  }
  const sum = record.fixed + record.queued.length
  if (sum !== record.findings) {
    return `closer census for ${record.closer} does not balance: findings ${record.findings} but fixed ${record.fixed} + queued ${record.queued.length} = ${sum}`
  }
  return null
}

// total is the deduped union of what the directions found. It cannot be
// smaller than the largest single direction (dedup removes duplicates, never
// originals), and it cannot exceed their concatenation (dedup can only
// shrink). Neither bound needs the source, and together they close the two
// ways a total can be padded arithmetically. total remains unverifiable in
// principle: nothing on this side of the source can know how many tables the
// legacy system really has.
export function boundsOf(record: Census): string | null {
  if (record.kind !== 'lens' && record.kind !== 'attribute') return null
  const counts = Object.values(record.directions).map((d) => d.count)
  if (counts.length === 0) return null
  const label =
    record.kind === 'lens'
      ? `lens census for ${record.surface}`
      : `attribute census for ${record.subject}`
  const max = Math.max(...counts)
  const sum = counts.reduce((a, b) => a + b, 0)
  if (record.total < max) {
    return `${label}: total ${record.total} is below the largest direction count ${max}; a deduped union cannot be smaller than one of its inputs`
  }
  if (record.total > sum) {
    return `${label}: total ${record.total} exceeds the ${sum} findings its directions reported; a deduped union cannot exceed their concatenation`
  }
  return null
}

export function validateCensus(row: unknown): Validated<Census> {
  // A row must be a JSON object with a recognized kind before any field is
  // dereferenced. A null, a string, a number or an array must be rejected
  // cleanly here rather than throwing on the first property read. Messages
  // here carry no 'census: ' prefix of their own: the call site owns that
  // prefix, so callers never have to strip or double it.
  if (!isRecord(row)) return { ok: false, errors: ['row must be a JSON object'] }
  const errors: string[] = []
  const r = row
  const kind = r.kind
  const num = (k: string): number => {
    const v = r[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      errors.push(`${k} must be a non-negative integer`)
      return 0
    }
    return v
  }
  const text = (k: string): string => {
    const v = r[k]
    if (typeof v !== 'string' || v.length === 0) {
      errors.push(`${k} is required`)
      return ''
    }
    return v
  }
  // The lens contract requires at least two independent directions, and the
  // count each one produced is only auditable if the record also says how it
  // was produced. Both are checked here rather than left to the phase manual,
  // because a discipline the tool can enforce should not be a discipline the
  // agent maintains.
  const directionsMap = (k: string): Record<string, Direction> => {
    const v = r[k]
    if (!isRecord(v)) {
      errors.push(`${k} must be an object mapping each direction name to {count, evidence}`)
      return {}
    }
    const out: Record<string, Direction> = {}
    for (const [name, raw] of Object.entries(v)) {
      if (typeof raw === 'number') {
        errors.push(
          `${k}.${name} uses the old bare-count shape; write {"count": ${raw}, "evidence": "<the command or method that produced this count>"}`,
        )
        continue
      }
      if (!isRecord(raw)) {
        errors.push(`${k}.${name} must be an object with count and evidence`)
        continue
      }
      const count = raw.count
      const evidence = raw.evidence
      let valid = true
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        errors.push(`${k}.${name}.count must be a non-negative integer`)
        valid = false
      }
      if (typeof evidence !== 'string' || evidence.trim().length === 0) {
        errors.push(
          `${k}.${name}.evidence is required: name the command or method that produced this count`,
        )
        valid = false
      }
      if (valid) out[name] = { count: count as number, evidence: evidence as string }
    }
    if (Object.keys(v).length < 2) {
      errors.push(
        `${k} needs at least two independent directions; the lens contract does not admit a single-direction enumeration`,
      )
    }
    return out
  }
  // Every queued entry must be a well-formed queue id, not merely a
  // non-empty string: a bare id-shaped check let a duplicate survive under a
  // cosmetic disguise (different case, a trailing space, trailing
  // punctuation), each one still counted toward .length by balanceOf. The
  // format constraint closes that as a class rather than chasing variants.
  // Trimmed before validating, and an entry that only becomes valid after
  // trimming is rejected rather than silently accepted with the whitespace
  // dropped: the point is that a stray space fails cleanly, not that it gets
  // normalized away. The uniqueness check below then compares the one
  // canonical (already trim-equal) value every accepted entry has.
  const queuedList = (k: string): string[] => {
    const v = r[k] ?? []
    if (!Array.isArray(v)) {
      errors.push(`${k} must be an array`)
      return []
    }
    const out: string[] = []
    v.forEach((item, i) => {
      const trimmed = typeof item === 'string' ? item.trim() : ''
      if (typeof item !== 'string' || trimmed !== item || !isValidQueueId(trimmed)) {
        errors.push(`${k}[${i}] must be a valid queue id: q- followed by a lowercase slug`)
        return
      }
      out.push(trimmed)
    })
    const seen = new Map<string, number>()
    for (const id of out) seen.set(id, (seen.get(id) ?? 0) + 1)
    for (const [id, count] of seen) {
      if (count > 1) errors.push(`${k} id ${id} appears ${count} times`)
    }
    return out
  }
  // Every skipped entry must be an object naming a non-empty element and a
  // non-empty reason. A repeated element is the same padding risk as a
  // repeated queued id, and is rejected on the element alone (not full
  // struct equality) so varying the reason text cannot evade the check.
  const skippedList = (k: string): Skipped[] => {
    const v = r[k] ?? []
    if (!Array.isArray(v)) {
      errors.push(`${k} must be an array`)
      return []
    }
    const out: Skipped[] = []
    v.forEach((item, i) => {
      const element = isRecord(item) ? item.element : undefined
      const reason = isRecord(item) ? item.reason : undefined
      const valid =
        typeof element === 'string' &&
        element.length > 0 &&
        typeof reason === 'string' &&
        reason.length > 0
      if (!valid) {
        errors.push(`${k}[${i}] must be an object with a non-empty element and reason`)
        return
      }
      out.push({ element, reason })
    })
    // Uniqueness is enforced on trimmed, case-folded element names, not the
    // raw text: 'orders' and ' ORDERS' name the same entry and must not pad
    // .length as if they were two. The stored value is always the author's
    // original text (evidence should survive verbatim); only the comparison
    // is normalized. This is a documented limit, not a guarantee: unlike
    // queued ids, element names are free text with no format to constrain,
    // so two genuinely distinct strings a person would recognize as the same
    // real thing ('orders' and 'order', or two different names for one
    // table) are not detectable this way, and no check can make free text
    // padding-proof in general.
    const seen = new Map<string, string[]>()
    for (const s of out) {
      const key = normalizeForComparison(s.element)
      const variants = seen.get(key) ?? []
      variants.push(s.element)
      seen.set(key, variants)
    }
    for (const [key, variants] of seen) {
      if (variants.length > 1) {
        errors.push(`${k} element ${key} appears ${variants.length} times (${variants.join(', ')})`)
      }
    }
    return out
  }

  if (kind === 'lens') {
    text('surface')
    text('phase')
    text('batch')
    num('total')
    num('in_ledger')
    num('added')
    directionsMap('directions')
    const skipped = skippedList('skipped')
    const queued = queuedList('queued')
    // queued ids and skipped element names are different namespaces (a
    // queue id must be q-<slug>; an element name is unconstrained free text
    // drawn from the legacy system), so nothing stops a skipped element from
    // coincidentally, or deliberately, matching a queued id's exact text.
    // Checked explicitly: see the report for why this earns its keep rather
    // than being left to the format constraint alone. Compared on the same
    // normalized (trimmed, case-folded) form used for the skipped-side
    // duplicate check above, so a case or whitespace variant on the skipped
    // side cannot dodge this the way raw comparison let it.
    const queuedSet = new Set(queued.map(normalizeForComparison))
    for (const s of skipped) {
      if (queuedSet.has(normalizeForComparison(s.element))) {
        errors.push(`${s.element} appears in both skipped and queued`)
      }
    }
  } else if (kind === 'attribute') {
    text('surface')
    text('subject')
    text('phase')
    text('batch')
    num('total')
    num('behavioral')
    num('explained')
    directionsMap('directions')
    queuedList('queued')
  } else if (kind === 'rule-sweep') {
    text('subject')
    text('phase')
    text('batch')
    num('probes')
    num('found')
    num('as_requirements')
    queuedList('queued')
  } else if (kind === 'closer') {
    text('closer')
    text('phase')
    text('batch')
    num('checked')
    num('findings')
    num('fixed')
    queuedList('queued')
  } else {
    errors.push(`unknown kind ${String(kind)}`)
  }

  if (errors.length > 0) return { ok: false, errors }
  const record = row as Census
  return { ok: true, value: record }
}
