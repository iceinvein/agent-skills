import { afterEach, beforeEach, expect, test } from 'bun:test'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', '..', 'bin', 'migrate.ts')
const FIXTURE = join(import.meta.dir, '..', '..', 'fixtures', 'tiny-express')

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
  target = await mkdtemp(join(tmpdir(), 'migrate-e2e-express-'))
  source = join(target, 'legacy')
  await cp(FIXTURE, source, { recursive: true })
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

// GROUND-TRUTH.md is the single source of what this fixture contains. Reading
// and parsing it here, rather than hand-copying its rows into this file, is
// the point: a row added to the fixture without a matching update here (or
// vice versa) cannot silently drift, because the batches below are built from
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

// Express has no recipe pack in references/recipes/ (only aspnet.md exists),
// so enumerate.md's contract-only mode applies: two independently-derived
// directions per surface, supplied by the agent instead of a recipe file.
// Both directions below find exactly the fixture's own elements, since this
// is a fixture small enough that a real agent's two directions would too.
// Every evidence string below names a command actually re-run against the
// fixture (not merely a plausible-sounding description) to confirm it
// produces the count this surface's rows carry; nothing downstream executes
// these strings, so an unverified one would sit undetected the same way a
// stale src citation's line range does.
//
// Six of the eight (routes, jobs, reports, screens, integrations, workflows)
// have both directions read the same single file; only tables and settings
// cross-reference a second one. That is a property of a fixture this small,
// not evidence of stronger independent triangulation than it actually
// carries, and nobody should cite it as the latter.
const DIRECTIONS: Record<string, [string, string]> = {
  routes: ['grep "app.(get|post)" across app.js', 'manual walk of route registrations in app.js'],
  tables: [
    'grep "CREATE TABLE" across schema.sql',
    'manual review of table names referenced in app.js, cron.js and reports/',
  ],
  jobs: ['grep "cron.schedule" across cron.js', 'manual review of cron.js'],
  reports: ['ls reports/*.json', 'manual review of report definitions under reports/'],
  screens: ['ls views/*.html', 'manual review of templates under views/'],
  integrations: ['grep "fetch(" across app.js', 'manual review of outbound HTTP calls in app.js'],
  workflows: [
    'manual review of state stored and later consumed across app.js handlers',
    'grep "pendingWelcomes" across app.js',
  ],
  settings: [
    'grep "settings\\." across app.js, excluding the require line',
    'manual review of settings.json keys',
  ],
}

// Ledger refs a lens would record per enumerate.md's Procedure, step 4:
// an element that touches one already in the ledger gets a
// {"kind": "ledger", "id": ...} entry naming it. See GROUND-TRUTH.md's
// "Element-to-element touches" section, which this map matches by hand,
// the same relationship DIRECTIONS above has to the fixture's source
// files: this is fixture metadata the test asserts against, not something
// parsed off disk.
type LedgerRef = { kind: 'ledger'; id: string }
const REFS: Record<string, LedgerRef[]> = {
  'route-get-api-users': [{ kind: 'ledger', id: 'table-users' }],
  'route-post-api-users': [{ kind: 'ledger', id: 'table-users' }],
  'job-purge-audit-log': [{ kind: 'ledger', id: 'table-audit-log' }],
  'report-daily-users': [{ kind: 'ledger', id: 'table-users' }],
  'workflow-welcome-email': [
    { kind: 'ledger', id: 'route-post-api-users' },
    { kind: 'ledger', id: 'route-get-api-users-id-welcome' },
    { kind: 'ledger', id: 'setting-welcome-email-enabled' },
  ],
}

// Builds the same graph seam.md's surface-affinity clustering builds: one
// edge per {"kind": "ledger", ...} ref on any element, connecting it to the
// id it names. An edge is an unordered pair, stored as its two ids sorted
// and joined, so a-touches-b and b-touches-a (were both ever recorded)
// would collapse to one edge rather than count twice.
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

const QUEUE_ID = 'q-tiny-express-enumerate-scaffold'

const QUEUE_ITEM = `---
id: ${QUEUE_ID}
severity: minor
status: open
---

## Evidence

This run asserts a clean \`check --phase enumerate\` before extract has run,
and coverage is a whole-store gate: it reads every element regardless of
\`--phase\`, so an element with no terminal disposition fails it at any
phase. No requirement exists yet at that point for an element to map to.

## Options

(a) Leave every element unaccounted and give up on asserting the enumerate
slice clean at all. (b) Give every element a placeholder out-of-scope
disposition citing this item, which extract then replaces with a real
\`mapped\` disposition once there is a requirement to map to.

## Recommendation

Recommend (b); it isolates the census and run-state assertions the
enumerate step exists to make from the coverage gate, and citing this item
keeps the placeholder auditable rather than silent. The item stays open
after extract supersedes it, because nothing in this milestone adjudicates
a queue item.
`

