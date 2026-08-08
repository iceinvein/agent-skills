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
// names. Site.master gives both nav probes (reports and screens) a real
// master page to find real content in, not an absence to report against: a
// real WebForms app ships a master page, and this fixture's screens/nav
// direction has to discriminate a real screen link from a real report link
// sitting in the same file, not merely report zero because none exist. A
// direction whose probe found nothing on this fixture (hangfire,
// migrationBuilder, WCF, multi-step controller flow) is still recorded as a
// real zero, per enumerate.md's zero-findings rule, not omitted: this
// fixture simply does not use Hangfire, EF migrations, WCF, or MVC-style
// wizard actions, and the recipe says as much about several of these
// already (jobs' Hangfire direction is a documented gap for DI-registered
// jobs, which this fixture is not).
const DIRECTIONS: Record<string, Record<string, { count: number; evidence: string }>> = {
  routes: {
    // Raw match count is 7 (1 RoutePrefix + 2 lines per action x 3 actions,
    // since every action here uses the split verb-attribute-then-Route-attribute
    // form): excluding the RoutePrefix line (it annotates no action) leaves 6,
    // and deduping each action's two lines down to the one action they both
    // annotate leaves 3, the real count this direction reports.
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
    // Raw match count is 4: a bracket-quoted [dbo].[Users] read, a plain
    // INSERT INTO Users, a schema-qualified DELETE FROM dbo.AuditLog, and one
    // block-comment continuation line naming a table that does not exist
    // (LegacyUsers) which survives the probe's // -only comment filter (it
    // starts with " * ", not "//") and must be excluded by classification,
    // not by the regex. 2 real tables, both already known from DDL.
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
    // Site.master's nav carries a real "Daily active users report" link: 1
    // real match, already known from the disk direction above.
    nav: {
      count: 1,
      evidence:
        "rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*.master' -g '*Nav*.cshtml' -g '*Menu*.cshtml' -i 'report' <source>",
    },
  },
  screens: {
    filesystem: {
      count: 2,
      evidence: "find <source> -type f \\( -name '*.aspx' -o -name '*.cshtml' \\)",
    },
    // Raw match count is 3: Site.master's Home and Users NavigateUrl links
    // (2 real screens, both already known from the filesystem direction) and
    // one href pointing at the reports nav entry above, which names a report
    // path, not a screen, and must be excluded by classification. 2 real
    // screens.
    nav: {
      count: 2,
      evidence:
        "rg -n -g '*.sitemap' -g '_Layout.cshtml' -g '*.master' -g '*Nav*.cshtml' -g '*Menu*.cshtml' '(url|href|NavigateUrl)=\"~/|Html\\.ActionLink\\(|Url\\.Action\\(' <source>",
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
  // enumerate.md step 4's own canonical example: "a screen that posts to a
  // route" (route-post-api-users, wired for real via Default.aspx.cs calling
  // UsersController.CreateUser directly) and the analogous read-side case
  // (route-get-api-users-id-welcome, wired via Users.aspx.cs calling
  // UsersController.GetWelcomeStatus directly).
  'screen-default': [{ kind: 'ledger', id: 'route-post-api-users' }],
  'screen-users': [{ kind: 'ledger', id: 'route-get-api-users-id-welcome' }],
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

This run asserts the enumerate slice before extract has run, and coverage is
a whole-store gate: it reads every element regardless of \`--phase\`, so an
element with no terminal disposition fails it at any phase. No requirement
exists yet at that point for an element to map to.

## Options

(a) Leave every element unaccounted and give up on asserting the enumerate
slice at all. (b) Give every element a placeholder out-of-scope disposition
citing this item, which extract then replaces with a real disposition once
there is a requirement to map to.

## Recommendation

Recommend (b); it isolates the census and run-state assertions the enumerate
step exists to make from the coverage gate, and citing this item keeps the
placeholder auditable rather than silent. The item stays open after extract
supersedes it, because nothing in this milestone adjudicates a queue item.
`

// ---------------------------------------------------------------------------
// Phase 2, seam. The partition is the one references/phases/seam.md's second
// worked example derives and prints in full, from exactly the ten edges step
// 7b asserts below: components-only Q = 0.180, under the 0.3 floor, so the
// greedy refinement runs on the ten-node component and reaches Q = 0.505. The
// manual carries the merge ladder; it is not repeated here, because a second
// copy of it is a second thing to keep true.
//
// The four edgeless elements are assigned by hand per seam.md's edgeless rule,
// each on the source proximity that rule names:
//   route-default-aspx                 -> signup (it is Default.aspx, and
//                                         screen-default is that file's
//                                         rendered half)
//   route-users-aspx                   -> welcome-activation (same, for
//                                         Users.aspx and screen-users)
//   setting-nightly-digest-cutoff-days -> audit-retention
//                                         (Jobs/NightlyDigestJob.cs:13 is the
//                                         only line that reads it)
// and the fourth is seam.md's own named exception: setting-default-connection
// is read at Controllers/UsersController.cs:17 and Jobs/NightlyDigestJob.cs:14,
// two lines that between them serve three of the four capabilities, so no
// capability has a claim the others do not. It joins none of them on purpose,
// gets a queue item, and extract disposes of it out-of-scope citing that item.
type CapabilityRow = { slug: string; title: string; ns: string; elements: string[] }

const CAPABILITIES: CapabilityRow[] = [
  {
    slug: 'welcome-activation',
    title: 'Welcome Activation',
    ns: 'WA',
    elements: [
      'integration-billing-sync',
      'route-get-api-users-id-welcome',
      'screen-users',
      'route-users-aspx',
    ],
  },
  {
    slug: 'audit-retention',
    title: 'Audit Retention',
    ns: 'AR',
    elements: ['job-nightly-digest', 'table-audit-log', 'setting-nightly-digest-cutoff-days'],
  },
  {
    slug: 'user-directory',
    title: 'User Directory',
    ns: 'UD',
    elements: ['report-daily-users', 'route-get-api-users', 'table-users'],
  },
  {
    slug: 'signup',
    title: 'Signup',
    ns: 'SU',
    elements: [
      'route-post-api-users',
      'screen-default',
      'setting-welcome-email-enabled',
      'workflow-signup-welcome',
      'route-default-aspx',
    ],
  },
]

// Deliberately in no capability, per seam.md's exception. Held as its own
// constant so the partition assertion below has to name it explicitly rather
// than a missing element slipping through as an off-by-one.
const UNASSIGNED = ['setting-default-connection']

const SEAM_JSON = {
  validators: {
    'schema-clustering': { ran: false, reason: 'no live database to read foreign keys from' },
    'call-graph': { ran: false, reason: 'no static C# call-graph tooling in this environment' },
    'change-coupling': { ran: false, reason: 'the copied fixture carries no VCS history' },
    'surface-affinity': { ran: true, modularity: 0.505 },
  },
  agreement: ['surface-affinity'],
  modularity: 0.505,
  status: 'accepted',
}

// ---------------------------------------------------------------------------
// Phase 3, extract. Every src citation's path and line range is real: the
// citations gate runs by default and resolves each one against the copied
// fixture, so a wrong range fails the run rather than sitting undetected.
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
    id: 'SU-001',
    cap: 'signup',
    requirement:
      'The signup screen submits an email address to the user-creation route in process and redirects to the users page',
    actors: 'Visitor',
    objects: 'Signup form',
    rules: 'The redirect target is ~/Users.aspx',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'screen-default' },
      { kind: 'src', path: 'Default.aspx.cs', lines: [8, 12] },
      { kind: 'src', path: 'Default.aspx', lines: [1, 7] },
    ],
    parity: null,
  },
  {
    id: 'SU-002',
    cap: 'signup',
    requirement:
      'Creating a user inserts an active row and stores a pending welcome in session keyed by the new id',
    actors: 'API client',
    objects: 'User',
    rules: 'IsActive is set to 1 on insert; the id is minted from the current clock',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'route-post-api-users' },
      { kind: 'src', path: 'Controllers/UsersController.cs', lines: [38, 51] },
    ],
    parity: null,
  },
  {
    id: 'SU-003',
    cap: 'signup',
    requirement:
      'Signup then welcome is a two-page workflow carrying the pending email in session between the two pages',
    actors: 'Visitor',
    objects: 'Pending welcome state',
    rules: 'The session key is PendingWelcome_ plus the new user id',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'workflow-signup-welcome' },
      { kind: 'src', path: 'Controllers/UsersController.cs', lines: [49, 49] },
      { kind: 'src', path: 'Users.aspx.cs', lines: [8, 12] },
    ],
    parity: null,
  },
  {
    id: 'SU-004',
    cap: 'signup',
    requirement: 'WelcomeEmailEnabled decides whether a welcome check notifies anything at all',
    actors: '-',
    objects: 'Welcome setting',
    rules: 'The value is compared against the literal string "true"',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'setting-welcome-email-enabled' },
      { kind: 'src', path: 'web.config', lines: [3, 6] },
      { kind: 'src', path: 'Controllers/UsersController.cs', lines: [58, 59] },
    ],
    parity: null,
  },
  {
    id: 'WA-001',
    cap: 'welcome-activation',
    requirement:
      'Checking a welcome status notifies the billing system when the welcome setting is enabled and a pending welcome exists for that id',
    actors: 'API client',
    objects: 'Activation notification',
    rules: 'Both the setting and a stored email must hold, or nothing is notified',
    origin: 'intended',
    // Inferred rather than confirmed: the source shows the POST being made and
    // nothing citable here shows what the billing system does with it, which
    // is extract.md's own definition of a piece unobservable from the source.
    confidence: { kind: 'inferred' },
    citations: [
      { kind: 'ledger', id: 'route-get-api-users-id-welcome' },
      { kind: 'src', path: 'Controllers/UsersController.cs', lines: [53, 61] },
      { kind: 'src', path: 'Integrations/BillingClient.cs', lines: [10, 14] },
    ],
    parity: null,
  },
  {
    id: 'WA-002',
    cap: 'welcome-activation',
    requirement: 'The users page checks the welcome status of the id in its query string on load',
    actors: 'Visitor',
    objects: 'Users page',
    rules: 'A missing id parameter is read as 0',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'screen-users' },
      { kind: 'src', path: 'Users.aspx.cs', lines: [8, 12] },
      { kind: 'src', path: 'Users.aspx', lines: [1, 8] },
    ],
    parity: null,
  },
  {
    // The one queued requirement in this run, and the ambiguity is in the
    // source rather than invented: GetUsers returns the reader itself out of a
    // `using` block that disposes the connection on the way out, so whether
    // this endpoint ever served rows is not decidable from the checkout.
    // A queued requirement is the one case the parity gate exempts, which is
    // why this row keeps `parity: null` through phase 4.
    id: 'UD-001',
    cap: 'user-directory',
    requirement: 'Listing users returns the id and email of active users only',
    actors: 'API client',
    objects: 'User list',
    rules: 'The query filters on IsActive = 1',
    origin: 'intended',
    confidence: { kind: 'queued', queue: 'q-webforms-getusers-reader-lifetime' },
    citations: [
      { kind: 'ledger', id: 'route-get-api-users' },
      { kind: 'src', path: 'Controllers/UsersController.cs', lines: [23, 32] },
    ],
    parity: null,
  },
  {
    id: 'UD-002',
    cap: 'user-directory',
    requirement:
      'The Users table stores an id, a required email, and an active flag defaulting to set',
    actors: '-',
    objects: 'User row',
    rules: 'Email is NOT NULL; IsActive defaults to 1',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'table-users' },
      { kind: 'src', path: 'Schema.sql', lines: [1, 5] },
    ],
    parity: null,
  },
  {
    id: 'UD-003',
    cap: 'user-directory',
    requirement: 'The daily users report counts only users whose active flag is set',
    actors: 'Report consumer',
    objects: 'Active user count',
    rules: 'The dataset query filters on IsActive = 1',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'report-daily-users' },
      { kind: 'src', path: 'Reports/DailyUsers.rdl', lines: [3, 9] },
    ],
    parity: null,
  },
  {
    id: 'AR-001',
    cap: 'audit-retention',
    requirement:
      'Audit log rows older than the configured cutoff are deleted on a nightly schedule',
    actors: 'System',
    objects: 'Audit log rows',
    rules: 'The Quartz trigger fires at 02:00 daily; the cutoff comes from configuration',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'job-nightly-digest' },
      { kind: 'src', path: 'Jobs/NightlyDigestJob.cs', lines: [11, 22] },
      { kind: 'src', path: 'Jobs/NightlyDigestJob.cs', lines: [27, 31] },
    ],
    parity: null,
  },
  {
    id: 'AR-002',
    cap: 'audit-retention',
    requirement: 'The AuditLog table stores one row per user action with a creation timestamp',
    actors: '-',
    objects: 'Audit log row',
    rules: 'UserId, Action and CreatedAt are all NOT NULL',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'table-audit-log' },
      { kind: 'src', path: 'Schema.sql', lines: [7, 12] },
    ],
    parity: null,
  },
  {
    id: 'AR-003',
    cap: 'audit-retention',
    requirement:
      'NightlyDigestCutoffDays sets how old an audit row must be before the nightly purge deletes it',
    actors: '-',
    objects: 'Retention cutoff',
    rules: 'The value is parsed as an integer number of days and subtracted from the current time',
    origin: 'intended',
    confidence: { kind: 'confirmed' },
    citations: [
      { kind: 'ledger', id: 'setting-nightly-digest-cutoff-days' },
      { kind: 'src', path: 'web.config', lines: [3, 6] },
      { kind: 'src', path: 'Jobs/NightlyDigestJob.cs', lines: [13, 13] },
    ],
    parity: null,
  },
]

