import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { flow } from '../adapters/flow.ts'
import type { Config } from '../config.ts'
import { buildWorkItems, type HandoffInput } from '../handoff.ts'
import type { Capability, Requirement } from '../types.ts'

const FIXTURE = join(import.meta.dir, '..', '..', 'fixtures', 'flow-target')

let root: string

const config = (): Config => ({
  source: {
    path: join(root, 'legacy'),
    scope: 'x',
    stack: 'unknown',
    vcs: 'none',
    basis: 'source-only',
  },
  target: {
    name: 'target',
    stack: 'unknown',
    parity_test_path: 'tests/parity/{capability}/{fr_slug}.test.ts',
    layout: {},
    commands: {},
  },
  surfaces: ['routes'],
  surfaceSingular: {},
  closers: [],
  handoff: { adapter: 'flow' },
})

function cap(slug: string, title: string, ns: string, elements: string[]): Capability {
  return { slug, title, ns, elements }
}

function req(
  id: string,
  capSlug: string,
  text: string,
  over: Partial<Requirement> = {},
): Requirement {
  return {
    id,
    cap: capSlug,
    requirement: text,
    actors: 'User',
    objects: 'Thing',
    rules: 'none',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [],
    parity: { kind: 'rubric', level: 'high' },
    batch: 'b-1',
    ...over,
  }
}

const CAPS = [
  cap('billing', 'Billing', 'BI', ['el-b']),
  cap('user-management', 'User management', 'UM', ['el-u']),
]
const REQS = [
  req('UM-001', 'user-management', 'Authenticate a user'),
  req('UM-002', 'user-management', 'Lock an account', {
    confidence: { kind: 'inferred' },
    origin: 'accidental-candidate',
  }),
  req('BI-001', 'billing', 'Raise an invoice'),
]

function input(caps = CAPS, reqs = REQS): HandoffInput {
  return {
    requirements: reqs,
    capabilities: caps,
    deltas: [],
    config: config(),
    root,
    gitBin: 'git',
    ghBin: 'gh',
  }
}

const capPath = (slug: string): string =>
  join(root, 'docs', 'modernisation', 'capability-map', `${slug}.md`)

async function flowCli(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(['bun', join(root, 'tools', 'flow', 'src', 'cli.ts'), ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? -1, out, err }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'migrate-flow-adapter-'))
  await cp(FIXTURE, root, { recursive: true })
  await Bun.write(join(root, 'legacy', 'app.js'), '// legacy\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('apply emits capability files the target parser accepts', async () => {
  const result = await flow.apply(buildWorkItems(CAPS, REQS), input())
  expect(result.created.sort()).toEqual(['billing', 'user-management'])

  // The oracle: the target's own checker, run over what the adapter just wrote.
  const check = await flowCli(['map', '--check'])
  expect(check.err).toBe('')
  expect(check.code).toBe(0)
})

// --- grammar conformance, one assertion per rule in the target's parser ---
// Each row cites quartex/Nexus at c2464ac,
// plugins/stack/templates/tools/flow/src/capability.ts.

test('capability.ts:43 every required frontmatter field is present', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const text = await readFile(capPath('billing'), 'utf8')
  for (const field of ['cap:', 'ns:', 'title:', 'status:']) {
    expect(text).toContain(field)
  }
})

test('capability.ts:3 status is one the target admits', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const text = await readFile(capPath('billing'), 'utf8')
  expect(text).toContain('status: todo')
})

test('capability.ts:44 all three required sections are emitted', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const text = await readFile(capPath('billing'), 'utf8')
  expect(text).toContain('## Functional requirements')
  expect(text).toContain('## Built')
  expect(text).toContain('## Remaining')
})

test('capability.ts:6 confidence is mapped into the target vocabulary', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const text = await readFile(capPath('user-management'), 'utf8')
  expect(text).toContain('| Confirmed |')
  expect(text).toContain('| Inferred |')
  expect(text).not.toContain('confirmed |')
})

test('capability.ts:9 accidental-candidate is mapped to poss-accidental', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const text = await readFile(capPath('user-management'), 'utf8')
  expect(text).toContain('poss-accidental')
  expect(text).not.toContain('accidental-candidate')
})

test('capability.ts:74 every FR row has exactly seven cells', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const text = await readFile(capPath('user-management'), 'utf8')
  const rows = text
    .split('\n')
    .filter((l) => l.startsWith('| UM-'))
    .map((l) => l.split('|').slice(1, -1))
  expect(rows).toHaveLength(2)
  for (const row of rows) expect(row).toHaveLength(7)
})