// ---------------------------------------------------------------------------
// Phase 2, seam. The partition surface-affinity clustering produces from the
// REFS above, following references/phases/seam.md's procedure rather than
// choosing capabilities by hand. Re-derived by running that manual's own
// formula over exactly the seven edges e2e asserts in step 6b:
//
//   component 1 (n=2): job-purge-audit-log, table-audit-log
//   component 2 (n=7): report-daily-users, route-get-api-users,
//     route-get-api-users-id-welcome, route-post-api-users,
//     setting-welcome-email-enabled, table-users, workflow-welcome-email
//   edgeless singletons (n=3): integration-mailer, screen-users,
//     setting-max-users-per-page
//   m (total edges) = 7
//   components-only Q = 0.245
//
// 0.245 is below the 0.3 floor, so the greedy refinement seam.md specifies
// runs on the seven-node component (every node in it starting as its own
// group, the two-node component left whole):
//
//   starting Q (component exploded to singletons) = -0.010
//   merge 1: {report-daily-users} + {table-users} -> Q = 0.102
//   merge 2: {route-get-api-users-id-welcome} + {workflow-welcome-email} -> Q = 0.214
//   merge 3: {route-get-api-users} + {report-daily-users, table-users} -> Q = 0.316
//   merge 4: {setting-welcome-email-enabled} + {route-get-api-users-id-welcome,
//     workflow-welcome-email} -> Q = 0.418
//   merge 5: {route-post-api-users} + {report-daily-users, route-get-api-users,
//     table-users} -> Q = 0.459
//   no further join raises Q; stopping
//
// Q = 0.459 >= 0.3. Express has no schema this run can cluster, no statically
// parseable call graph, and the copied fixture carries no VCS history, so
// surface-affinity is the only validator that could run at all: the
// one-validator exception, not the two-agree rule, is what licenses accepting
// this split, exactly as seam.md's first worked example describes.
//
// The three edgeless elements are assigned by hand, per seam.md's edgeless
// rule, each on the source proximity that rule names, because the graph has
// nothing to say about a node with no edges:
//   screen-users              -> user-directory (views/users.html renders the
//                                list that capability's route serves)
//   setting-max-users-per-page-> user-directory (app.js:8 is the only line
//                                that reads it, inside that capability's route)
//   integration-mailer        -> welcome-notification (app.js:21 is inside
//                                that capability's welcome handler)
type CapabilityRow = { slug: string; title: string; ns: string; elements: string[] }

const CAPABILITIES: CapabilityRow[] = [
  {
    slug: 'audit-retention',
    title: 'Audit Retention',
    ns: 'AR',
    elements: ['job-purge-audit-log', 'table-audit-log'],
  },
  {
    slug: 'user-directory',
    title: 'User Directory',
    ns: 'UD',
    elements: [
      'report-daily-users',
      'route-get-api-users',
      'route-post-api-users',
      'table-users',
      'screen-users',
      'setting-max-users-per-page',
    ],
  },
  {
    slug: 'welcome-notification',
    title: 'Welcome Notification',
    ns: 'WN',
    elements: [
      'route-get-api-users-id-welcome',
      'setting-welcome-email-enabled',
      'workflow-welcome-email',
      'integration-mailer',
    ],
  },
]

const SEAM_JSON = {
  validators: {
    'schema-clustering': { ran: false, reason: 'no relational schema this run can cluster' },
    'call-graph': { ran: false, reason: 'no static call-graph tooling in this environment' },
    'change-coupling': { ran: false, reason: 'the copied fixture carries no VCS history' },
    'surface-affinity': { ran: true, modularity: 0.459 },
  },
  agreement: ['surface-affinity'],
  modularity: 0.459,
  status: 'accepted',
}

// ---------------------------------------------------------------------------
// Phase 3, extract. One requirement per distinct behavior, at least one
// citation each, every citation's src path and line range real: the citations
// gate runs by default and resolves each one against the copied fixture, so a
// wrong line range here fails the run rather than sitting undetected.
// `parity` is null on every row, because assigning an oracle is phase 4's job;
// extract.md is explicit that the parity gate exempts nothing at confirmed or
// inferred, only at queued.
type Citation =
  | { kind: 'ledger'; id: string }
  | { kind: 'src'; path: string; lines: [number, number] }

type RequirementRow = {
  id: string
  cap: string
  requirement: string
  actors: string
  objects: string
  rules: string
  origin: string
  confidence: { kind: string; queue?: string }
  citations: Citation[]
  parity: null
}