// Fifteen elements map to a requirement; the sixteenth is the seam exception,
// carried forward unmapped on purpose with the queue id the refs gate checks.
type Disposition = { kind: 'mapped'; fr: string } | { kind: 'out-of-scope'; queue: string }

const DISPOSITIONS: Record<string, Disposition> = {
  'screen-default': { kind: 'mapped', fr: 'SU-001' },
  'route-default-aspx': { kind: 'mapped', fr: 'SU-001' },
  'route-post-api-users': { kind: 'mapped', fr: 'SU-002' },
  'workflow-signup-welcome': { kind: 'mapped', fr: 'SU-003' },
  'setting-welcome-email-enabled': { kind: 'mapped', fr: 'SU-004' },
  'route-get-api-users-id-welcome': { kind: 'mapped', fr: 'WA-001' },
  'integration-billing-sync': { kind: 'mapped', fr: 'WA-001' },
  'screen-users': { kind: 'mapped', fr: 'WA-002' },
  'route-users-aspx': { kind: 'mapped', fr: 'WA-002' },
  'route-get-api-users': { kind: 'mapped', fr: 'UD-001' },
  'table-users': { kind: 'mapped', fr: 'UD-002' },
  'report-daily-users': { kind: 'mapped', fr: 'UD-003' },
  'job-nightly-digest': { kind: 'mapped', fr: 'AR-001' },
  'table-audit-log': { kind: 'mapped', fr: 'AR-002' },
  'setting-nightly-digest-cutoff-days': { kind: 'mapped', fr: 'AR-003' },
  'setting-default-connection': {
    kind: 'out-of-scope',
    queue: 'q-webforms-default-connection-ownership',
  },
}

