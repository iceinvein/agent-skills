#!/usr/bin/env bun
// Turns functional-requirement tables plus a slice/package plan into work
// packages and a lane schedule, so every figure in the estimate comes from
// the same arithmetic and re-runs when a requirement or a rate changes.
//
// Usage: bun schedule.ts <requirements-dir> <plan.json> [--json <out.json>]

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Size = 'S' | 'M' | 'L'
export type RateName = 'fast' | 'plan' | 'floor'
type Days = Record<RateName, number>

export type Requirement = {
  id: string
  file: string
  capability: string
  disposition: string
  size: Size
  layers: string[]
  depends: string[]
  decision: boolean
}

export type Slice = {
  id: string
  name: string
  goal: string
  phase: number
  capabilities: string[]
  gated?: boolean
}

export type PackageSpec = {
  id: string
  slice: string
  name: string
  // Requirement ids or whole capability ids.
  members: string[]
  // Packages that must merge first. On a product this is a real wait, unlike an integration link.
  after?: string[]
  // For work the sources have no requirement for yet; reported as an assumption.
  assumedDays?: Days
}

export type Plan = {
  daysPerWeek: number
  rates: Record<RateName, Record<Size, number>>
  team: { engineers: number[]; worktrees: number[]; headline: { engineers: number; worktrees: number } }
  slices: Slice[]
  foundations: PackageSpec[]
  // Optional: products default to one package per capability; list them here to split one or add waits.
  products?: PackageSpec[]
  dependsOn: { foundation: string[]; product: string[]; layers: Record<string, string[]> }
  aliases: Record<string, string[]>
}

export type Package = {
  id: string
  slice: string
  name: string
  kind: 'foundation' | 'product'
  gated: boolean
  assumed: boolean
  requirements: string[]
  sizes: Record<Size, number>
  decisions: number
  days: Days
  deps: string[]
  integrationLinks: string[]
}

type Placed = { id: string; engineer: number; worktree: number; startWeek: number; endWeek: number }

type SliceTotals = { id: string; frs: number; sizes: Record<Size, number>; decisions: number; planDays: number; gated: boolean }

export type Report = {
  requirements: { total: number; scheduled: number; sizes: Record<Size, number>; decisions: number }
  slices: SliceTotals[]
  gated: { requirements: number; planDays: number }
  totals: { planDays: number; medianPlanDays: number; largestPlanDays: number; integrationLinks: number }
  packages: Package[]
  unresolved: Record<string, number>
  criticalChain: { ids: string[]; weeks: number }
  schedules: { engineers: number; worktrees: number; rate: RateName; weeks: number; order: Placed[] }[]
}

const RATE_NAMES: RateName[] = ['fast', 'plan', 'floor']
const HEADING = /^###\s+(\S+)(?:\s+(.*?))?\s*(?:\(([^)]*)\))?\s*$/
const REQUIREMENT_HEADER = /^\|\s*FR\s*\|/
const SEPARATOR = /^\|[\s:|-]+$/

export function parseRequirements(markdown: string, file: string): Requirement[] {
  const out: Requirement[] = []
  let capability = ''
  let disposition = ''
  let inRequirementTable = false
  markdown.split('\n').forEach((line, i) => {
    const heading = line.match(HEADING)
    if (heading) {
      capability = heading[1]
      disposition = heading[3] ?? ''
      inRequirementTable = false
      return
    }
    if (!line.startsWith('|')) {
      inRequirementTable = false
      return
    }
    if (REQUIREMENT_HEADER.test(line)) {
      inRequirementTable = Boolean(capability)
      return
    }
    if (!inRequirementTable || SEPARATOR.test(line.trim())) return
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split(' | ').map((c) => c.trim().replaceAll('\\|', '|'))
    if (cells.length !== 8) throw new Error(`${file}:${i + 1}: expected 8 cells, found ${cells.length}`)
    const [id, , , layers, size, depends, , notes] = cells
    if (size !== 'S' && size !== 'M' && size !== 'L') throw new Error(`${file}:${i + 1}: ${id} has size ${size}`)
    out.push({
      id,
      file,
      capability,
      disposition,
      size,
      layers: layers.split(',').map((l) => l.trim()).filter(Boolean),
      depends: depends === '-' || depends === '' ? [] : depends.split(/,\s*/).map((d) => d.trim()),
      decision: notes.includes('Decision:'),
    })
  })
  return out
}