const REQUIREMENTS: RequirementRow[] = [
  {
    id: 'UD-001',
    cap: 'user-directory',
    requirement: 'Listing users returns at most the configured maximum number of users per page',
    actors: 'API client',
    objects: 'User list',
    rules: 'The response is sliced to settings.maxUsersPerPage entries',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'route-get-api-users' },
      { kind: 'src', path: 'app.js', lines: [8, 8] },
      { kind: 'src', path: 'settings.json', lines: [1, 4] },
    ],
    parity: null,
  },
  {
    id: 'UD-002',
    cap: 'user-directory',
    requirement: 'Creating a user returns a generated id and records a pending welcome against it',
    actors: 'API client',
    objects: 'User',
    rules: 'The id is minted from the current clock; the submitted email is held against it',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'route-post-api-users' },
      { kind: 'src', path: 'app.js', lines: [10, 14] },
    ],
    parity: null,
  },
  {
    id: 'UD-003',
    cap: 'user-directory',
    requirement:
      'The users table stores an id, a required email, and an active flag defaulting to set',
    actors: '-',
    objects: 'User row',
    rules: 'email is NOT NULL; is_active defaults to 1',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'table-users' },
      { kind: 'src', path: 'schema.sql', lines: [1, 5] },
    ],
    parity: null,
  },
  {
    id: 'UD-004',
    cap: 'user-directory',
    requirement: 'The daily-users report counts only users whose active flag is set',
    actors: 'Report consumer',
    objects: 'Active user count',
    rules: 'The query filters on is_active = 1 and runs once a day',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'report-daily-users' },
      { kind: 'src', path: 'reports/daily-users.json', lines: [1, 6] },
    ],
    parity: null,
  },
  {
    id: 'UD-005',
    cap: 'user-directory',
    requirement: 'The users screen renders one list entry per user email',
    actors: 'Operator',
    objects: 'User list screen',
    rules: 'Each entry is bound to the email field',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'screen-users' },
      { kind: 'src', path: 'views/users.html', lines: [1, 9] },
    ],
    parity: null,
  },
  {
    // The one queued requirement in this run, and the reason it is queued is
    // visible in the source rather than invented: app.js:8 answers the list
    // route with a literal empty array sliced to the page cap. Nothing in the
    // checkout shows the users table ever being read, so whether this endpoint
    // is a stub or genuinely always empty is not decidable from here.
    // A queued requirement is the one case the parity gate exempts, which is
    // why this row keeps `parity: null` through phase 4 while every other row
    // gets a plan.
    id: 'UD-006',
    cap: 'user-directory',
    requirement: 'The users list endpoint reads the rows it returns from the users table',
    actors: 'API client',
    objects: 'User list',
    rules: '-',
    origin: 'intended',
    confidence: { kind: 'queued', queue: 'q-express-user-list-source' },
    citations: [
      { kind: 'ledger', id: 'route-get-api-users' },
      { kind: 'src', path: 'app.js', lines: [8, 8] },
      { kind: 'src', path: 'schema.sql', lines: [1, 5] },
    ],
    parity: null,
  },
  {
    id: 'WN-001',
    cap: 'welcome-notification',
    requirement:
      'The welcome route reports a send only when the welcome setting is enabled and a pending welcome exists for that id',
    actors: 'API client',
    objects: 'Pending welcome',
    rules: 'Both settings.welcomeEmailEnabled and a stored email must hold, or nothing is sent',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'route-get-api-users-id-welcome' },
      { kind: 'src', path: 'app.js', lines: [18, 27] },
      { kind: 'src', path: 'settings.json', lines: [1, 4] },
    ],
    parity: null,
  },
  {
    id: 'WN-002',
    cap: 'welcome-notification',
    requirement:
      'Signup and welcome are one two-step workflow carrying the pending email in process memory between the two requests',
    actors: 'API client',
    objects: 'Pending welcome state',
    rules: 'Step one writes the map entry; step two consumes it',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'workflow-welcome-email' },
      { kind: 'src', path: 'app.js', lines: [5, 6] },
      { kind: 'src', path: 'app.js', lines: [16, 19] },
    ],
    parity: null,
  },
  {
    id: 'WN-003',
    cap: 'welcome-notification',
    requirement: 'The welcome email is sent by an outbound POST to the mailer service',
    actors: 'System',
    objects: 'Welcome email',
    rules: 'The recipient address is the email held against the pending welcome',
    origin: 'intended',
    // Inferred, not confirmed: the source shows the request being made, and
    // nothing citable here shows what the mailer does with it. That is
    // extract.md's own definition of inferred, a piece genuinely unobservable
    // from a call to something outside the citable source.
    confidence: { kind: 'inferred' },
    citations: [
      { kind: 'ledger', id: 'integration-mailer' },
      { kind: 'src', path: 'app.js', lines: [21, 24] },
    ],
    parity: null,
  },
  {
    id: 'AR-001',
    cap: 'audit-retention',
    requirement: 'Audit log rows older than thirty days are purged on a nightly schedule',
    actors: 'System',
    objects: 'Audit log rows',
    rules: 'Runs at 02:00 daily; the cutoff is thirty days',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'job-purge-audit-log' },
      { kind: 'src', path: 'cron.js', lines: [3, 6] },
    ],
    parity: null,
  },
  {
    id: 'AR-002',
    cap: 'audit-retention',
    requirement: 'The audit log stores one row per user action with a creation timestamp',
    actors: '-',
    objects: 'Audit log row',
    rules: 'user_id, action and created_at are all NOT NULL',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'table-audit-log' },
      { kind: 'src', path: 'schema.sql', lines: [7, 12] },
    ],
    parity: null,
  },
]

// Every ground-truth element maps to one requirement. Asserted against the
// parsed GROUND-TRUTH.md rows below rather than trusted, so an element added
// to the fixture with no home here fails loudly instead of quietly ending the
// run unaccounted.
const DISPOSITIONS: Record<string, { kind: 'mapped'; fr: string }> = {
  'route-get-api-users': { kind: 'mapped', fr: 'UD-001' },
  'setting-max-users-per-page': { kind: 'mapped', fr: 'UD-001' },
  'route-post-api-users': { kind: 'mapped', fr: 'UD-002' },
  'table-users': { kind: 'mapped', fr: 'UD-003' },
  'report-daily-users': { kind: 'mapped', fr: 'UD-004' },
  'screen-users': { kind: 'mapped', fr: 'UD-005' },
  'route-get-api-users-id-welcome': { kind: 'mapped', fr: 'WN-001' },
  'setting-welcome-email-enabled': { kind: 'mapped', fr: 'WN-001' },
  'workflow-welcome-email': { kind: 'mapped', fr: 'WN-002' },
  'integration-mailer': { kind: 'mapped', fr: 'WN-003' },
  'job-purge-audit-log': { kind: 'mapped', fr: 'AR-001' },
  'table-audit-log': { kind: 'mapped', fr: 'AR-002' },
}

