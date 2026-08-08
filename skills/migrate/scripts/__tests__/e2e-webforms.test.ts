import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')
const FIXTURE = join(import.meta.dir, '..', '..', 'fixtures', 'tiny-webforms')

let target: string
let source: string

async function migrate(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(['bun', CLI, ...args], { cwd: target, stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  return { code: proc.exitCode ?? -1, out, err }
}

async function write(name: string, value: unknown): Promise<string> {
  const path = join(target, name)
  await writeFile(path, JSON.stringify(value))
  return path
}

async function writeText(name: string, text: string): Promise<string> {
  const path = join(target, name)
  await writeFile(path, text)
  return path
}

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), 'migrate-e2e-webforms-'))
  source = join(target, 'legacy')
  await cp(FIXTURE, source, { recursive: true })
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

// GROUND-TRUTH.md is the single source of what this fixture contains, parsed
// here rather than hand-copied, for the same reason e2e-express.test.ts parses
// it: a row added to the fixture without a matching update here (or the
// reverse) cannot silently drift, because the batches below are built from
// whatever the table on disk actually says.
type GroundTruthRow = { surface: string; id: string; element: string }

async function parseGroundTruth(path: string): Promise<GroundTruthRow[]> {
  const text = await readFile(path, 'utf8')
  const rows: GroundTruthRow[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())
    if (cells.length !== 3) continue
    const surface = cells[0] ?? ''
    const id = cells[1] ?? ''
    const element = cells[2] ?? ''
    if (surface === 'surface' && id === 'id') continue // header row
    if (cells.every((c) => /^-+$/.test(c))) continue // separator row
    rows.push({ surface, id, element })
  }
  return rows
}

function groupBySurface(rows: GroundTruthRow[]): Map<string, GroundTruthRow[]> {
  const groups = new Map<string, GroundTruthRow[]>()
  for (const row of rows) {
    const list = groups.get(row.surface) ?? []
    list.push(row)
    groups.set(row.surface, list)
  }
  return groups
}

