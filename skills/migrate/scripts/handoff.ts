import { existsSync } from 'node:fs'
import type { Config } from './config.ts'
import { storePaths } from './paths.ts'
import { readJsonFile, writeAtomically } from './store.ts'
import type { ApplyResult, Capability, Delta, Requirement, Throughput, WorkItem } from './types.ts'
import { isRecord } from './validate.ts'

export type HandoffInput = {
  requirements: Requirement[]
  capabilities: Capability[]
  deltas: Delta[]
  config: Config
  // What an adapter needs to reach the world. The two binary paths are the
  // same injection seams the rest of the CLI uses, and without them the github
  // adapter cannot be tested against a fake `gh` and the flow adapter cannot
  // run the target's own checker.
  root: string
  gitBin: string
  ghBin: string
}

export type Adapter = {
  name: string
  plan(input: HandoffInput): Promise<WorkItem[]>
  apply(items: WorkItem[], input: HandoffInput): Promise<ApplyResult>
  // Optional in the contract, but only one adapter is expected to decline: an
  // adapter whose medium has no completion signal at all. `coverage` names an
  // adapter that declines rather than reporting zero built, because those are
  // very different claims.
  throughput?(input: HandoffInput): Promise<Throughput>
}

// The body is prose, and it is regenerated on every plan(), so storing it
// would make handoff.json churn on wording changes that emitted nothing new.
// Everything gate 12 checks lives in the fields that remain.
export type StoredItem = Omit<WorkItem, 'body'>

export type HandoffFile = {
  version: 1
  adapter: string
  items: StoredItem[]
  refs: Record<string, string>
  // The forecast basis. `confirmed` is coverage's denominator, `emitted` is
  // every requirement that reached a work item, and the two differ by exactly
  // the non-confirmed requirements that handoff still emits but parity does
  // not hold the build to.
  basis: { confirmed: number; emitted: number; order: string[] }
}

// Capability A depends on capability B when a requirement in A carries a
// ledger citation to an element the partition assigns to B. Directional, which
// is what plain citation overlap is not: overlap alone gives clusters, and a
// build team needs an order.
function dependencyEdges(caps: Capability[], reqs: Requirement[]): Map<string, Set<string>> {
  const owner = new Map<string, string>()
  for (const c of caps) {
    for (const el of c.elements) owner.set(el, c.slug)
  }
  const deps = new Map<string, Set<string>>()
  for (const c of caps) deps.set(c.slug, new Set())
  for (const r of reqs) {
    const from = deps.get(r.cap)
    // A requirement naming a capability the partition does not have is a real
    // defect, and the refs gate names it. Skipped rather than reported again
    // here, because a dependency sort is not where that failure belongs.
    if (!from) continue
    for (const cite of r.citations) {
      if (cite.kind !== 'ledger') continue
      const to = owner.get(cite.id)
      // A capability citing an element it owns itself is the normal case, not
      // a self-dependency; an unowned element is one the refs gate names.
      if (!to || to === r.cap) continue
      from.add(to)
    }
  }
  return deps
}

// Whether `from` can reach `to` following dependency edges within `scope`.
// Used to tell a genuine cycle member (it reaches itself) from a capability
// that is merely blocked by one.
function reaches(
  from: string,
  to: string,
  deps: Map<string, Set<string>>,
  scope: Set<string>,
): boolean {
  const seen = new Set<string>()
  const stack = [...(deps.get(from) ?? [])].filter((d) => scope.has(d))
  while (stack.length > 0) {
    const next = stack.pop() as string
    if (next === to) return true
    if (seen.has(next)) continue
    seen.add(next)
    for (const d of deps.get(next) ?? []) {
      if (scope.has(d)) stack.push(d)
    }
  }
  return false
}