// One rule-sweep per capability, one attribute census for the only table with
// columns worth explaining, and one record per declared closer. extract.md is
// explicit that nothing gates the first two for completeness (only lens
// against [surfaces].types and closer against [closers].set), so they are here
// as the manual's discipline, not because a gate would catch their absence.
const EXTRACT_CENSUS: Record<string, unknown>[] = [
  {
    kind: 'rule-sweep',
    subject: 'user-directory',
    phase: 'extract',
    probes: 2,
    found: 1,
    as_requirements: 1,
    queued: [],
    batch: 'b-rules-user-directory-001',
  },
  {
    kind: 'rule-sweep',
    subject: 'welcome-notification',
    phase: 'extract',
    probes: 2,
    found: 1,
    as_requirements: 1,
    queued: [],
    batch: 'b-rules-welcome-notification-001',
  },
  {
    kind: 'rule-sweep',
    subject: 'audit-retention',
    phase: 'extract',
    probes: 2,
    found: 1,
    as_requirements: 1,
    queued: [],
    batch: 'b-rules-audit-retention-001',
  },
  {
    // schema.sql:1-5 declares id, email and is_active; the report query at
    // reports/daily-users.json:4 names one of them. `id` is an identity key,
    // which extract.md's exemption list keeps out of `behavioral`, leaving
    // email (UD-003) and is_active (UD-004) as the two that are explained.
    kind: 'attribute',
    surface: 'tables',
    subject: 'table-users',
    phase: 'extract',
    directions: {
      ddl: { count: 3, evidence: 'column list from CREATE TABLE users in schema.sql' },
      report_query: {
        count: 1,
        evidence: 'columns named in the query in reports/daily-users.json',
      },
    },
    total: 3,
    behavioral: 2,
    explained: 2,
    queued: [],
    batch: 'b-attr-table-users-001',
  },
  {
    // workflow-welcome-email spans route-post-api-users (user-directory) and
    // both route-get-api-users-id-welcome and setting-welcome-email-enabled
    // (welcome-notification): a genuine cross-capability seam, found and
    // covered on the spot by WN-002, which describes the whole journey rather
    // than either half.
    kind: 'closer',
    closer: 'cross-capability-workflow',
    phase: 'extract',
    checked: 1,
    findings: 1,
    fixed: 1,
    queued: [],
    batch: 'b-closer-cross-capability-001',
  },
  {
    kind: 'closer',
    closer: 'scope-injection',
    phase: 'extract',
    checked: 11,
    findings: 0,
    fixed: 0,
    queued: [],
    batch: 'b-closer-scope-injection-001',
  },
  {
    // A real finding this pass cannot resolve: app.js writes nothing to the
    // users table and reads nothing from it, so the only read on record is the
    // report's query and there is no write anywhere at all.
    kind: 'closer',
    closer: 'read-write-symmetry',
    phase: 'extract',
    checked: 11,
    findings: 1,
    fixed: 0,
    queued: ['q-express-users-table-unwired'],
    batch: 'b-closer-read-write-symmetry-001',
  },
]

// ---------------------------------------------------------------------------
// Phase 4, parity. source.basis is source-only (init's default, and the honest
// call for a copied fixture with no package.json and no installed
// dependencies), so `differential` is unavailable: it needs a live legacy
// system to diff against, and there is none. `golden-master` survives only
// where the source itself ships the artifact that determines the output, which
// parity.md names as the exception -- the DDL and the report query are exactly
// that. Everything else is `rubric`, and every rubric below `high` carries the
// queue id the refs gate checks for.
//
// Each `ref` is built from target.parity_test_path read out of config.toml at
// run time, never from the default hardcoded here, since probe.md says an
// operator may have edited it and parity.md says to read it rather than assume.
type ParityPlan =
  | { kind: 'golden-master'; capability: string; frSlug: string }
  | { kind: 'rubric'; level: string; queue?: string }

const PARITY: Record<string, ParityPlan | null> = {
  'UD-001': { kind: 'rubric', level: 'high' },
  'UD-002': { kind: 'rubric', level: 'high' },
  'UD-003': { kind: 'golden-master', capability: 'user-directory', frSlug: 'users-table' },
  'UD-004': { kind: 'golden-master', capability: 'user-directory', frSlug: 'daily-users-report' },
  'UD-005': { kind: 'rubric', level: 'high' },
  'UD-006': null,
  'WN-001': { kind: 'rubric', level: 'high' },
  'WN-002': { kind: 'rubric', level: 'high' },
  'WN-003': { kind: 'rubric', level: 'moderate', queue: 'q-express-mailer-delivery-unobservable' },
  'AR-001': { kind: 'rubric', level: 'high' },
  'AR-002': { kind: 'golden-master', capability: 'audit-retention', frSlug: 'audit-log-table' },
}

const DELTA = {
  id: 'delta-mailer-provider-swap',
  scope: 'Outbound welcome email delivery (WN-003)',
  rationale:
    'The legacy app posts straight to mailer.example.com from inside the request handler. The target sends through its own provider, so the outbound request differs by destination and headers for reasons that have nothing to do with whether a welcome was owed.',
  parity_exclusion:
    'The WN-003 parity check must not assert on the mailer endpoint or the shape of the request sent to it, only that a send was attempted for an enabled, pending welcome.',
  validation:
    'A greenfield-only test asserts the target provider is called with the right recipient; the parity suite does not re-prove the transport.',
  owner_signed: null as string | null,
}