const EXTRACT_CENSUS: Record<string, unknown>[] = [
  {
    kind: 'rule-sweep',
    subject: 'signup',
    phase: 'extract',
    probes: 2,
    found: 1,
    as_requirements: 1,
    queued: [],
    batch: 'b-rules-signup-001',
  },
  {
    kind: 'rule-sweep',
    subject: 'welcome-activation',
    phase: 'extract',
    probes: 2,
    found: 1,
    as_requirements: 1,
    queued: [],
    batch: 'b-rules-welcome-activation-001',
  },
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
    subject: 'audit-retention',
    phase: 'extract',
    probes: 2,
    found: 1,
    as_requirements: 1,
    queued: [],
    batch: 'b-rules-audit-retention-001',
  },
  {
    // Schema.sql:1-5 declares Id, Email and IsActive; the SELECT at
    // Controllers/UsersController.cs:29 names two of them. `Id` is an identity
    // key, which extract.md's exemption list keeps out of `behavioral`, leaving
    // Email (UD-002) and IsActive (UD-003) as the two that are explained.
    kind: 'attribute',
    surface: 'tables',
    subject: 'table-users',
    phase: 'extract',
    directions: {
      ddl: { count: 3, evidence: 'column list from CREATE TABLE Users in Schema.sql' },
      reader: {
        count: 2,
        evidence: 'columns named in the SELECT at Controllers/UsersController.cs:29',
      },
    },
    total: 3,
    behavioral: 2,
    explained: 2,
    queued: [],
    batch: 'b-attr-table-users-001',
  },
  {
    // workflow-signup-welcome spans signup (route-post-api-users,
    // setting-welcome-email-enabled) and welcome-activation
    // (route-get-api-users-id-welcome): a genuine cross-capability seam, found
    // and covered on the spot by SU-003, which describes the whole journey
    // rather than either half of it.
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
    checked: 12,
    findings: 0,
    fixed: 0,
    queued: [],
    batch: 'b-closer-scope-injection-001',
  },
  {
    // A real finding this pass cannot resolve: NightlyDigestJob deletes
    // AuditLog rows, and nothing anywhere in the checkout ever inserts one.
    kind: 'closer',
    closer: 'read-write-symmetry',
    phase: 'extract',
    checked: 12,
    findings: 1,
    fixed: 0,
    queued: ['q-webforms-auditlog-never-written'],
    batch: 'b-closer-read-write-symmetry-001',
  },
]