// Kahn's algorithm over slug-sorted candidates. When a pass emits nothing,
// every remaining capability is in a cycle: they are emitted in slug order and
// returned in `cycle` so the caller can report it. Deterministic in both
// branches, and independent of the order rows happen to sit in the store.
export function dependencyOrder(
  caps: Capability[],
  reqs: Requirement[],
): { ordered: Capability[]; cycle: string[] } {
  const deps = dependencyEdges(caps, reqs)
  const bySlug = new Map(caps.map((c) => [c.slug, c]))
  const ordered: Capability[] = []
  const remaining = new Set(caps.map((c) => c.slug))
  const cycle: string[] = []

  while (remaining.size > 0) {
    let progress = false
    for (const slug of [...remaining].sort()) {
      const blocked = [...(deps.get(slug) ?? [])].some((dep) => remaining.has(dep))
      if (blocked) continue
      const capability = bySlug.get(slug)
      if (!capability) {
        remaining.delete(slug)
        continue
      }
      ordered.push(capability)
      remaining.delete(slug)
      progress = true
    }
    if (progress) continue
    // Nothing could be emitted, so at least one cycle blocks the rest. Only the
    // members of a cycle are broken out, and only one pass' worth, after which
    // the loop resumes: dumping everything remaining reported capabilities that
    // were merely downstream of a cycle as cycle members, and threw away a
    // perfectly satisfiable order for them. A capability that depends on a
    // cycle should still be emitted after it, not alongside it.
    const stuck = [...remaining].sort()
    const inCycle = stuck.filter((slug) => reaches(slug, slug, deps, remaining))
    const release = inCycle.length > 0 ? inCycle : stuck
    for (const slug of release) {
      const capability = bySlug.get(slug)
      if (capability) {
        ordered.push(capability)
        cycle.push(slug)
      }
      remaining.delete(slug)
    }
  }
  return { ordered, cycle }
}

function renderBody(capability: Capability, reqs: Requirement[]): string {
  const lines = [`${capability.title}`, '']
  if (reqs.length === 0) {
    lines.push('No requirements were extracted for this capability.')
  } else {
    for (const r of reqs) lines.push(`- ${r.id}: ${r.requirement}`)
  }
  return lines.join('\n')
}

// One work item per capability, in dependency order. `weight` is the plain
// requirement count; the territory multipliers that turn counts into effort
// live in the owner-attested assumptions file, not in the emitted basis,
// because a weighting the tool invents is the kind of number this method
// refuses to assert.
export function buildWorkItems(caps: Capability[], reqs: Requirement[]): WorkItem[] {
  const { ordered } = dependencyOrder(caps, reqs)
  const deps = dependencyEdges(caps, reqs)
  const known = new Set(caps.map((c) => c.slug))
  return ordered.map((capability) => {
    const own = reqs.filter((r) => r.cap === capability.slug)
    return {
      key: capability.slug,
      title: capability.title,
      body: renderBody(capability, own),
      frs: own.map((r) => r.id),
      dependsOn: [...(deps.get(capability.slug) ?? [])].filter((d) => known.has(d)).sort(),
      weight: own.length,
    }
  })
}

// A requirement is blocked when a decision it is waiting on has not been made
// yet. Two independent paths reach that state, and both are relative to an
// item that is still OPEN:
//
//   - a `queued` confidence, meaning the extract phase could not settle what
//     the requirement is, and
//   - a sub-high `rubric` parity, meaning the parity phase could not settle
//     how it will be proven.
//
// Relative to open items specifically, which is the whole subtlety. A queued
// confidence pointing at an item that has since been adjudicated is settled:
// the owner ruled, and the requirement must stop blocking handoff even though
// its confidence field still reads `queued`. Treating every queued confidence
// as a blocker would refuse handoff forever unless each one were re-imported
// with a new confidence first, which is work the ruling did not ask for.
//
// One requirement can be blocked from both directions at once and is reported
// once per path, because they are two different decisions to go and make.
export function blockedRequirements(
  reqs: Requirement[],
  openQueueIds: Set<string>,
): { fr: string; queue: string }[] {
  const blocked: { fr: string; queue: string }[] = []
  for (const r of reqs) {
    if (r.confidence.kind === 'queued' && openQueueIds.has(r.confidence.queue)) {
      blocked.push({ fr: r.id, queue: r.confidence.queue })
    }
    if (r.parity?.kind === 'rubric' && r.parity.level !== 'high') {
      if (openQueueIds.has(r.parity.queue)) blocked.push({ fr: r.id, queue: r.parity.queue })
    }
  }
  return blocked
}