// Every queue item this run files beyond the enumerate scaffold, each one named
// by something real: two by a field the refs gate checks (UD-006's
// confidence.queue and WN-003's parity.queue), one by a closer census's own
// `queued` array, which queue.md is explicit that no gate ever cross-checks.
// Filed anyway, because that is the manual's discipline.
const QUEUE_ITEMS: Record<string, string> = {
  'q-express-user-list-source': `---
id: q-express-user-list-source
severity: moderate
status: open
---

## Evidence

\`app.js:8\` answers \`GET /api/users\` with \`[].slice(0, settings.maxUsersPerPage)\`:
a literal empty array, capped at the configured page size. Nothing anywhere
in the checkout opens a database connection or reads the \`users\` table that
\`schema.sql:1-5\` declares.

## Options

(a) Treat the endpoint as a stub and write the requirement against the table
the schema declares. (b) Treat the empty list as the real behavior and
record that the table is unread. (c) Ask the operator which one production
actually served.

## Recommendation

Recommend (c); the route and the schema disagree about whether this endpoint
has a data source, and nothing in the source settles it either way.
`,
  'q-express-mailer-delivery-unobservable': `---
id: q-express-mailer-delivery-unobservable
severity: moderate
status: open
---

## Evidence

\`WN-003\` describes the outbound POST at \`app.js:21-24\` to
\`https://mailer.example.com/send\`. The basis for this run is source-only, so
there is no live legacy system to diff against and nothing to capture a
golden master from, and the call crosses a boundary neither could reach in
any case.

## Options

(a) Ship \`rubric:low\` and revisit if a runnable environment appears.
(b) Block parity on this requirement until the mailer can be observed.
(c) Ship \`rubric:moderate\`: the guard conditions and the recipient are both
readable from the source, the delivery itself is not.

## Recommendation

Recommend (c); \`rubric:moderate\` matches exactly what is observable today.
`,
  'q-express-users-table-unwired': `---
id: q-express-users-table-unwired
severity: moderate
status: open
---

## Evidence

The \`read-write-symmetry\` closer checked every write path against a matching
read path. \`schema.sql:1-5\` declares a \`users\` table;
\`reports/daily-users.json:4\` reads it; nothing in \`app.js\` or \`cron.js\`
writes to it, and \`POST /api/users\` at \`app.js:10-14\` persists nothing at
all beyond an in-memory map entry.

## Options

(a) Treat the table as write-only-by-something-outside-this-checkout and
widen the search. (b) Treat it as a real gap for the target to fix rather
than replicate. (c) Ask the operator whether user rows were ever written by
this application.

## Recommendation

Recommend (c); a table with a reader and no writer anywhere in the checkout
is exactly what this closer exists to surface, and only the operator can say
whether the writer is missing or merely elsewhere.
`,
}

// Substitutes a parity plan into the row shape `migrate import reqs` accepts.
// `{capability}` and `{fr_slug}` come from target.parity_test_path as read off
// config.toml; parity.md is explicit that nothing in the CLI derives an
// fr_slug or checks a ref against the template, so this substitution is the
// whole of the convention.
function renderParity(plan: ParityPlan | null, template: string): Record<string, unknown> | null {
  if (plan === null) return null
  if (plan.kind === 'rubric') {
    return { kind: 'rubric', level: plan.level, ...(plan.queue ? { queue: plan.queue } : {}) }
  }
  const ref = template
    .replaceAll('{capability}', plan.capability)
    .replaceAll('{fr_slug}', plan.frSlug)
  return { kind: 'golden-master', ref }
}

function readTomlString(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))
  if (!match?.[1]) throw new Error(`config.toml has no ${key}`)
  return match[1]
}

