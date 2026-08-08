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

beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), 'migrate-e2e-'))
  source = join(target, 'legacy')
  await cp(FIXTURE, source, { recursive: true })
})

afterEach(async () => {
  await rm(target, { recursive: true, force: true })
})

test('init, import, census, check, report over the fixture source', async () => {
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

  // Narrow the declared surfaces to what this fixture actually has, and drop
  // the closers, which belong to the extract phase.
  const cfgPath = join(target, '.migrate', 'config.toml')
  const cfg = await readFile(cfgPath, 'utf8')
  await writeFile(
    cfgPath,
    cfg.replace(/^types = .*$/m, 'types = ["routes", "tables"]').replace(/^set = .*$/m, 'set = []'),
  )

  const elements = await write('elements.json', {
    batch: 'b-1',
    phase: 'enumerate',
    rows: [
      {
        id: 'route-get-api-users',
        surface: 'routes',
        element: 'GET /api/users',
        found_by: ['code'],
        disposition: { kind: 'unaccounted' },
        refs: [{ kind: 'src', path: 'app.js', lines: [8, 8] }],
        lens: 'code',
        notes: '',
      },
      {
        id: 'route-post-api-users',
        surface: 'routes',
        element: 'POST /api/users',
        found_by: ['code'],
        disposition: { kind: 'unaccounted' },
        refs: [{ kind: 'src', path: 'app.js', lines: [10, 14] }],
        lens: 'code',
        notes: '',
      },
      {
        id: 'table-users',
        surface: 'tables',
        element: 'users',
        found_by: ['code'],
        disposition: { kind: 'unaccounted' },
        refs: [{ kind: 'src', path: 'schema.sql', lines: [1, 5] }],
        lens: 'code',
        notes: '',
      },
    ],
  })
  expect((await migrate(['import', 'elements', elements])).code).toBe(0)

  // Unaccounted elements mean the gate must fail here.
  const beforeMapping = await migrate(['check'])
  expect(beforeMapping.code).toBe(1)
  expect(beforeMapping.out).toContain('0/3 mapped, 0 out-of-scope, 3 unaccounted')

  // Every count below was produced by re-running the exact command in its own
  // `evidence` string against fixtures/tiny-express, and every one of them
  // counts the whole fixture rather than the three-row subset this test
  // imports. That difference is the point: this test deliberately imports two
  // of the fixture's three routes and one of its two tables, and the census's
  // own `skipped` list is the mechanism for saying so. Declaring counts that
  // matched the subset instead would mean quoting a probe command that does
  // not produce them, which is the one thing this tool exists to make
  // impossible -- and the balance rule (total == in_ledger + added + skipped +
  // queued) then checks the reconciliation rather than leaving it asserted.
  //
  // The tables `code` direction that used to sit here ran `rg -n "users"
  // app.js` and reported 1. app.js contains no SQL and no database access
  // whatsoever (see the file): every one of its three matches is a `/api/users`
  // URL path segment, so that direction evidenced zero real table references
  // and passed only because the surface set is narrowed here. Replaced with
  // the report definition's own query, which is a real read of a real table.
  for (const record of [
    {
      kind: 'lens',
      surface: 'routes',
      phase: 'enumerate',
      directions: {
        // 3 matches: app.js lines 8, 10 and 18.
        code: { count: 3, evidence: 'rg -n "app.(get|post)" app.js' },
        nav: { count: 3, evidence: 'manual walk of route registrations in app.js' },
      },
      total: 3,
      in_ledger: 2,
      added: 0,
      skipped: [
        {
          element: 'GET /api/users/:id/welcome',
          reason: "out of this test's two-route slice; carried by e2e-express.test.ts",
        },
      ],
      queued: [],
      batch: 'b-1',
    },
    {
      kind: 'lens',
      surface: 'tables',
      phase: 'enumerate',
      directions: {
        // 2 matches: schema.sql lines 1 (users) and 7 (audit_log).
        ddl: { count: 2, evidence: 'rg -n "CREATE TABLE" schema.sql' },
        // 1 match: reports/daily-users.json line 4, SELECT COUNT(*) FROM users.
        query: { count: 1, evidence: 'rg -n "FROM [a-z_]+" reports/*.json' },
      },
      total: 2,
      in_ledger: 1,
      added: 0,
      skipped: [
        {
          element: 'audit_log',
          reason: "out of this test's one-table slice; carried by e2e-express.test.ts",
        },
      ],
      queued: [],
      batch: 'b-1',
    },
  ]) {
    expect((await migrate(['census', await write(`c-${record.surface}.json`, record)])).code).toBe(
      0,
    )
  }

  const caps = join(target, '.migrate', 'capabilities.jsonl')
  await writeFile(
    caps,
    `${JSON.stringify({ slug: 'users', title: 'Users', ns: 'US', elements: [] })}\n`,
  )

  const reqs = await write('reqs.json', {
    batch: 'b-2',
    phase: 'extract',
    rows: [
      {
        id: 'US-001',
        cap: 'users',
        requirement: 'List users',
        actors: 'Client',
        objects: 'User',
        rules: '-',
        origin: 'intended',
        confidence: { kind: 'confirmed' },
        citations: [
          { kind: 'ledger', id: 'route-get-api-users' },
          { kind: 'src', path: 'app.js', lines: [8, 8] },
        ],
        parity: { kind: 'rubric', level: 'high' },
      },
      {
        id: 'US-002',
        cap: 'users',
        requirement: 'Create a user and persist it',
        actors: 'Client',
        objects: 'User',
        rules: 'email is required',
        origin: 'intended',
        confidence: { kind: 'confirmed' },
        citations: [
          { kind: 'ledger', id: 'route-post-api-users' },
          { kind: 'ledger', id: 'table-users' },
          { kind: 'src', path: 'schema.sql', lines: [1, 5] },
        ],
        parity: { kind: 'rubric', level: 'high' },
      },
    ],
  })
  expect((await migrate(['import', 'reqs', reqs])).code).toBe(0)

  // Map every element by rewriting dispositions through a re-import, which is
  // the same path the extract phase uses.
  const mapped = await write('mapped.json', {
    batch: 'b-3',
    phase: 'extract',
    rows: [
      {
        id: 'route-get-api-users',
        surface: 'routes',
        element: 'GET /api/users',
        found_by: ['code'],
        disposition: { kind: 'mapped', fr: 'US-001' },
        refs: [],
        lens: 'code',
        notes: '',
      },
      {
        id: 'route-post-api-users',
        surface: 'routes',
        element: 'POST /api/users',
        found_by: ['code'],
        disposition: { kind: 'mapped', fr: 'US-002' },
        refs: [],
        lens: 'code',
        notes: '',
      },
      {
        id: 'table-users',
        surface: 'tables',
        element: 'users',
        found_by: ['code'],
        disposition: { kind: 'mapped', fr: 'US-002' },
        refs: [],
        lens: 'code',
        notes: '',
      },
    ],
  })
  expect((await migrate(['import', 'elements', mapped])).code).toBe(0)

  // Milestone 1 has no verbs for probe, seam, parity or queue: an
  // orchestrator marks each done by hand once it decides there is nothing
  // further to do there, the same way it would for enumerate and extract if
  // recordBatch had not already moved them to 'running'. adjudicate and
  // handoff are left pending on purpose, since neither has a verb at all
  // yet, which is why the clean check below is bound to --phase queue
  // rather than the full run.
  for (const name of ['probe', 'enumerate', 'seam', 'extract', 'parity', 'queue']) {
    expect((await migrate(['phase', name, '--status', 'done'])).code).toBe(0)
  }

  const clean = await migrate(['check', '--phase', 'queue', '--citations'])
  expect(clean.out).toContain('3/3 mapped, 0 out-of-scope, 0 unaccounted')
  expect(clean.code).toBe(0)

  const report = await migrate(['report'])
  expect(report.code).toBe(0)
  const ledger = await readFile(join(target, 'docs', 'migrate', 'ledger.md'), 'utf8')
  expect(ledger).toContain('mapped:US-002')

  const status = await migrate(['status'])
  expect(status.out).toContain('3/3 mapped')
  expect(status.out).toContain('resume:')
})

