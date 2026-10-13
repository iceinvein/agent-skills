import { expect, test } from 'bun:test'
import { estimate, parseRequirements, type Plan } from '../schedule.ts'

const HEADER = `| FR | Requirement | Actor | Layers | Size | Depends on | Source | Notes |
|---|---|---|---|---|---|---|---|`

const REQUIREMENTS = `# Area

### FD-DB Data model (New)

${HEADER}
| FD-DB.1 | Migrations shall create the core tables. | System | db | M | - | C §1 | |
| FD-DB.2 | Seed data shall be synthetic only. | System | db | S | FD-DB.1 | C §2 | Decision: seed shape |

### PM-01 Participants (Carry)

${HEADER}
| PM-01.1 | The API shall create a participant. | Clinician | api, db | L | FD-DB.1, CO-01 | C §3 | |
| PM-01.2 | The web app shall list participants. | Clinician | web | S | PM-01.1 | A §1 | |

### CO-01 Consent (New)

${HEADER}
| CO-01.1 | The API shall send a consent request. | System | api | M | Auth | C §4 | |

### AA-01 Acoustic analysis (Undecided)

${HEADER}
| AA-01.1 | The worker shall run acoustic analysis. | System | worker | S | - | D §1 | Decision: in pilot? |
`

// Whole-day rates so every expected value below can be worked out by hand.
const plan = (overrides: Partial<Plan> = {}): Plan => ({
  daysPerWeek: 5,
  rates: {
    fast: { S: 1, M: 2, L: 4 },
    plan: { S: 1, M: 2, L: 4 },
    floor: { S: 1, M: 2, L: 4 },
  },
  team: { engineers: [1, 2], worktrees: [1], headline: { engineers: 2, worktrees: 1 } },
  slices: [
    { id: 'F', name: 'Foundations', goal: 'Schema exists', phase: 0, capabilities: ['FD-DB'] },
    { id: 'P', name: 'Participants', goal: 'Participants exist', phase: 1, capabilities: ['PM-01', 'CO-01'] },
    { id: 'D', name: 'Acoustic', goal: 'Only if wanted', phase: 1, capabilities: ['AA-01'], gated: true },
  ],
  foundations: [
    { id: 'F1', slice: 'F', name: 'Migrations', members: ['FD-DB.1'] },
    { id: 'F2', slice: 'F', name: 'Seed data', members: ['FD-DB.2'] },
  ],
  dependsOn: { foundation: [], product: [], layers: { db: ['F1'], web: ['F2'], api: [], worker: [] } },
  aliases: { auth: ['F1'] },
  ...overrides,
})

const reqs = () => parseRequirements(REQUIREMENTS, 'area.md')

test('parsed requirements carry their capability, size, layers and decision flag', () => {
  const pm = reqs().find((r) => r.id === 'PM-01.1')
  expect(pm).toEqual({
    id: 'PM-01.1',
    file: 'area.md',
    capability: 'PM-01',
    disposition: 'Carry',
    size: 'L',
    layers: ['api', 'db'],
    depends: ['FD-DB.1', 'CO-01'],
    decision: false,
  })
  expect(reqs().find((r) => r.id === 'FD-DB.2')?.decision).toBe(true)
})

test('only a Decision: marker flags a requirement, not prose that mentions a decision', () => {
  const md = `### X-01 Thing (New)\n\n${HEADER}\n| X-01.1 | A. | System | api | S | - | s | Decision: as X-02.1 |\n| X-01.2 | B. | System | api | S | - | s | Built per Decision D-05 |\n`
  expect(parseRequirements(md, 'x.md').map((r) => r.decision)).toEqual([true, false])
})

test('an escaped pipe stays inside its cell', () => {
  const md = `### X-01 Thing (New)\n\n${HEADER}\n| X-01.1 | Shows a \\| b. | System | api | S | - | s | |\n`
  expect(parseRequirements(md, 'x.md')).toHaveLength(1)
})