function round(n: number, places = 2): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

function buildPackages(reqs: Requirement[], plan: Plan): { packages: Package[]; unresolved: Record<string, number> } {
  const problems: string[] = []
  const byId = new Map(reqs.map((r) => [r.id, r]))
  const byCapability = new Map<string, Requirement[]>()
  for (const r of reqs) byCapability.set(r.capability, [...(byCapability.get(r.capability) ?? []), r])

  const seen = new Set<string>()
  for (const r of reqs) {
    if (seen.has(r.id)) problems.push(`requirement ${r.id} appears twice`)
    seen.add(r.id)
  }

  const sliceOf = new Map<string, Slice>()
  for (const s of plan.slices) {
    for (const c of s.capabilities) {
      if (sliceOf.has(c)) problems.push(`capability ${c} is in slices ${sliceOf.get(c)?.id} and ${s.id}`)
      sliceOf.set(c, s)
      if (!byCapability.has(c)) problems.push(`slice ${s.id} names capability ${c}, which has no requirements`)
    }
  }
  for (const c of byCapability.keys()) if (!sliceOf.has(c)) problems.push(`capability ${c} belongs to no slice`)
  const sliceIds = new Set(plan.slices.map((s) => s.id))

  const owner = new Map<string, string>()
  const packages: Package[] = []
  const add = (id: string, slice: Slice | undefined, name: string, kind: Package['kind'], members: Requirement[], assumedDays?: Days) => {
    for (const r of members) {
      const prior = owner.get(r.id)
      if (prior) problems.push(`requirement ${r.id} is claimed by ${prior} and ${id}`)
      owner.set(r.id, id)
    }
    const sizes = { S: 0, M: 0, L: 0 }
    for (const r of members) sizes[r.size]++
    const days = Object.fromEntries(
      RATE_NAMES.map((k) => [k, assumedDays ? assumedDays[k] : round(members.reduce((t, r) => t + plan.rates[k][r.size], 0))]),
    ) as Days
    packages.push({
      id,
      slice: slice?.id ?? '',
      name,
      kind,
      gated: slice?.gated ?? false,
      assumed: Boolean(assumedDays),
      requirements: members.map((r) => r.id),
      sizes,
      decisions: members.filter((r) => r.decision).length,
      days,
      deps: [],
      integrationLinks: [],
    })
  }

  const listed: [PackageSpec, Package['kind']][] = [
    ...plan.foundations.map((f): [PackageSpec, Package['kind']] => [f, 'foundation']),
    ...(plan.products ?? []).map((f): [PackageSpec, Package['kind']] => [f, 'product']),
  ]
  for (const [f, kind] of listed) {
    if (!sliceIds.has(f.slice)) problems.push(`${kind} ${f.id} names unknown slice ${f.slice}`)
    const members: Requirement[] = []
    for (const m of f.members) {
      const r = byId.get(m)
      if (r) members.push(r)
      else if (byCapability.has(m)) members.push(...(byCapability.get(m) ?? []))
      else problems.push(`${kind} ${f.id} names ${m}, which is neither a requirement nor a capability`)
    }
    if (members.length === 0 && !f.assumedDays) problems.push(`${kind} ${f.id} has no requirements and no assumedDays`)
    // A package may sit in another slice, but never across the gated line, or it would be built when its work is not.
    const placedGated = plan.slices.find((s) => s.id === f.slice)?.gated ?? false
    for (const r of members) {
      const home = sliceOf.get(r.capability)
      if (home && (home.gated ?? false) !== placedGated)
        problems.push(`${f.id} is ${placedGated ? 'gated' : 'scheduled'} but claims ${r.id}, whose slice ${home.id} is ${home.gated ? 'gated' : 'scheduled'}`)
    }
    if (f.after?.includes(f.id)) problems.push(`${f.id} lists itself under after`)
    add(f.id, plan.slices.find((s) => s.id === f.slice), f.name, kind, members, f.assumedDays)
  }
  for (const [capability, members] of byCapability) {
    const left = members.filter((r) => !owner.has(r.id))
    if (left.length === 0) continue
    if (listed.some(([f]) => f.id === capability)) {
      problems.push(`${left.map((r) => r.id).join(', ')} is left unclaimed while package ${capability} claims the rest; claim it or give the split packages new ids`)
      continue
    }
    add(capability, sliceOf.get(capability), capability, 'product', left)
  }

  const pkg = new Map<string, Package>()
  for (const p of packages) {
    if (pkg.has(p.id)) problems.push(`package id ${p.id} is used twice`)
    pkg.set(p.id, p)
  }
  for (const r of reqs)
    for (const l of r.layers) if (!(l in plan.dependsOn.layers)) problems.push(`${r.id} uses layer ${l}, which dependsOn.layers does not declare`)
  const configured = [
    ...plan.dependsOn.foundation,
    ...plan.dependsOn.product,
    ...Object.values(plan.dependsOn.layers).flat(),
    ...Object.values(plan.aliases).flat(),
    ...listed.flatMap(([f]) => f.after ?? []),
  ]
  for (const id of configured) if (!pkg.has(id)) problems.push(`plan names package ${id}, which does not exist`)
  if (problems.length) throw new Error(`plan does not fit the requirements:\n- ${problems.join('\n- ')}`)

  const unresolved: Record<string, number> = {}
  const aliases = new Map(Object.entries(plan.aliases).map(([k, v]) => [k.toLowerCase(), v]))
  const resolve = (token: string): string[] => {
    const t = token.replace(/`/g, '').trim()
    const range = t.match(/^([A-Z][A-Z0-9-]*)\.(\d+) to \1\.(\d+)$/)
    if (range) {
      const ids: string[] = []
      for (let n = Number(range[2]); n <= Number(range[3]); n++) {
        const o = owner.get(`${range[1]}.${n}`)
        if (o) ids.push(o)
      }
      if (ids.length) return ids
    } else {
      const direct = owner.get(t)
      if (direct) return [direct]
      const alias = aliases.get(t.toLowerCase())
      if (alias) return alias
      const members = byCapability.get(t)
      if (members) return [...new Set(members.map((r) => owner.get(r.id) as string))]
    }
    unresolved[t] = (unresolved[t] ?? 0) + 1
    return []
  }

  // Why each edge exists, so a cycle can be traced back to the line that made it.
  const reasons = new Map<string, string>()
  for (const p of packages) {
    const deps = new Set<string>()
    const links = new Set<string>()
    const wait = (target: string, reason: string) => {
      if (target === p.id) return
      deps.add(target)
      if (!reasons.has(`${p.id}>${target}`)) reasons.set(`${p.id}>${target}`, reason)
    }
    const base = p.kind === 'foundation' ? 'foundation' : 'product'
    for (const d of plan.dependsOn[base]) wait(d, `plan dependsOn.${base}`)
    for (const a of listed.find(([f]) => f.id === p.id)?.[0].after ?? []) wait(a, `plan lists ${a} under ${p.id}.after`)
    for (const id of p.requirements) {
      const r = byId.get(id) as Requirement
      if (p.kind === 'product') for (const l of r.layers) for (const d of plan.dependsOn.layers[l] ?? []) wait(d, `${r.id} touches layer ${l}`)
      for (const token of r.depends.flatMap((d) => d.split(/;\s*|\s+and\s+/))) {
        for (const target of resolve(token)) {
          // Contracts first: products build against each other's contracts, so a
          // product-to-product reference is checked at integration, not waited on.
          if (pkg.get(target)?.kind === 'foundation') wait(target, `${r.id} depends on ${token}`)
          else if (target !== p.id) links.add(target)
        }
      }
    }
    p.deps = [...deps].sort()
    p.integrationLinks = [...links].sort()
  }

  const cycle = findCycle(packages)
  if (cycle) {
    const edges = cycle.slice(1).map((to, i) => `- ${cycle[i]} waits on ${to}: ${reasons.get(`${cycle[i]}>${to}`)}`)
    throw new Error(`dependency cycle between packages: ${cycle.join(' waits on ')}\n${edges.join('\n')}`)
  }
  // A link to gated work dangles if the client says no, so it is refused like a wait.
  const onGated = packages.flatMap((p) =>
    p.gated
      ? []
      : [
          ...p.deps.filter((d) => pkg.get(d)?.gated).map((d) => `${p.id} waits on ${d}, which is gated (${reasons.get(`${p.id}>${d}`)})`),
          ...p.integrationLinks.filter((d) => pkg.get(d)?.gated).map((d) => `${p.id} references ${d}, which is gated`),
        ],
  )
  if (onGated.length) throw new Error(`scheduled work depends on gated work:\n- ${onGated.join('\n- ')}`)
  return { packages, unresolved }
}

function findCycle(packages: Package[]): string[] | null {
  const deps = new Map(packages.map((p) => [p.id, p.deps]))
  const state = new Map<string, 'open' | 'done'>()
  const path: string[] = []
  const visit = (id: string): string[] | null => {
    state.set(id, 'open')
    path.push(id)
    for (const d of deps.get(id) ?? []) {
      if (state.get(d) === 'open') return [...path.slice(path.indexOf(d)), d]
      if (!state.has(d)) {
        const found = visit(d)
        if (found) return found
      }
    }
    path.pop()
    state.set(id, 'done')
    return null
  }
  for (const p of packages) {
    if (state.has(p.id)) continue
    const found = visit(p.id)
    if (found) return found
  }
  return null
}

// Days of work from the start of each package to the end of the longest chain behind it.
function tails(active: Package[], rate: RateName): Map<string, number> {
  const successors = new Map<string, string[]>()
  for (const p of active) for (const d of p.deps) successors.set(d, [...(successors.get(d) ?? []), p.id])
  const byId = new Map(active.map((p) => [p.id, p]))
  const memo = new Map<string, number>()
  const tail = (id: string): number => {
    const known = memo.get(id)
    if (known !== undefined) return known
    const after = (successors.get(id) ?? []).map(tail)
    const value = (byId.get(id) as Package).days[rate] + Math.max(0, ...after)
    memo.set(id, value)
    return value
  }
  for (const p of active) tail(p.id)
  return memo
}

function criticalChain(active: Package[], rate: RateName): string[] {
  const tail = tails(active, rate)
  const successors = new Map<string, string[]>()
  for (const p of active) for (const d of p.deps) successors.set(d, [...(successors.get(d) ?? []), p.id])
  const longest = (ids: string[]) => ids.reduce((a, b) => ((tail.get(b) ?? 0) > (tail.get(a) ?? 0) ? b : a))
  let id = longest(active.map((p) => p.id))
  const chain = [id]
  while (successors.get(id)?.length) {
    id = longest(successors.get(id) as string[])
    chain.push(id)
  }
  return chain
}

// List scheduling: the lane that frees first takes the package that can start
// now with the longest chain behind it. A credible order, not an optimum.
function schedule(active: Package[], engineers: number, worktrees: number, rate: RateName, daysPerWeek: number): { days: number; order: Placed[] } {
  const lanes = engineers * worktrees
  const tail = tails(active, rate)
  const free = Array<number>(lanes).fill(0)
  const done = new Map<string, number>()
  const todo = active.map((p) => p.id)
  const byId = new Map(active.map((p) => [p.id, p]))
  const order: Placed[] = []
  const availableAt = (id: string) => Math.max(0, ...(byId.get(id) as Package).deps.map((d) => done.get(d) as number))
  while (todo.length) {
    const lane = free.indexOf(Math.min(...free))
    const now = free[lane]
    const ready = todo.filter((id) => (byId.get(id) as Package).deps.every((d) => done.has(d)))
    const startable = ready.filter((id) => availableAt(id) <= now + 1e-9)
    const pick = startable.length
      ? startable.reduce((a, b) => ((tail.get(b) as number) > (tail.get(a) as number) ? b : a))
      : ready.reduce((a, b) => (availableAt(b) < availableAt(a) || (availableAt(b) === availableAt(a) && (tail.get(b) as number) > (tail.get(a) as number)) ? b : a))
    const start = Math.max(now, availableAt(pick))
    const end = start + (byId.get(pick) as Package).days[rate]
    free[lane] = end
    done.set(pick, end)
    todo.splice(todo.indexOf(pick), 1)
    order.push({ id: pick, engineer: (lane % engineers) + 1, worktree: Math.floor(lane / engineers) + 1, startWeek: round(start / daysPerWeek), endWeek: round(end / daysPerWeek) })
  }
  return { days: Math.max(0, ...done.values()), order }
}

export function estimate(reqs: Requirement[], plan: Plan): Report {
  const { engineers: he, worktrees: hw } = plan.team.headline
  if (!plan.team.engineers.includes(he) || !plan.team.worktrees.includes(hw))
    throw new Error(`team headline ${he} x ${hw} is not inside team.engineers and team.worktrees`)
  const { packages, unresolved } = buildPackages(reqs, plan)
  const active = packages.filter((p) => !p.gated)
  if (active.length === 0) throw new Error('nothing to schedule: every slice is gated')
  const scheduled = new Set(active.flatMap((p) => p.requirements))
  const sizes = { S: 0, M: 0, L: 0 }
  for (const r of reqs) sizes[r.size]++

  const schedules: Report['schedules'] = []
  for (const engineers of plan.team.engineers)
    for (const worktrees of plan.team.worktrees)
      for (const rate of RATE_NAMES) {
        const { days, order } = schedule(active, engineers, worktrees, rate, plan.daysPerWeek)
        schedules.push({ engineers, worktrees, rate, weeks: round(days / plan.daysPerWeek, 1), order })
      }

  const chain = criticalChain(active, 'plan')
  const chainDays = chain.reduce((t, id) => t + (active.find((p) => p.id === id) as Package).days.plan, 0)
  const byReq = new Map(reqs.map((r) => [r.id, r]))
  const slices = plan.slices.map((slice) => {
    const placed = packages.filter((p) => p.slice === slice.id)
    const members = placed.flatMap((p) => p.requirements.map((id) => byReq.get(id) as Requirement))
    const counts = { S: 0, M: 0, L: 0 }
    for (const r of members) counts[r.size]++
    return {
      id: slice.id,
      frs: members.length,
      sizes: counts,
      decisions: members.filter((r) => r.decision).length,
      planDays: round(placed.reduce((t, p) => t + p.days.plan, 0), 1),
      gated: slice.gated ?? false,
    }
  })
  const gatedRequirements = reqs.filter((r) => !scheduled.has(r.id))
  const planDays = active.map((p) => p.days.plan).sort((a, b) => a - b)
  const mid = Math.floor(planDays.length / 2)
  return {
    gated: {
      requirements: gatedRequirements.length,
      planDays: round(packages.filter((p) => p.gated).reduce((t, p) => t + p.days.plan, 0), 1),
    },
    totals: {
      planDays: round(planDays.reduce((a, b) => a + b, 0), 1),
      medianPlanDays: planDays.length % 2 ? planDays[mid] : round((planDays[mid - 1] + planDays[mid]) / 2),
      largestPlanDays: planDays[planDays.length - 1],
      integrationLinks: active.reduce((t, p) => t + p.integrationLinks.length, 0),
    },
    requirements: { total: reqs.length, scheduled: scheduled.size, sizes, decisions: reqs.filter((r) => r.decision).length },
    slices,
    packages,
    unresolved,
    criticalChain: { ids: chain, weeks: round(chainDays / plan.daysPerWeek, 1) },
    schedules,
  }
}

function weeksFor(report: Report, engineers: number, worktrees: number, rate: RateName): string {
  const s = report.schedules.find((x) => x.engineers === engineers && x.worktrees === worktrees && x.rate === rate)
  return s ? `${s.weeks}` : '-'
}

export function toMarkdown(report: Report, plan: Plan): string {
  const active = report.packages.filter((p) => !p.gated)
  const { engineers: he, worktrees: hw } = plan.team.headline
  const t = report.totals
  const r = report.requirements
  const lines = [
    '## Totals',
    '',
    `- Requirements: ${r.total} (${r.sizes.S} S, ${r.sizes.M} M, ${r.sizes.L} L), ${r.scheduled} scheduled, ${r.decisions} flagged Decision:`,
    `- Work packages: ${report.packages.length}, ${active.length} scheduled, ${report.packages.length - active.length} gated`,
    `- Gated (built only if the client says yes): ${report.gated.requirements} requirements, ${report.gated.planDays} planning days`,
    `- Planning days per package: median ${t.medianPlanDays}, largest ${t.largestPlanDays}, total ${t.planDays}`,
    `- Integration links (product to product, checked when both sides land): ${t.integrationLinks}`,
    `- Longest dependency chain at planning rates: ${report.criticalChain.weeks} weeks (${report.criticalChain.ids.join(' > ')})`,
    `- Build days per engineer-week: ${plan.daysPerWeek}`,
    '',
    '## Slices',
    '',
    '| Slice | Name | FRs (S/M/L) | Decisions | Plan days |',
    '|---|---|---|---|---|',
    ...report.slices.map((x) => {
      const name = plan.slices.find((s) => s.id === x.id)?.name ?? ''
      return `| ${x.id} | ${name}${x.gated ? ' (gated, not scheduled)' : ''} | ${x.frs} (${x.sizes.S}/${x.sizes.M}/${x.sizes.L}) | ${x.decisions} | ${x.planDays} |`
    }),
    '',
    `## Weeks at planning rates (engineers x worktrees)`,
    '',
    `| Engineers | ${plan.team.worktrees.map((w) => `${w} worktree${w === 1 ? '' : 's'}`).join(' | ')} |`,
    `|---|${plan.team.worktrees.map(() => '---').join('|')}|`,
    ...plan.team.engineers.map((e) => `| ${e} | ${plan.team.worktrees.map((w) => weeksFor(report, e, w, 'plan')).join(' | ')} |`),
    '',
    `## Headline: ${he} engineers x ${hw} worktrees`,
    '',
    `| Fast | Planning | Floor |`,
    `|---|---|---|`,
    `| ${RATE_NAMES.map((k) => weeksFor(report, he, hw, k)).join(' | ')} |`,
    '',
    `${hw} worktrees per engineer holds only while the engineer's own time on a package (spec, steering, review, checking in dev) stays at or under about 1/${hw} of its planning time.`,
  ]
  const assumed = report.packages.filter((p) => p.assumed)
  if (assumed.length) lines.push('', '## Sized by assumption (no requirement yet)', '', ...assumed.map((p) => `- ${p.id} ${p.name}: ${p.days.plan} planning days`))
  const unresolved = Object.entries(report.unresolved)
  if (unresolved.length) lines.push('', '## Dependencies that resolved to nothing', '', ...unresolved.map(([t, n]) => `- \`${t}\` (${n})`))
  return lines.join('\n')
}

const USAGE = 'usage: bun schedule.ts <requirements-dir> <plan.json> [--json <out.json>]'

const HELP = `${USAGE}

Reads every *.md in <requirements-dir> (tables whose header starts with | FR |)
and the plan, prints the estimate as Markdown, and with --json writes the full
report (slices, packages, every team schedule with its lane order).

plan.json fields:
  daysPerWeek    build days per engineer-week, usually 5
  rates          days per requirement by size: { fast, plan, floor } each { S, M, L }
  team           { engineers: [2, 3, 4], worktrees: [1, 2, 3], headline: { engineers, worktrees } }
  slices         [{ id, name, goal, phase, capabilities: [ids], gated?: true }]
                 gated slices are counted but never scheduled
  foundations    [{ id, slice, name, members: [requirement or capability ids], after?: [ids],
                   assumedDays?: { fast, plan, floor } }]
  products       optional, same shape: split a capability or give it a real wait (after);
                 unlisted requirements become one package per capability
  dependsOn      { foundation: [ids], product: [ids], layers: { <layer>: [ids] } }
                 every layer a requirement uses must be a key, even with []
  aliases        { "<shorthand used in Depends on>": [package ids] }, any case

It refuses a plan that misses or double-counts a requirement, reuses a package
id, names an unknown package or layer, has a dependency cycle, or lets
scheduled work depend on gated work, and names the cause. Fix the plan.`

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    process.exit(0)
  }
  const [dir, planPath, flag, jsonOut] = args
  if (!dir || !planPath || (flag && flag !== '--json') || (flag && !jsonOut)) {
    console.error(`${USAGE}\nRun with --help for the plan.json fields.`)
    process.exit(2)
  }
  const plan: Plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  const reqs = files.flatMap((f) => parseRequirements(readFileSync(join(dir, f), 'utf8'), f))
  const report = estimate(reqs, plan)
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1))
  console.log(toMarkdown(report, plan))
}