test('a citation to a file absent from the fixture fails the citations gate', async () => {
  await migrate(['init', '--source', source, '--scope', 'all', '--name', 'tiny-next'])
  const cfgPath = join(target, '.migrate', 'config.toml')
  const cfg = await readFile(cfgPath, 'utf8')
  // Narrow both surfaces and closers to empty: this test imports no elements
  // and records no census, so any declared surface or closer would fail the
  // census gate regardless of the citations violation under test, leaving
  // the exit code unable to discriminate a fixed citations bug from a
  // still-broken one.
  await writeFile(
    cfgPath,
    cfg.replace(/^types = .*$/m, 'types = []').replace(/^set = .*$/m, 'set = []'),
  )
  await writeFile(
    join(target, '.migrate', 'capabilities.jsonl'),
    `${JSON.stringify({ slug: 'users', title: 'Users', ns: 'US', elements: [] })}\n`,
  )
  const reqs = await write('reqs.json', {
    batch: 'b-1',
    phase: 'extract',
    rows: [
      {
        id: 'US-001',
        cap: 'users',
        requirement: 'Invented',
        actors: '-',
        objects: '-',
        rules: '-',
        origin: 'intended',
        confidence: { kind: 'confirmed' },
        citations: [{ kind: 'src', path: 'does-not-exist.js', lines: [1, 2] }],
        parity: { kind: 'rubric', level: 'high' },
      },
    ],
  })
  expect((await migrate(['import', 'reqs', reqs])).code).toBe(0)
  const result = await migrate(['check', '--citations'])
  expect(result.code).toBe(1)
  expect(result.out).toContain('does-not-exist.js')
})