test('contract-only run driven probe through handoff, ending green at a plain check', async () => {
  const groundTruthPath = join(source, 'GROUND-TRUTH.md')
  const rows = await parseGroundTruth(groundTruthPath)
  expect(rows.length).toBeGreaterThan(0)
  const groups = groupBySurface(rows)

  // 1. migrate init.
  const init = await migrate([
    'init',
    '--source',
    source,
    '--scope',
    'the whole tiny app',
    '--name',
    'tiny-next',
    '--source-stack',
    'express',
  ])
  expect(init.code).toBe(0)

  // Both defaults init wrote are left exactly as they are: the eight surface
  // types, because exercising all eight is this fixture's whole point, and the
  // three closers, because this run reaches extract and therefore owes a
  // closer census record for each one. parity_test_path is read back rather
  // than assumed, per probe.md and parity.md, since an operator may have
  // edited it and nothing downstream would notice.
  const cfgPath = join(target, '.migrate', 'config.toml')
  const cfg = await readFile(cfgPath, 'utf8')
  const parityTemplate = readTomlString(cfg, 'parity_test_path')
  expect(parityTemplate).toContain('{capability}')
  expect(parityTemplate).toContain('{fr_slug}')

  // 2. migrate phase probe --status done.
  expect((await migrate(['phase', 'probe', '--status', 'done'])).code).toBe(0)

  // File the queue item every element's placeholder disposition below cites.
  // See QUEUE_ITEM for why: coverage is a whole-store gate, so a clean check
  // bound at --phase enumerate (step 6) still needs every element disposed,
  // even though disposing elements is ordinarily extract's job.
  const queuePath = await writeText(`${QUEUE_ID}.md`, QUEUE_ITEM)
  expect((await migrate(['queue', 'add', queuePath])).code).toBe(0)

  // 3. migrate import elements, one batch per surface, rows from GROUND-TRUTH.md.
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

  // 4. migrate census, one balanced lens record per surface, two directions each.
  for (const [surface, surfaceRows] of groups) {
    const count = surfaceRows.length
    const [a, b] = DIRECTIONS[surface] ?? ['direction a', 'direction b']
    const record = await write(`census-${surface}.json`, {
      kind: 'lens',
      surface,
      phase: 'enumerate',
      directions: {
        grep: { count, evidence: a },
        manual: { count, evidence: b },
      },
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

  // 5. migrate phase enumerate --status done.
  expect((await migrate(['phase', 'enumerate', '--status', 'done'])).code).toBe(0)

  // 6. migrate check --phase enumerate. Every gate this phase owns is clean,
  // and the only violations left are the three declared closers, whose
  // records belong to extract and do not exist yet: exactly the mid-run
  // posture enumerate.md describes, where the census gate reads the whole
  // store regardless of --phase. Asserting the count pins that down harder
  // than asserting cleanliness would, because it fails if anything else
  // starts failing too.
  //
  // Note this holds despite the workflows batch (imported before the settings
  // batch, in GROUND-TRUTH.md's row order) citing setting-welcome-email-enabled
  // before that element exists yet: nothing in `import elements` or `check`
  // resolves a `ledger` ref against the ledger, so a dangling one mid-run is
  // silently tolerated, exactly as enumerate.md's step 4 says. It has resolved
  // by the time this check runs, since every surface has imported by now.
  const enumerated = await migrate(['check', '--phase', 'enumerate'])
  expect(enumerated.out).toContain(
    `0/${rows.length} mapped, ${rows.length} out-of-scope, 0 unaccounted`,
  )
  expect(enumerated.out).toContain('Violations (3):')
  expect(enumerated.out).toContain('  census:')
  for (const closer of ['cross-capability-workflow', 'scope-injection', 'read-write-symmetry']) {
    expect(enumerated.out).toContain(`    declared closer ${closer} has no census record`)
  }
  expect(enumerated.code).toBe(1)

  // 6b. Surface-affinity clustering's graph, built straight from the store
  // the same way seam.md's worked example builds it. This is the assertion
  // that would fail if enumerate's ref-recording step were skipped: an
  // empty REFS map above would leave every element's refs empty, and this
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
    ['job-purge-audit-log', 'table-audit-log'],
    ['report-daily-users', 'table-users'],
    ['workflow-welcome-email', 'route-post-api-users'],
    ['workflow-welcome-email', 'route-get-api-users-id-welcome'],
    ['workflow-welcome-email', 'setting-welcome-email-enabled'],
  ].map(([a, b]) => [a, b].sort().join('|'))
  for (const edge of expectedEdges) {
    expect(edges.has(edge)).toBe(true)
  }
  expect(edges.size).toBe(expectedEdges.length)

  // 7. Phase 2, seam. No CLI verb authors any of the three artifacts, so all
  // three are written by hand here exactly as seam.md says a real run writes
  // them. The partition is asserted to be a partition of the ground truth
  // first: every element in exactly one capability, nothing invented, nothing
  // dropped. No gate checks that (nothing reads capabilities.elements at all),
  // which is precisely why the assertion is here.
  const assigned = CAPABILITIES.flatMap((c) => c.elements)
  expect([...assigned].sort()).toEqual(rows.map((r) => r.id).sort())
  expect(new Set(assigned).size).toBe(assigned.length)

  const storeDir = join(target, '.migrate')
  await writeFile(
    join(storeDir, 'capabilities.jsonl'),
    `${CAPABILITIES.map((c) => JSON.stringify(c)).join('\n')}\n`,
  )
  await writeFile(join(storeDir, 'seam.json'), `${JSON.stringify(SEAM_JSON, null, 2)}\n`)
  await writeFile(
    join(storeDir, 'seam.md'),
    '# Seam evidence\n\nsurface-affinity clustering over the ledger refs, connected components then the\ngreedy modularity refinement, Q = 0.459. The other three validators could not\nrun: no relational schema, no static call graph, no VCS history in the copied\nfixture.\n',
  )
  expect((await migrate(['phase', 'seam', '--status', 'done'])).code).toBe(0)

  // 8. Phase 3, extract. Requirements first, then the disposition write-back
  // as its own elements batch, which extract.md calls out as the only writer
  // of a resolved disposition.
  for (const id of Object.keys(DISPOSITIONS)) {
    expect(rows.some((r) => r.id === id)).toBe(true)
  }
  expect(Object.keys(DISPOSITIONS).length).toBe(rows.length)

  const reqBatch = await write('reqs.json', {
    batch: 'b-reqs-extract-001',
    phase: 'extract',
    rows: REQUIREMENTS,
  })
  const reqImport = await migrate(['import', 'reqs', reqBatch])
  expect(reqImport.code).toBe(0)
  expect(reqImport.out).toContain(
    `import reqs: ${REQUIREMENTS.length} added, 0 updated, batch b-reqs-extract-001`,
  )

  // The queue items UD-006's confidence and the read-write-symmetry closer
  // name, filed before anything checks them: a queue id with no file behind it
  // is a present violation the moment `check` runs, not a future one.
  for (const [id, body] of Object.entries(QUEUE_ITEMS)) {
    const path = await writeText(`${id}.md`, body)
    const added = await migrate(['queue', 'add', path])
    expect(added.code).toBe(0)
    expect(added.out).toContain(`queue add: ${id}`)
  }

  const disposed = await write('elements-disposed.json', {
    batch: 'b-elements-disposition-001',
    phase: 'extract',
    rows: rows.map((row) => ({
      id: row.id,
      surface: row.surface,
      element: row.element,
      found_by: ['code'],
      disposition: DISPOSITIONS[row.id],
      refs: REFS[row.id] ?? [],
      lens: 'code',
      notes: '',
    })),
  })
  const disposeImport = await migrate(['import', 'elements', disposed])
  expect(disposeImport.code).toBe(0)
  expect(disposeImport.out).toContain(`import elements: 0 added, ${rows.length} updated`)

  for (const record of EXTRACT_CENSUS) {
    const path = await write(`census-${record.batch}.json`, record)
    const result = await migrate(['census', path])
    expect(result.code).toBe(0)
  }
  expect((await migrate(['phase', 'extract', '--status', 'done'])).code).toBe(0)

  // 9. Phase 4, parity. The delta goes in unsigned first, so the deltas gate
  // is shown failing on it before it is shown clean: an unsigned exclusion is
  // exactly what that gate exists to stop from accreting silently.
  const unsigned = await write('deltas.json', {
    batch: 'b-deltas-parity-001',
    phase: 'parity',
    rows: [DELTA],
  })
  expect((await migrate(['import', 'deltas', unsigned])).code).toBe(0)
  const withUnsignedDelta = await migrate(['check', '--phase', 'parity'])
  expect(withUnsignedDelta.code).toBe(1)
  expect(withUnsignedDelta.out).toContain('  deltas:')
  expect(withUnsignedDelta.out).toContain(`    ${DELTA.id} is not owner-signed`)

  const signed = await write('deltas-signed.json', {
    batch: 'b-deltas-parity-002',
    phase: 'parity',
    rows: [{ ...DELTA, owner_signed: '2026-08-08' }],
  })
  expect((await migrate(['import', 'deltas', signed])).code).toBe(0)

  const parityBatch = await write('reqs-parity.json', {
    batch: 'b-reqs-parity-001',
    phase: 'parity',
    rows: REQUIREMENTS.map((r) => ({
      ...r,
      parity: renderParity(PARITY[r.id] ?? null, parityTemplate),
    })),
  })
  const parityImport = await migrate(['import', 'reqs', parityBatch])
  expect(parityImport.code).toBe(0)
  // Every row counts as updated, including UD-006, whose parity stays null:
  // the importer stamps its own batch id onto every row it writes, so a row
  // whose content is otherwise unchanged still differs from the one on disk.
  expect(parityImport.out).toContain(
    `import reqs: 0 added, ${REQUIREMENTS.length} updated, batch b-reqs-parity-001`,
  )
  expect((await migrate(['phase', 'parity', '--status', 'done'])).code).toBe(0)

  // 10. Phase 5, queue. Every item this run owed was filed in the pass that
  // named it, so this phase closes on the status flip, exactly as queue.md
  // says: closing is not "the queue is empty", since nothing in this milestone
  // adjudicates an item.
  const listed = await migrate(['queue', 'list', '--open'])
  expect(listed.code).toBe(0)
  expect(listed.out).toContain(`${Object.keys(QUEUE_ITEMS).length + 1} item(s)`)
  expect((await migrate(['phase', 'queue', '--status', 'done'])).code).toBe(0)

  // 11. The terminus. Every element mapped, every gate clean, exit 0.
  const green = await migrate(['check', '--phase', 'queue'])
  expect(green.out).toContain(`${rows.length}/${rows.length} mapped, 0 out-of-scope, 0 unaccounted`)
  expect(green.out).not.toContain('Violations')
  expect(green.code).toBe(0)

  // 12. Plain `migrate check` gates every phase through handoff. A run that
  // stops at the queue fails it on three distinct fronts, and naming each one
  // is what makes this an assertion rather than a hope: the two phases still
  // pending, every queue item nobody has ruled on, and the handoff that never
  // emitted anything.
  const full = await migrate(['check'])
  expect(full.code).toBe(1)
  expect(full.out).toContain('  run-state:')
  expect(full.out).toContain(
    '    phase adjudicate is pending; every phase through handoff must be done',
  )
  expect(full.out).toContain(
    '    phase handoff is pending; every phase through handoff must be done',
  )
  expect(full.out).toContain('  adjudication:')
  expect(full.out).toContain('is still open; every queue item needs a ruling before handoff')
  expect(full.out).toContain('  handoff:')
  expect(full.out).toContain('no handoff.json in the store')

  // 13. The terminus assertion in step 11 is load-bearing, shown by mutation
  // rather than asserted: nulling every requirement's parity plan is a phase-4
  // regression and nothing else, and it must break the green check. Restoring
  // the file returns it to green, which is what proves the mutation was the
  // only cause.
  const requirementsPath = join(storeDir, 'requirements.jsonl')
  const requirementsText = await readFile(requirementsPath, 'utf8')
  const stripped = requirementsText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.stringify({ ...(JSON.parse(line) as object), parity: null }))
  await writeFile(requirementsPath, `${stripped.join('\n')}\n`)

  const noParity = await migrate(['check', '--phase', 'queue'])
  expect(noParity.code).toBe(1)
  expect(noParity.out).toContain('  parity:')
  expect(noParity.out).toContain('    UD-001 has no parity plan')
  // UD-006 is `queued`, the one confidence the parity gate exempts, so it must
  // not appear even now that its plan is null like everyone else's.
  expect(noParity.out).not.toContain('UD-006 has no parity plan')

  await writeFile(requirementsPath, requirementsText)
  expect((await migrate(['check', '--phase', 'queue'])).code).toBe(0)

  // 14. Removing one element row breaks the census reconciliation for its
  // surface, and only that: `in_ledger + added` on the surviving census
  // record still claims the pre-mutation count, but elements.jsonl now has
  // one fewer row for that surface. This is what makes the enumerate-phase
  // arithmetic load-bearing rather than vacuous: if the reconciliation check
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
  await writeFile(elementsPath, elementsText)
  expect((await migrate(['check', '--phase', 'queue'])).code).toBe(0)

  // 15. Phase 6, adjudicate. The review sheet first, because that is how the
  // phase is meant to be worked: one pass over every open item with its
  // recommendation in view, rather than opening four files.
  const sheet = await migrate(['adjudicate'])
  expect(sheet.code).toBe(0)
  expect(sheet.out).toContain(`${Object.keys(QUEUE_ITEMS).length + 1} open`)
  for (const id of [...Object.keys(QUEUE_ITEMS), QUEUE_ID]) {
    expect(sheet.out).toContain(`${id} [`)
  }

  const RULINGS: Record<string, string> = {
    'q-express-user-list-source':
      'the empty list is the real behaviour; the table stays unread and unmapped',
    'q-express-mailer-delivery-unobservable':
      'accept the rubric at moderate; delivery is unobservable from the source alone',
    'q-express-users-table-unwired': 'the table is in scope and stays mapped to UD-002',
    [QUEUE_ID]: 'the scaffold row is enumeration noise and is skipped by name',
  }
  for (const [id, ruling] of Object.entries(RULINGS)) {
    const ruled = await migrate(['adjudicate', id, '--ruling', ruling])
    expect(ruled.code).toBe(0)
    expect(ruled.out).toContain('open -> adjudicated')
  }
  // Re-ruling one of them refuses without --force, so an owner's recorded
  // decision cannot be replaced by a re-run that meant no harm.
  const reruled = await migrate(['adjudicate', QUEUE_ID, '--ruling', 'something else'])
  expect(reruled.code).toBe(1)
  expect(reruled.err).toContain('--force')

  expect((await migrate(['adjudicate'])).out).toContain('0 open')
  expect((await migrate(['phase', 'adjudicate', '--status', 'done'])).code).toBe(0)

  // 16. Phase 7, handoff. UD-006 still carries a `queued` confidence, and its
  // queue item is now adjudicated, so it no longer blocks: that is the whole
  // point of measuring blockers against open items rather than against the
  // confidence field.
  const dry = await migrate(['handoff', '--dry-run'])
  expect(dry.code).toBe(0)
  expect(dry.out).toContain('plan:')
  expect(dry.out).toContain('nothing written')
  expect(await Bun.file(join(storeDir, 'handoff.json')).exists()).toBe(false)

  const emitted = await migrate(['handoff'])
  expect(emitted.code).toBe(0)
  expect(emitted.out).toContain('adapter markdown')

  const handoffFile = JSON.parse(await readFile(join(storeDir, 'handoff.json'), 'utf8'))
  expect(handoffFile.basis.emitted).toBe(REQUIREMENTS.length)
  // Every capability the seam declared reached a work item.
  expect(handoffFile.items).toHaveLength(CAPABILITIES.length)
  const roadmapPath = join(target, 'docs', 'migrate', 'roadmap.md')
  const roadmap = await readFile(roadmapPath, 'utf8')
  for (const r of REQUIREMENTS) expect(roadmap).toContain(`- [ ] ${r.id} `)

  expect((await migrate(['phase', 'handoff', '--status', 'done'])).code).toBe(0)

  // 17. The milestone's acceptance proof. Plain `migrate check`, with no
  // --phase, gating every phase through handoff, exits 0. This is the first
  // time in the project's history that the unbounded gate can pass at all.
  const complete = await migrate(['check'])
  expect(complete.out).not.toContain('Violations')
  expect(complete.code).toBe(0)

  // 18. Coverage, read back through the adapter that emitted the work. Two
  // boxes ticked by hand, one dated and one not, which is what an owner
  // actually does to a roadmap.
  const built = ['UD-001', 'UD-002']
  let ticked = roadmap
  ticked = ticked.replace(`- [ ] ${built[0]} `, `- [x] ${built[0]} (2026-08-10) `)
  ticked = ticked.replace(`- [ ] ${built[1]} `, `- [x] ${built[1]} (2026-08-12) `)
  await writeFile(roadmapPath, ticked)

  const coverage = await migrate(['coverage'])
  expect(coverage.code).toBe(0)
  expect(coverage.out).toContain('evidence: markdown roadmap checkboxes, dated in file')
  // The fixture carries two non-confirmed requirements, UD-006 (`queued`) and
  // one inferred. Both sit outside the confirmed denominator and are reported
  // as exclusions rather than counted against delivery: parity is a promise
  // about behaviour the run confirmed.
  expect(coverage.out).toContain(
    'excluded: 2 non-confirmed (user-directory 1, welcome-notification 1)',
  )
  expect(coverage.out).toMatch(/built 2\/\d+ confirmed requirements/)

  // Re-running handoff after the boxes were ticked must not erase them. This
  // is the data-loss regression the markdown adapter exists to avoid, checked
  // here against a real store rather than a unit fixture.
  expect((await migrate(['handoff'])).code).toBe(0)
  const afterRerun = await readFile(roadmapPath, 'utf8')
  expect(afterRerun).toContain(`- [x] ${built[0]} (2026-08-10) `)
  expect(afterRerun).toContain(`- [x] ${built[1]} (2026-08-12) `)

  // 19. Forecast. It refuses before the owner has attested anything, which is
  // the difference between a projection and a guess.
  const unattested = await migrate(['forecast'])
  expect(unattested.code).toBe(1)
  expect(unattested.err).toContain('forecast-assumptions.md')

  await writeFile(
    join(storeDir, 'forecast-assumptions.md'),
    [
      '---',
      'attestedBy: e2e',
      'attestedDate: 2026-08-13',
      '---',
      '',
      '## Territories',
      '',
      '| capability | territory |',
      '| --- | --- |',
      ...CAPABILITIES.map((c) => `| ${c.slug} | established |`),
      '',
      '## Multipliers',
      '',
      '| territory | multiplier |',
      '| --- | --- |',
      '| established | 1.0 |',
      '',
      '## Scenarios',
      '',
      '| label | rate | streams | tax | note |',
      '| --- | --- | --- | --- | --- |',
      '| steady | as-is | 1 | 0 | measured |',
      '| target | 2 | 1 | 0 | owner target |',
      '',
      '## Caveats',
      '',
      '- The fixture is not a real campaign.',
      '',
    ].join('\n'),
  )

  const forecast = await migrate(['forecast'])
  expect(forecast.code).toBe(0)
  expect(forecast.out).toContain('attested by e2e on 2026-08-13')
  // Two dated completions is exactly the minimum, so the measured rows
  // project; the target row is labelled as owner-attested either way.
  expect(forecast.out).toContain('target (owner-attested, nothing measures this)')
  expect(forecast.out).toContain('The fixture is not a real campaign.')

  // 20. The acceptance proof is load-bearing, shown by mutation: reopening one
  // queue item must break the plain check that step 17 asserted, and only on
  // the adjudication gate.
  const reopenPath = join(storeDir, 'queue', `${QUEUE_ID}.md`)
  const ruledText = await readFile(reopenPath, 'utf8')
  await writeFile(reopenPath, ruledText.replace('status: adjudicated', 'status: open'))
  const reopened = await migrate(['check'])
  expect(reopened.code).toBe(1)
  expect(reopened.out).toContain('  adjudication:')
  expect(reopened.out).toContain(QUEUE_ID)
  await writeFile(reopenPath, ruledText)
  expect((await migrate(['check'])).code).toBe(0)
})