// This fixture's whole point is exercising the shipped aspnet recipe
// (references/recipes/aspnet.md), the one pack that ships at v1, instead of
// contract-only mode: `--source-stack aspnet-webforms` below is what routes
// enumerate.md's Inputs section at that file instead of deriving directions
// by hand. Every evidence string is the recipe's own literal `Probe:` (or
// disclosed supporting-probe) command, copied verbatim from aspnet.md, not a
// paraphrase of it: that is what ties this test to the recipe rather than to
// a generic enumeration, and it is also what a reviewer re-checks the count
// against. Every count below was produced by actually running that exact
// command against this fixture (see task-13-report.md for the full 24-probe
// table), not assumed from reading the recipe.
//
// Several surfaces carry more than the two-direction floor, which is
// aspnet.md's own preamble ("several surfaces below name more than the
// two-direction floor") made concrete: routes alone has three, because a
// WebForms app mixing in a Web API layer is exactly the case that preamble
// names. A direction whose probe found nothing on this fixture (hangfire,
// migrationBuilder, the two nav/sitemap probes, WCF, multi-step controller
// flow) is recorded as a real zero, per enumerate.md's zero-findings rule,
// not omitted: this fixture simply does not use Hangfire, EF migrations, a
// sitemap or master page, WCF, or MVC-style wizard actions, and the recipe
// says as much about several of these already (jobs' Hangfire direction is
// a documented gap for DI-registered jobs, which this fixture is not).
const DIRECTIONS: Record<string, Record<string, { count: number; evidence: string }>> = {
  routes: {
    attribute: {
      count: 3,
      evidence:
        "rg -n -g '*.cs' '[\\[,]\\s*(RoutePrefix|Route|HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions)\\b' <source>",
    },
    convention: {
      count: 3,
      evidence: "rg -n -g '*Controller*.cs' 'public\\s+\\S+\\s+\\w+\\s*\\(' <source>",
    },
    webforms: {
      count: 2,
      evidence: "find <source> -type f \\( -name '*.aspx' -o -name '*.ashx' \\)",
    },
  },
  tables: {
    ddl: { count: 2, evidence: "rg -n -g '*.sql' -i '^\\s*CREATE TABLE' <source>" },
    raw_ado: {
      count: 2,
      evidence:
        "rg -n -g '*.cs' '(FROM|INTO|UPDATE)\\s+((\\[[^]]+\\]|\\w+)\\.)*(\\[[^]]+\\]|\\w+)' <source> | grep -Ev '^[^:]+:[0-9]+:[[:space:]]*//'",
    },
  },
  jobs: {
    quartz: {
      count: 1,
      evidence: "rg -n -g '*.cs' 'IJob\\b|JobBuilder\\.Create|ScheduleJob\\(' <source>",
    },
    hangfire: {
      count: 0,
      evidence: "rg -n -g '*.cs' 'RecurringJob\\.|BackgroundJob\\.' <source>: no matches",
    },
  },
  reports: {
    disk: {
      count: 1,
      evidence: "find <source> -type f \\( -name '*.rdl' -o -name '*.rdlc' \\)",
    },
    nav: {
      count: 0,
      evidence:
        "rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*.master' -g '*Nav*.cshtml' -g '*Menu*.cshtml' -i 'report' <source>: no matches",
    },
  },
  screens: {
    filesystem: {
      count: 2,
      evidence: "find <source> -type f \\( -name '*.aspx' -o -name '*.cshtml' \\)",
    },
    nav: {
      count: 0,
      evidence:
        "rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*.master' -g '*Nav*.cshtml' -g '*Menu*.cshtml' '(url|href|NavigateUrl)=\"~/|Html\\.ActionLink\\(|Url\\.Action\\(' <source>: no matches",
    },
  },
  integrations: {
    httpclient: {
      count: 1,
      evidence: "rg -n -g '*.cs' 'new HttpClient\\(|new WebClient\\(' <source>",
    },
    wcf: {
      count: 0,
      evidence:
        "rg -n -g '*.cs' 'ClientBase<|ChannelFactory<|\\[ServiceContract\\]' <source>: no matches",
    },
  },
  workflows: {
    multistep: {
      count: 0,
      evidence: "rg -n -g '*.cs' 'ActionResult Step[0-9]+' <source>: no matches",
    },
    statecarriers: {
      count: 1,
      evidence: "rg -n -g '*.cs' 'Session\\[|TempData\\[' <source>",
    },
  },
  settings: {
    storage: { count: 3, evidence: "rg -n -g '*.config' '<add (key|name)=' <source>" },
    readsites: {
      count: 3,
      evidence: "rg -n -g '*.cs' 'ConfigurationManager\\.(AppSettings|ConnectionStrings)' <source>",
    },
  },
}

// Ledger refs a lens would record per enumerate.md's Procedure, step 4: an
// element that touches one already in the ledger gets a
// {"kind": "ledger", "id": ...} entry naming it. See GROUND-TRUTH.md's
// "Element-to-element touches" section, which this map matches by hand, the
// same relationship DIRECTIONS above has to aspnet.md's probes: this is
// fixture metadata the test asserts against, not something parsed off disk.
type LedgerRef = { kind: 'ledger'; id: string }
const REFS: Record<string, LedgerRef[]> = {
  'route-get-api-users': [{ kind: 'ledger', id: 'table-users' }],
  'route-post-api-users': [{ kind: 'ledger', id: 'table-users' }],
  'route-get-api-users-id-welcome': [{ kind: 'ledger', id: 'integration-billing-sync' }],
  'job-nightly-digest': [{ kind: 'ledger', id: 'table-audit-log' }],
  'report-daily-users': [{ kind: 'ledger', id: 'table-users' }],
  'workflow-signup-welcome': [
    { kind: 'ledger', id: 'route-post-api-users' },
    { kind: 'ledger', id: 'route-get-api-users-id-welcome' },
    { kind: 'ledger', id: 'setting-welcome-email-enabled' },
  ],
}