// handoff.json was the only store file in this codebase read through an
// unchecked cast, and this milestone gave it three consumers (the gate,
// coverage, forecast). `readRows` carries the same warning and every census row
// goes through `validateCensus` for exactly this reason: nothing stops a hand
// edit, a merge-conflict resolution, or a half-written file. Without this, `{}`
// or a truncated write reached `handoff.items.map` and crashed `migrate check`
// with an internal TypeError at exit 2, which claims the request was malformed
// when in fact a well-formed request found a bad store file.
export function validateHandoff(
  raw: unknown,
): { ok: true; value: HandoffFile } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['is not a JSON object'] }
  const rec: Record<string, unknown> = raw
  if (typeof rec.adapter !== 'string' || (rec.adapter as string).length === 0) {
    errors.push('adapter must be a non-empty string')
  }
  if (!Array.isArray(rec.items)) errors.push('items must be an array')
  else {
    ;(rec.items as unknown[]).forEach((item: unknown, i: number) => {
      if (!isRecord(item)) {
        errors.push(`items[${i}] is not an object`)
        return
      }
      if (typeof item.key !== 'string' || item.key.length === 0) {
        errors.push(`items[${i}].key must be a non-empty string`)
      }
      if (typeof item.title !== 'string') errors.push(`items[${i}].title must be a string`)
      if (!Array.isArray(item.frs) || (item.frs as unknown[]).some((f) => typeof f !== 'string')) {
        errors.push(`items[${i}].frs must be an array of strings`)
      }
      if (
        !Array.isArray(item.dependsOn) ||
        (item.dependsOn as unknown[]).some((d) => typeof d !== 'string')
      ) {
        errors.push(`items[${i}].dependsOn must be an array of strings`)
      }
      if (typeof item.weight !== 'number' || !Number.isFinite(item.weight)) {
        errors.push(`items[${i}].weight must be a number`)
      }
    })
  }
  if (!isRecord(rec.refs)) errors.push('refs must be an object')
  else if (Object.values(rec.refs as Record<string, unknown>).some((v) => typeof v !== 'string')) {
    errors.push('every refs value must be a string')
  }
  if (!isRecord(rec.basis)) errors.push('basis must be an object')
  else {
    for (const k of ['confirmed', 'emitted']) {
      const v = (rec.basis as Record<string, unknown>)[k]
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`basis.${k} must be a number`)
      }
    }
    const order = (rec.basis as Record<string, unknown>).order
    if (!Array.isArray(order) || order.some((o) => typeof o !== 'string')) {
      errors.push('basis.order must be an array of strings')
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: rec as unknown as HandoffFile }
}

export type LoadedHandoff =
  | { kind: 'absent' }
  | { kind: 'ok'; value: HandoffFile }
  | { kind: 'invalid'; errors: string[] }

// Never throws. A file that cannot be read, parsed or validated comes back as
// `invalid` with the reason, so a caller can report it as a violation instead
// of dying on it.
export async function loadHandoff(root: string): Promise<LoadedHandoff> {
  const path = storePaths(root).handoff
  if (!existsSync(path)) return { kind: 'absent' }
  let raw: unknown
  try {
    raw = await readJsonFile(path)
  } catch (e) {
    return { kind: 'invalid', errors: [(e as Error).message] }
  }
  const result = validateHandoff(raw)
  return result.ok
    ? { kind: 'ok', value: result.value }
    : { kind: 'invalid', errors: result.errors }
}

// Written with sorted `refs` keys and a fixed field order, so two apply() runs
// over one store produce identical bytes. There are deliberately no timestamps
// anywhere in this file: every date this tool reports is read at read time,
// from the adapter's medium, which is also what keeps the file testable
// against a golden.
export async function saveHandoff(
  root: string,
  file: HandoffFile,
  sourcePath: string,
): Promise<void> {
  const refs: Record<string, string> = {}
  for (const key of Object.keys(file.refs).sort()) {
    refs[key] = file.refs[key] ?? ''
  }
  const stable: HandoffFile = {
    version: 1,
    adapter: file.adapter,
    items: file.items,
    refs,
    basis: file.basis,
  }
  await writeAtomically(
    storePaths(root).handoff,
    `${JSON.stringify(stable, null, 2)}\n`,
    sourcePath,
  )
}