test('a requirement row with the wrong number of cells is rejected with its location', () => {
  const broken = `### X-01 Thing (New)\n\n${HEADER}\n| X-01.1 | Too few cells | System | S |\n`
  expect(() => parseRequirements(broken, 'x.md')).toThrow('x.md:5')
})

test('tables that are not requirement tables are ignored', () => {
  const mixed = `### X-01 Thing (Drop)\n\n| Job today | Replaced by |\n|---|---|\n| Create users | IA-01.2 |\n\n${HEADER}\n| X-01.1 | A thing. | System | api | S | - | s | |\n`
  expect(parseRequirements(mixed, 'x.md').map((r) => r.id)).toEqual(['X-01.1'])
})

test('a size other than S, M or L is rejected', () => {
  const broken = `### X-01 Thing (New)\n\n${HEADER}\n| X-01.1 | A thing. | System | api | XL | - | s | |\n`
  expect(() => parseRequirements(broken, 'x.md')).toThrow('XL')
})

test('one lane builds every scheduled package back to back', () => {
  // F1 2 + F2 1 + PM-01 5 + CO-01 2 = 10 days = 2 weeks; AA-01 is gated and left out.
  const report = estimate(reqs(), plan())
  expect(report.schedules.find((s) => s.engineers === 1 && s.rate === 'plan')?.weeks).toBe(2)
})

test('two lanes finish when the longest dependency chain does', () => {
  // F1 (0-2) > F2 (2-3) > PM-01 (3-8), with CO-01 (2-4) on the other lane: 8 days.
  const report = estimate(reqs(), plan())
  expect(report.schedules.find((s) => s.engineers === 2 && s.rate === 'plan')?.weeks).toBe(1.6)
  expect(report.criticalChain).toEqual({ ids: ['F1', 'F2', 'PM-01'], weeks: 1.6 })
})

test('a product package is blocked by the foundations its layers use, not by other products', () => {
  const report = estimate(reqs(), plan())
  const pm = report.packages.find((p) => p.id === 'PM-01')
  expect(pm?.deps).toEqual(['F1', 'F2'])
  expect(pm?.integrationLinks).toEqual(['CO-01'])
})

test('a dependency named by alias resolves to the packages it stands for', () => {
  const report = estimate(reqs(), plan())
  expect(report.packages.find((p) => p.id === 'CO-01')?.deps).toEqual(['F1'])
})

test('worktrees multiply the lanes each engineer runs', () => {
  const team = { engineers: [1], worktrees: [2], headline: { engineers: 1, worktrees: 2 } }
  const report = estimate(reqs(), plan({ team }))
  expect(report.schedules.find((s) => s.rate === 'plan')?.weeks).toBe(1.6)
})

test('a foundation package with an assumed size is scheduled at that size', () => {
  const foundations = [
    { id: 'F0', slice: 'F', name: 'Local dev stack', members: [], assumedDays: { fast: 3, plan: 3, floor: 3 } },
    { id: 'F1', slice: 'F', name: 'Migrations', members: ['FD-DB.1'] },
    { id: 'F2', slice: 'F', name: 'Seed data', members: ['FD-DB.2'] },
  ]
  const report = estimate(reqs(), plan({ foundations }))
  expect(report.schedules.find((s) => s.engineers === 1 && s.rate === 'plan')?.weeks).toBe(2.6)
})

test('a dependency cycle between foundation packages is refused and named', () => {
  const foundations = [
    { id: 'F1', slice: 'F', name: 'Migrations', members: ['FD-DB.1'], after: ['F2'] },
    { id: 'F2', slice: 'F', name: 'Seed data', members: ['FD-DB.2'] },
  ]
  expect(() => estimate(reqs(), plan({ foundations }))).toThrow('F1 waits on F2 waits on F1')
})

test('a dependency cycle names the requirement behind each edge', () => {
  const foundations = [
    { id: 'F1', slice: 'F', name: 'Migrations', members: ['FD-DB.1'], after: ['F2'] },
    { id: 'F2', slice: 'F', name: 'Seed data', members: ['FD-DB.2'] },
  ]
  expect(() => estimate(reqs(), plan({ foundations }))).toThrow('F2 waits on F1: FD-DB.2 depends on FD-DB.1')
})