// Builds the same graph seam.md's surface-affinity clustering builds: one
// edge per {"kind": "ledger", ...} ref on any element, connecting it to the
// id it names. An edge is an unordered pair, stored as its two ids sorted and
// joined, so a-touches-b and b-touches-a (were both ever recorded) would
// collapse to one edge rather than count twice.
type StoredElement = { id: string; refs: { kind: string; id?: string }[] }

function buildAffinityEdges(elements: StoredElement[]): Set<string> {
  const edges = new Set<string>()
  for (const el of elements) {
    for (const ref of el.refs) {
      if (ref.kind === 'ledger' && ref.id) {
        edges.add([el.id, ref.id].sort().join('|'))
      }
    }
  }
  return edges
}

const QUEUE_ID = 'q-tiny-webforms-enumerate-scaffold'

const QUEUE_ITEM = `---
id: ${QUEUE_ID}
severity: minor
status: open
---

## Evidence

This run only drives probe and enumerate; extract never ran, so no
requirement exists yet for any element to map to.

## Options

(a) Leave every element unaccounted and accept that \`check --phase
enumerate\` cannot exit 0 while any element lacks a terminal disposition,
since the coverage gate reads the whole store regardless of \`--phase\`.
(b) Give every element a placeholder out-of-scope disposition citing this
item, so the enumerate-only slice of the run can still be asserted clean.

## Recommendation

Recommend (b); it isolates the census and run-state assertions this test
exists to make from the coverage gate, and citing this item keeps the
placeholder itself auditable rather than silent.
`