// ---------------------------------------------------------------------------
// Phase 4, parity. source.basis is source-only (init's default, and the honest
// call for a checkout with no .csproj and no SDK to build it), so
// `differential` is unavailable: it needs a live legacy system to diff
// against. `golden-master` survives only where the source itself ships the
// artifact that determines the output, which is parity.md's stated exception
// and covers the DDL and the report definition. Everything else is `rubric`,
// and every rubric below `high` carries the queue id the refs gate checks.
type ParityPlan =
  | { kind: 'golden-master'; capability: string; frSlug: string }
  | { kind: 'rubric'; level: string; queue?: string }

const PARITY: Record<string, ParityPlan | null> = {
  'SU-001': { kind: 'rubric', level: 'high' },
  'SU-002': { kind: 'rubric', level: 'high' },
  'SU-003': { kind: 'rubric', level: 'high' },
  'SU-004': { kind: 'rubric', level: 'high' },
  'WA-001': { kind: 'rubric', level: 'moderate', queue: 'q-webforms-billing-notify-unobservable' },
  'WA-002': { kind: 'rubric', level: 'high' },
  'UD-001': null,
  'UD-002': { kind: 'golden-master', capability: 'user-directory', frSlug: 'users-table' },
  'UD-003': { kind: 'golden-master', capability: 'user-directory', frSlug: 'daily-users-report' },
  'AR-001': { kind: 'rubric', level: 'high' },
  'AR-002': { kind: 'golden-master', capability: 'audit-retention', frSlug: 'audit-log-table' },
  'AR-003': { kind: 'rubric', level: 'high' },
}