test('a capability that belongs to no slice is refused', () => {
  const slices = plan().slices.filter((s) => s.id !== 'D')
  expect(() => estimate(reqs(), plan({ slices }))).toThrow('AA-01')
})

test('a requirement claimed by two foundation packages is refused', () => {
  const foundations = [
    { id: 'F1', slice: 'F', name: 'Migrations', members: ['FD-DB.1', 'FD-DB.2'] },
    { id: 'F2', slice: 'F', name: 'Seed data', members: ['FD-DB.2'] },
  ]
  expect(() => estimate(reqs(), plan({ foundations }))).toThrow('FD-DB.2')
})

test('a dependency that names nothing known is reported, not dropped silently', () => {
  const extra = REQUIREMENTS.replace('| Auth |', '| Auth, Billing |')
  const report = estimate(parseRequirements(extra, 'area.md'), plan())
  expect(report.unresolved).toEqual({ Billing: 1 })
})

test('a scheduled package that waits on a gated one is refused and named', () => {
  const slices = plan().slices.map((s) => (s.id === 'F' ? { ...s, gated: true } : s))
  expect(() => estimate(reqs(), plan({ slices }))).toThrow('PM-01 waits on F1, which is gated')
})

test('two packages with the same id are refused', () => {
  const foundations = [
    { id: 'F1', slice: 'F', name: 'Migrations', members: ['FD-DB.1'] },
    { id: 'F1', slice: 'F', name: 'Seed data', members: ['FD-DB.2'] },
  ]
  expect(() => estimate(reqs(), plan({ foundations }))).toThrow('package id F1 is used twice')
})

test('a range waits on every package that owns a requirement in it', () => {
  const md = REQUIREMENTS.replace('| Auth |', '| FD-DB.1 to FD-DB.2 |')
  expect(estimate(parseRequirements(md, 'area.md'), plan()).packages.find((p) => p.id === 'CO-01')?.deps).toEqual(['F1', 'F2'])
})

test('a range that names no known requirement is reported', () => {
  const md = REQUIREMENTS.replace('| Auth |', '| ZZ-01.1 to ZZ-01.3 |')
  expect(estimate(parseRequirements(md, 'area.md'), plan()).unresolved).toEqual({ 'ZZ-01.1 to ZZ-01.3': 1 })
})

test('a misspelled requirement id is reported rather than widened to its capability', () => {
  const md = REQUIREMENTS.replace('| Auth |', '| FD-DB.9 |')
  const report = estimate(parseRequirements(md, 'area.md'), plan())
  expect(report.unresolved).toEqual({ 'FD-DB.9': 1 })
  expect(report.packages.find((p) => p.id === 'CO-01')?.deps).toEqual([])
})

test('a bare capability id waits on every package holding that capability', () => {
  const md = REQUIREMENTS.replace('| Auth |', '| FD-DB |')
  expect(estimate(parseRequirements(md, 'area.md'), plan()).packages.find((p) => p.id === 'CO-01')?.deps).toEqual(['F1', 'F2'])
})

test('a layer the plan does not declare is refused', () => {
  const dependsOn = { foundation: [], product: [], layers: { db: ['F1'], web: ['F2'] } }
  expect(() => estimate(reqs(), plan({ dependsOn }))).toThrow('layer api')
})

test('alias keys match whatever their case', () => {
  const report = estimate(reqs(), plan({ aliases: { Auth: ['F1'] } }))
  expect(report.packages.find((p) => p.id === 'CO-01')?.deps).toEqual(['F1'])
})

test('a table padded by a formatter is still read', () => {
  const md = `### X-01 Thing (New)\n\n| FR     | Requirement | Actor | Layers | Size | Depends on | Source | Notes |\n| ------ | --- | :--- | --- | --- | --- | --- | --- |\n| X-01.1 | A thing. | System | api | S | - | s | |\n`
  expect(parseRequirements(md, 'x.md').map((r) => r.id)).toEqual(['X-01.1'])
})