test('aspnet recipe enumerate over every declared surface, with a census reconciliation failure on mutation', async () => {
  const groundTruthPath = join(source, 'GROUND-TRUTH.md')
  const rows = await parseGroundTruth(groundTruthPath)
  expect(rows.length).toBeGreaterThan(0)
  const groups = groupBySurface(rows)

  // 1. migrate init, with --source-stack aspnet-webforms so enumerate.md
  // reads references/recipes/aspnet.md instead of falling into contract-only
  // mode: that recipe path, never exercised against a committed fixture
  // before this test, is the one this whole fixture exists to prove out.
  const init = await migrate([
    'init',
    '--source',
    source,
    '--scope',
    'the whole tiny webforms app',
    '--name',
    'webforms-next',
    '--source-stack',
    'aspnet-webforms',
  ])
  expect(init.code).toBe(0)

  // Drop the closer set so the census gate does not also demand extract-phase
  // closer records this run never produces, the same adjustment
  // e2e-express.test.ts makes and for the same reason. The default eight
  // surface types are left exactly as init wrote them, since this fixture's
  // whole point is exercising all eight.
  const cfgPath = join(target, '.migrate', 'config.toml')
  const cfg = await readFile(cfgPath, 'utf8')
  await writeFile(cfgPath, cfg.replace(/^set = .*$/m, 'set = []'))

  // 2. migrate phase probe --status done.
  expect((await migrate(['phase', 'probe', '--status', 'done'])).code).toBe(0)

  // File the queue item every element's placeholder disposition below cites.
  const queuePath = await writeText(`${QUEUE_ID}.md`, QUEUE_ITEM)
  expect((await migrate(['queue', 'add', queuePath])).code).toBe(0)

  // 4. migrate import elements, one batch per surface, rows from GROUND-TRUTH.md.
  for (const [surface, surfaceRows] of groups) {
    const batch = await write(`elements-${surface}.json`, {
      batch: `b-${surface}-elements-001`,
      phase: 'enumerate',
      rows: surfaceRows.map((row) => ({
        id: row.id,
        surface: row.surface,
        element: row.element,
        found_by: ['code'],
        disposition: { kind: 'out-of-scope', queue: QUEUE_ID },
        refs: REFS[row.id] ?? [],
        lens: 'code',
        notes: '',
      })),
    })
    const result = await migrate(['import', 'elements', batch])
    expect(result.code).toBe(0)
  }

  // 5. migrate census, one balanced lens record per surface, directions named
  // by aspnet.md for that surface, evidence set to the recipe's own probe
  // command, total within the two-of-two-directions-found bounds.
  for (const [surface, surfaceRows] of groups) {
    const count = surfaceRows.length
    const directions = DIRECTIONS[surface]
    if (!directions) throw new Error(`no aspnet.md directions declared for surface ${surface}`)
    const record = await write(`census-${surface}.json`, {
      kind: 'lens',
      surface,
      phase: 'enumerate',
      directions,
      total: count,
      in_ledger: 0,
      added: count,
      skipped: [],
      queued: [],
      batch: `b-${surface}-census-001`,
    })
    const result = await migrate(['census', record])
    expect(result.code).toBe(0)
    expect(result.out).toContain(`census: recorded lens:${surface}`)
  }

  // 6. migrate phase enumerate --status done.
  expect((await migrate(['phase', 'enumerate', '--status', 'done'])).code).toBe(0)

  // 7. migrate check --phase enumerate exits 0 with no violations.
  const clean = await migrate(['check', '--phase', 'enumerate'])
  expect(clean.out).toContain(`0/${rows.length} mapped, ${rows.length} out-of-scope, 0 unaccounted`)
  expect(clean.out).not.toContain('Violations')
  expect(clean.code).toBe(0)

  // 7b. Surface-affinity clustering's graph, built straight from the store
  // the same way seam.md's worked example builds it. This is the assertion
  // that would fail if enumerate's ref-recording step (step 4) were skipped:
  // an empty REFS map above would leave every element's refs empty, and this
  // graph would have zero edges, which is exactly the defect this task
  // exists to close.
  const elementsForAffinity = (await readFile(join(target, '.migrate', 'elements.jsonl'), 'utf8'))
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as StoredElement)
  const edges = buildAffinityEdges(elementsForAffinity)
  expect(edges.size).toBeGreaterThan(0)
  const expectedEdges = [
    ['route-get-api-users', 'table-users'],
    ['route-post-api-users', 'table-users'],
    ['route-get-api-users-id-welcome', 'integration-billing-sync'],
    ['job-nightly-digest', 'table-audit-log'],
    ['report-daily-users', 'table-users'],
    ['workflow-signup-welcome', 'route-post-api-users'],
    ['workflow-signup-welcome', 'route-get-api-users-id-welcome'],
    ['workflow-signup-welcome', 'setting-welcome-email-enabled'],
  ].map(([a, b]) => [a, b].sort().join('|'))
  for (const edge of expectedEdges) {
    expect(edges.has(edge)).toBe(true)
  }
  expect(edges.size).toBe(expectedEdges.length)

  // 8. Removing one element row breaks the census reconciliation for its
  // surface, and only that: `in_ledger + added` on the surviving census
  // record still claims the pre-mutation count, but elements.jsonl now has
  // one fewer row for that surface. This is what makes step 7's clean
  // assertion load-bearing rather than vacuous: if the reconciliation check
  // were missing or broken, this mutation would leave the check clean too.
  const mutatedSurface = 'tables'
  const mutatedRows = groups.get(mutatedSurface)
  if (!mutatedRows || mutatedRows.length < 2) {
    throw new Error(`fixture must declare at least two ${mutatedSurface} rows to mutate one away`)
  }
  const removedId = mutatedRows[mutatedRows.length - 1]?.id
  const elementsPath = join(target, '.migrate', 'elements.jsonl')
  const elementsText = await readFile(elementsPath, 'utf8')
  const survivingLines = elementsText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .filter((line) => (JSON.parse(line) as { id: string }).id !== removedId)
  await writeFile(elementsPath, `${survivingLines.join('\n')}\n`)

  const afterRemoval = await migrate(['check', '--phase', 'enumerate'])
  expect(afterRemoval.code).not.toBe(0)
  const claimed = mutatedRows.length
  const actual = mutatedRows.length - 1
  expect(afterRemoval.out).toContain(
    `lens census for ${mutatedSurface} claims in_ledger 0 + added ${claimed} = ${claimed} element(s) in the ledger, but elements.jsonl has ${actual}`,
  )
})