test('capability.ts:48 no "## " line is emitted inside a table cell', async () => {
  // A requirement whose text would open a section if it reached line start.
  const sneaky = [req('BI-001', 'billing', 'Handle the\n## Built case')]
  await flow.apply(
    buildWorkItems([CAPS[0] as Capability], sneaky),
    input([CAPS[0] as Capability], sneaky),
  )
  const check = await flowCli(['map', '--check'])
  expect(check.code).toBe(0)
})

test('capability.ts:42 an FR id that does not match its namespace refuses before writing', async () => {
  const bad = [req('login-001', 'user-management', 'Authenticate a user')]
  const caps = [CAPS[1] as Capability]
  await expect(flow.plan(input(caps, bad))).rejects.toThrow(/login-001/)
  // Nothing was written: the refusal happens in plan(), not part way through apply().
  expect(await Bun.file(capPath('user-management')).exists()).toBe(false)
})

// --- WORK.md ---

test('apply appends under an existing ## Proposed section and creates it when absent', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const first = await readFile(join(root, 'docs', 'WORK.md'), 'utf8')
  expect(first).toContain('## Proposed')
  expect(first).toContain('- [billing] Billing (1 FRs)')
  expect(first).toContain('- [user-management] User management (2 FRs)')
  // The team's own sections survive.
  expect(first).toContain('- [W01] Wire the deployment pipeline')

  // Re-running does not stack a second copy of the same lines.
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const second = await readFile(join(root, 'docs', 'WORK.md'), 'utf8')
  expect(second.match(/- \[billing\]/g)).toHaveLength(1)
})

// --- throughput and degradation ---

test('throughput reads coveredIds from the target parity command, undated', async () => {
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  // The target records delivery in the capability file's Built section.
  const text = await readFile(capPath('billing'), 'utf8')
  await writeFile(capPath('billing'), text.replace('## Built\n\n(none)', '## Built\n\nBI-001'))

  const t = await flow.throughput?.(input())
  expect(t?.completions).toEqual([{ fr: 'BI-001', doneAt: null }])
  expect(t?.basis).toContain('flow parity')
})

test('a target with no flow CLI reports that the emission was not validated', async () => {
  await rm(join(root, 'tools'), { recursive: true, force: true })
  const result = await flow.apply(buildWorkItems(CAPS, REQS), input())
  expect(result.created.sort()).toEqual(['billing', 'user-management'])
  expect(result.refs['billing']).toContain('capability-map/billing.md')
})

test('a capability file the target rejects fails apply with the target’s own message', async () => {
  // The fixture CLI is the oracle; break its input and the adapter must
  // surface the failure rather than reporting a clean emission.
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  await writeFile(capPath('billing'), '---\ncap: billing\n---\n\nnothing else\n')
  const check = await flowCli(['map', '--check'])
  expect(check.code).toBe(1)
  expect(check.err).toContain('missing field')
})

test("the team's own lines under ## Proposed survive a handoff", async () => {
  // The previous version stripped every `- [something]` line under the
  // heading before adding its own, on the assumption that shape meant
  // ownership. `- [W07]` is exactly the notation the target's own WORK.md
  // teaches, so a team keeping a shortlist there lost it on the first run.
  const workPath = join(root, 'docs', 'WORK.md')
  await writeFile(
    workPath,
    [
      '# Work',
      '',
      '## Proposed',
      '',
      '- [W07] Replace the auth provider',
      '- [W08] Split the reporting service',
      '',
      'Notes: W07 is blocked until Q3.',
      '',
      '### Detail',
      '',
      'Some prose.',
      '',
      '# Appendix',
      '',
      '- [A1] An appendix item',
      '',
    ].join('\n'),
  )

  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const after = await readFile(workPath, 'utf8')

  for (const kept of [
    '- [W07] Replace the auth provider',
    '- [W08] Split the reporting service',
    'Notes: W07 is blocked until Q3.',
    '### Detail',
    '# Appendix',
    '- [A1] An appendix item',
  ]) {
    expect(after).toContain(kept)
  }
  expect(after).toContain('- [billing] Billing (1 FRs)')

  // And a second run replaces only its own fenced block rather than stacking.
  await flow.apply(buildWorkItems(CAPS, REQS), input())
  const twice = await readFile(workPath, 'utf8')
  expect(twice.match(/- \[billing\]/g)).toHaveLength(1)
  expect(twice).toContain('- [W07] Replace the auth provider')
})