test('a capability heading without a title still starts a new capability', () => {
  const md = `### X-01 Thing (New)\n\n${HEADER}\n| X-01.1 | A. | System | api | S | - | s | |\n\n### Y-01\n\n${HEADER}\n| Y-01.1 | B. | System | api | S | - | s | |\n`
  expect(parseRequirements(md, 'x.md').map((r) => r.capability)).toEqual(['X-01', 'Y-01'])
})

test('a plan with nothing left to schedule is refused', () => {
  const slices = plan().slices.map((s) => ({ ...s, gated: true }))
  expect(() => estimate(reqs(), plan({ slices }))).toThrow('nothing to schedule')
})

test('every team combination carries its own lane order', () => {
  const report = estimate(reqs(), plan())
  const two = report.schedules.find((s) => s.engineers === 2 && s.rate === 'plan')
  expect(two?.order.map((o) => [o.id, o.engineer, o.startWeek, o.endWeek])).toEqual([
    ['F1', 1, 0, 0.4],
    ['F2', 2, 0.4, 0.6],
    ['CO-01', 1, 0.4, 0.8],
    ['PM-01', 2, 0.6, 1.6],
  ])
})

test('slices report their requirement counts and planning days, gated ones marked', () => {
  const report = estimate(reqs(), plan())
  expect(report.slices).toEqual([
    { id: 'F', frs: 2, sizes: { S: 1, M: 1, L: 0 }, decisions: 1, planDays: 3, gated: false },
    { id: 'P', frs: 3, sizes: { S: 1, M: 1, L: 1 }, decisions: 0, planDays: 7, gated: false },
    { id: 'D', frs: 1, sizes: { S: 1, M: 0, L: 0 }, decisions: 1, planDays: 1, gated: true },
  ])
})

test('a headline team outside the team ranges is refused', () => {
  const team = { engineers: [2], worktrees: [1], headline: { engineers: 2, worktrees: 3 } }
  expect(() => estimate(reqs(), plan({ team }))).toThrow('headline 2 x 3')
})

test('a product package can wait on another product when the plan says so', () => {
  const products = [{ id: 'PM-01', slice: 'P', name: 'Participants', members: ['PM-01'], after: ['CO-01'] }]
  const report = estimate(reqs(), plan({ products }))
  expect(report.packages.find((p) => p.id === 'PM-01')?.deps).toEqual(['CO-01', 'F1', 'F2'])
  // F1 (0-2), CO-01 (2-4) and F2 (2-3) in parallel, then PM-01 (4-9): 9 days.
  expect(report.schedules.find((s) => s.engineers === 2 && s.rate === 'plan')?.weeks).toBe(1.8)
})

test('a large product capability can be split into packages', () => {
  const products = [
    { id: 'PM-01a', slice: 'P', name: 'Create', members: ['PM-01.1'] },
    { id: 'PM-01b', slice: 'P', name: 'List', members: ['PM-01.2'], after: ['PM-01a'] },
  ]
  const report = estimate(reqs(), plan({ products }))
  expect(report.packages.filter((p) => p.slice === 'P').map((p) => [p.id, p.days.plan])).toEqual([
    ['PM-01a', 4],
    ['PM-01b', 1],
    ['CO-01', 2],
  ])
})

test('gated work is totalled so the cost of each yes is visible', () => {
  expect(estimate(reqs(), plan()).gated).toEqual({ requirements: 1, planDays: 1 })
})

test('each placed package names its engineer and worktree', () => {
  const team = { engineers: [1], worktrees: [2], headline: { engineers: 1, worktrees: 2 } }
  const order = estimate(reqs(), plan({ team })).schedules.find((s) => s.rate === 'plan')?.order
  expect(order?.map((o) => [o.id, o.engineer, o.worktree])).toEqual([
    ['F1', 1, 1],
    ['F2', 1, 2],
    ['CO-01', 1, 1],
    ['PM-01', 1, 2],
  ])
})

test('a scheduled package that references gated work is refused, even as an integration link', () => {
  const md = REQUIREMENTS.replace('| Auth |', '| Auth, AA-01 |')
  expect(() => estimate(parseRequirements(md, 'area.md'), plan())).toThrow('CO-01 references AA-01, which is gated')
})