const DELTA = {
  id: 'delta-in-process-controller-call',
  scope: 'The signup screen reaching the user-creation route (SU-001)',
  rationale:
    'Default.aspx.cs:10 constructs UsersController directly and calls CreateUser in process, with no HTTP request between the two. The target reaches the same route over HTTP, so status codes, model binding and error surfacing all differ for reasons that have nothing to do with whether a user was created.',
  parity_exclusion:
    'The SU-001 parity check must not assert on transport, status code or model-binding behavior, only on the user row that results and the redirect that follows it.',
  validation:
    "A greenfield-only test covers the target's HTTP error surface for this route; the parity suite does not re-prove it.",
  owner_signed: null as string | null,
}

// Four queue items beyond the enumerate scaffold. Three are named by a field
// the refs gate actually checks (UD-001's confidence.queue, WA-001's
// parity.queue, setting-default-connection's disposition.queue); the fourth is
// named only by a closer census's own `queued` array, which queue.md is
// explicit no gate ever cross-checks. Filed anyway, as the manual's discipline.
const QUEUE_ITEMS: Record<string, string> = {
  'q-webforms-getusers-reader-lifetime': `---
id: q-webforms-getusers-reader-lifetime
severity: moderate
status: open
---

## Evidence

\`Controllers/UsersController.cs:25-32\` returns \`Ok(cmd.ExecuteReader())\` from
inside a \`using (var conn = OpenConnection())\` block. The connection is
disposed as the method returns, before anything can read from the reader it
just handed back.

## Options

(a) Write the requirement against the query's evident intent, active users
only, and treat the lifetime bug as a defect the target should not
replicate. (b) Treat the endpoint as non-functional and record that. (c) Ask
the operator whether this endpoint ever returned rows in production.

## Recommendation

Recommend (c); the query says one thing and the disposal order says another,
and only production behavior settles which one this run should carry forward.
`,
  'q-webforms-billing-notify-unobservable': `---
id: q-webforms-billing-notify-unobservable
severity: moderate
status: open
---

## Evidence

\`WA-001\` describes the outbound POST at \`Integrations/BillingClient.cs:10-14\`
to \`https://billing.example.com/activations\`. The basis for this run is
source-only, so there is no live legacy system to diff against and nothing to
capture a golden master from, and the call crosses a boundary neither could
reach in any case.

## Options

(a) Ship \`rubric:low\` and revisit if a runnable environment appears.
(b) Block parity on this requirement until the billing system can be
observed. (c) Ship \`rubric:moderate\`: the guard conditions and the payload
are both readable from the source, the delivery itself is not.

## Recommendation

Recommend (c); \`rubric:moderate\` matches exactly what is observable today.
`,
  'q-webforms-default-connection-ownership': `---
id: q-webforms-default-connection-ownership
severity: moderate
status: open
---

## Evidence

\`setting-default-connection\` (\`web.config:8\`) is read at
\`Controllers/UsersController.cs:17\` and \`Jobs/NightlyDigestJob.cs:14\`. Those
two lines serve three of this run's four capabilities between them, so no
capability has a claim on it the others do not, and surface-affinity
clustering has nothing to say about it either: it carries no ledger ref and
is named by none, so it is an edgeless singleton.

## Options

(a) File it under \`user-directory\`, which owns the users table it mostly
reaches. (b) Declare a fifth, infrastructure-shaped capability to hold shared
configuration. (c) Leave it out of the partition and carry it forward
out-of-scope until an owner decides where shared infrastructure belongs in
the target.

## Recommendation

Recommend (c) for now; (a) would hide a shared dependency inside one
capability's fanout, and (b) is a partition decision worth an owner's
signature rather than this pass's guess.
`,
  'q-webforms-auditlog-never-written': `---
id: q-webforms-auditlog-never-written
severity: moderate
status: open
---

## Evidence

The \`read-write-symmetry\` closer checked every write path against a matching
read path. \`Jobs/NightlyDigestJob.cs:17\` deletes from \`dbo.AuditLog\`, and
\`Schema.sql:7-12\` declares the table, but nothing anywhere in the checkout
ever inserts a row into it: the only two SQL writes in the source are the
\`INSERT INTO Users\` at \`Controllers/UsersController.cs:44\` and that delete.

## Options

(a) Widen the search; the writer may live outside this checkout, in a trigger
or a separate service. (b) Treat it as a real gap for the target to fix
rather than replicate. (c) Ask the operator whether audit rows were ever
written by this application.

## Recommendation

Recommend (c); a table with a purge job and no writer anywhere is exactly
what this closer exists to surface, and only the operator can say whether the
writer is missing or merely elsewhere.
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

test('aspnet recipe run driven probe through queue, ending green at check --phase queue', async () => {
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

  // 7. migrate check --phase enumerate. Every gate this phase owns is clean,
  // and the only violations left are the three declared closers, whose records
  // belong to extract and do not exist yet: exactly the mid-run posture
  // enumerate.md describes, where the census gate reads the whole store
  // regardless of --phase. Asserting the count pins that down harder than
  // asserting cleanliness would, because it fails if anything else starts
  // failing too.
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
    ['screen-default', 'route-post-api-users'],
    ['screen-users', 'route-get-api-users-id-welcome'],
  ].map(([a, b]) => [a, b].sort().join('|'))
  for (const edge of expectedEdges) {
    expect(edges.has(edge)).toBe(true)
  }
  expect(edges.size).toBe(expectedEdges.length)

  // 8. Phase 2, seam. No CLI verb authors any of the three artifacts, so all
  // three are written by hand here exactly as seam.md says a real run writes
  // them. The partition is checked against the ground truth first: fifteen
  // elements in exactly one capability each, and the sixteenth deliberately in
  // none. No gate checks any of that (nothing reads capabilities.elements at
  // all), which is precisely why the assertion is here.
  const assigned = CAPABILITIES.flatMap((c) => c.elements)
  expect(new Set(assigned).size).toBe(assigned.length)
  expect([...assigned, ...UNASSIGNED].sort()).toEqual(rows.map((r) => r.id).sort())
  expect(UNASSIGNED).toEqual(['setting-default-connection'])

  const storeDir = join(target, '.migrate')
  await writeFile(
    join(storeDir, 'capabilities.jsonl'),
    `${CAPABILITIES.map((c) => JSON.stringify(c)).join('\n')}\n`,
  )
  await writeFile(join(storeDir, 'seam.json'), `${JSON.stringify(SEAM_JSON, null, 2)}\n`)
  await writeFile(
    join(storeDir, 'seam.md'),
    '# Seam evidence\n\nsurface-affinity clustering over the ledger refs, connected components then the\ngreedy modularity refinement, Q = 0.505. The other three validators could not\nrun: no live database, no static C# call graph, no VCS history in the copied\nfixture. setting-default-connection is left out of every capability on purpose;\nsee q-webforms-default-connection-ownership.\n',
  )
  expect((await migrate(['phase', 'seam', '--status', 'done'])).code).toBe(0)

  // 9. Phase 3, extract.
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

  // 10. Phase 4, parity. The delta goes in unsigned first, so the deltas gate
  // is shown failing on it before it is shown clean.
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
  // Every row counts as updated, including UD-001, whose parity stays null:
  // the importer stamps its own batch id onto every row it writes, so a row
  // whose content is otherwise unchanged still differs from the one on disk.
  expect(parityImport.out).toContain(
    `import reqs: 0 added, ${REQUIREMENTS.length} updated, batch b-reqs-parity-001`,
  )
  expect((await migrate(['phase', 'parity', '--status', 'done'])).code).toBe(0)

  // 11. Phase 5, queue. Every item this run owed was filed in the pass that
  // named it, so this phase closes on the status flip, exactly as queue.md
  // says: closing is not "the queue is empty", since nothing in this milestone
  // adjudicates an item.
  const listed = await migrate(['queue', 'list', '--open'])
  expect(listed.code).toBe(0)
  expect(listed.out).toContain(`${Object.keys(QUEUE_ITEMS).length + 1} item(s)`)
  expect((await migrate(['phase', 'queue', '--status', 'done'])).code).toBe(0)

  // 12. The terminus. Fifteen of sixteen mapped, the sixteenth out-of-scope by
  // the seam decision, no violations, exit 0.
  const green = await migrate(['check', '--phase', 'queue'])
  expect(green.out).toContain(
    `${rows.length - UNASSIGNED.length}/${rows.length} mapped, ${UNASSIGNED.length} out-of-scope, 0 unaccounted`,
  )
  expect(green.out).not.toContain('Violations')
  expect(green.code).toBe(0)

  // 13. Plain `migrate check` gates every phase through handoff, and fails on
  // exactly the two that have no verb in this milestone. The violation count
  // is what makes "exactly" an assertion rather than a hope.
  const full = await migrate(['check'])
  expect(full.code).toBe(1)
  expect(full.out).toContain('Violations (2):')
  expect(full.out).toContain('  run-state:')
  expect(full.out).toContain(
    '    phase adjudicate is pending; every phase through handoff must be done',
  )
  expect(full.out).toContain(
    '    phase handoff is pending; every phase through handoff must be done',
  )

  // 14. The terminus assertion in step 12 is load-bearing, shown by mutation
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
  expect(noParity.out).toContain('    SU-001 has no parity plan')
  // UD-001 is `queued`, the one confidence the parity gate exempts, so it must
  // not appear even now that its plan is null like everyone else's.
  expect(noParity.out).not.toContain('UD-001 has no parity plan')

  await writeFile(requirementsPath, requirementsText)
  expect((await migrate(['check', '--phase', 'queue'])).code).toBe(0)

  // 15. Removing one element row breaks the census reconciliation for its
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
})