test('package totals are in the report, not only in the printed summary', () => {
  // Scheduled packages: F1 2, F2 1, PM-01 5, CO-01 2 days; PM-01 links to CO-01.
  expect(estimate(reqs(), plan()).totals).toEqual({ planDays: 10, medianPlanDays: 2, largestPlanDays: 5, integrationLinks: 1 })
})

test('a scheduled package may not claim requirements from a gated slice', () => {
  const products = [{ id: 'AA-01x', slice: 'P', name: 'Acoustic', members: ['AA-01'] }]
  expect(() => estimate(reqs(), plan({ products }))).toThrow('AA-01x is scheduled but claims AA-01.1, whose slice D is gated')
})

test('a package placed in another slice counts toward the slice it is placed in', () => {
  const foundations = [
    { id: 'F1', slice: 'F', name: 'Migrations', members: ['FD-DB.1'] },
    { id: 'F2', slice: 'P', name: 'Seed data', members: ['FD-DB.2'] },
  ]
  const report = estimate(reqs(), plan({ foundations }))
  expect(report.slices.map((x) => [x.id, x.frs, x.planDays])).toEqual([
    ['F', 1, 2],
    ['P', 4, 8],
    ['D', 1, 1],
  ])
})

test('a split that leaves part of a capability under the same id names the clash', () => {
  const products = [{ id: 'PM-01', slice: 'P', name: 'Create', members: ['PM-01.1'] }]
  expect(() => estimate(reqs(), plan({ products }))).toThrow('PM-01.2 is left unclaimed')
})

test('a package listed as waiting on itself is refused', () => {
  const products = [{ id: 'PM-01', slice: 'P', name: 'Participants', members: ['PM-01'], after: ['PM-01'] }]
  expect(() => estimate(reqs(), plan({ products }))).toThrow('PM-01 lists itself under after')
})

test('an escaped pipe is read back as a plain pipe', () => {
  const md = `### X-01 Thing (New)\n\n${HEADER}\n| X-01.1 | A. | System | api | S | - | s | a \\| b |\n`
  const md2 = md.replace('| - | s |', '| X-02.1 \\| x | s |')
  expect(parseRequirements(md2, 'x.md')[0].depends).toEqual(['X-02.1 | x'])
})

test('work spreads across engineers before it doubles up on one engineer', () => {
  const team = { engineers: [2], worktrees: [2], headline: { engineers: 2, worktrees: 2 } }
  const order = estimate(reqs(), plan({ team })).schedules.find((s) => s.rate === 'plan')?.order
  // F1 starts alone at day 0; the next lane to free is engineer 2's first worktree.
  expect(order?.slice(0, 2).map((o) => [o.id, o.engineer, o.worktree])).toEqual([
    ['F1', 1, 1],
    ['F2', 2, 1],
  ])
})

test('the median of an odd number of packages is the middle one', () => {
  // With AA-01 ungated: 1, 1, 2, 2, 5 days.
  const slices = plan().slices.map((s) => ({ ...s, gated: false }))
  expect(estimate(reqs(), plan({ slices })).totals.medianPlanDays).toBe(2)
})

test('--help prints usage and the plan fields, and exits cleanly', async () => {
  const proc = Bun.spawn(['bun', `${import.meta.dir}/../schedule.ts`, '--help'], { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  expect(await proc.exited).toBe(0)
  expect(out).toContain('usage: bun schedule.ts <requirements-dir> <plan.json> [--json <out.json>]')
  for (const field of ['daysPerWeek', 'rates', 'team', 'slices', 'foundations', 'products', 'dependsOn', 'aliases']) expect(out).toContain(field)
})

test('a missing argument prints usage to stderr and fails', async () => {
  const proc = Bun.spawn(['bun', `${import.meta.dir}/../schedule.ts`], { stdout: 'pipe', stderr: 'pipe' })
  expect(await proc.exited).toBe(2)
  expect(await new Response(proc.stderr).text()).toContain('usage:')
})
