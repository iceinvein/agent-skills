import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  buildImpactMap,
  type DiffNames,
  extractDiffNames,
  type GrepHit,
  type GrepPlan,
  type ImpactRef,
  parseGrepOutput,
  planSearches,
} from '../impact.ts'

function fileDiff(path: string, hunks: string): string {
  return `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
${hunks}`
}

function noNames(): DiffNames {
  return { defined: [], used: [], stores: [], routes: [], changedFiles: [], addedLines: new Map() }
}

function noHits(): Record<GrepPlan['kind'], GrepHit[]> {
  return { references: [], definitions: [], writers: [], routes: [], docs: [] }
}

const noShard = (_file: string): number | null => null
const keepAll = (_file: string): boolean => false

describe('extractDiffNames: definitions', () => {
  test('an exported TS function on an added line is defined as added', () => {
    const diff = fileDiff(
      'src/jobs.ts',
      `@@ -1,2 +1,3 @@
 import x from 'y'
+export function scheduleJob(id: string) {
 const a = 1
`,
    )
    expect(extractDiffNames(diff).defined).toEqual([
      { name: 'scheduleJob', kind: 'added', file: 'src/jobs.ts', line: 2 },
    ])
  })

  test('a definition on both a removed and an added line is changed', () => {
    const diff = fileDiff(
      'src/jobs.ts',
      `@@ -4,1 +4,1 @@
-export function scheduleJob(id: string) {
+export function scheduleJob(id: string, at: Date) {
`,
    )
    expect(extractDiffNames(diff).defined).toEqual([
      { name: 'scheduleJob', kind: 'changed', file: 'src/jobs.ts', line: 4 },
    ])
  })

  test('a definition only on a removed line is removed', () => {
    const diff = fileDiff(
      'src/jobs.ts',
      `@@ -7,2 +7,1 @@
-export class JobRunner {
 const a = 1
`,
    )
    expect(extractDiffNames(diff).defined).toEqual([
      { name: 'JobRunner', kind: 'removed', file: 'src/jobs.ts', line: 7 },
    ])
  })

  test('the function named in a hunk header with a changed body is changed', () => {
    const diff = fileDiff(
      'src/wire.rs',
      `@@ -10,3 +10,4 @@ fn wire_job(
     let a = 1;
+    let b = 2;
     a
 }
`,
    )
    expect(extractDiffNames(diff).defined).toEqual([
      { name: 'wire_job', kind: 'changed', file: 'src/wire.rs', line: 10 },
    ])
  })

  test('a Rust pub(crate) async fn is recognised', () => {
    const diff = fileDiff('src/a.rs', '@@ -1,0 +1,1 @@\n+pub(crate) async fn load_rows() {\n')
    expect(extractDiffNames(diff).defined.map((d) => d.name)).toEqual(['load_rows'])
  })

  test('a Python def is recognised', () => {
    const diff = fileDiff('app/a.py', '@@ -1,0 +1,1 @@\n+def fetch_rows(conn):\n')
    expect(extractDiffNames(diff).defined.map((d) => d.name)).toEqual(['fetch_rows'])
  })

  test('a Go method func with a receiver is recognised', () => {
    const diff = fileDiff(
      'pkg/a.go',
      '@@ -1,0 +1,1 @@\n+func (s *Server) HandleVerify(w Writer) {\n',
    )
    expect(extractDiffNames(diff).defined.map((d) => d.name)).toEqual(['HandleVerify'])
  })

  test('a shell name() { function is recognised', () => {
    const diff = fileDiff('bin/run.sh', '@@ -1,0 +1,1 @@\n+deploy_stack() {\n')
    expect(extractDiffNames(diff).defined.map((d) => d.name)).toEqual(['deploy_stack'])
  })

  test('names shorter than four characters are skipped', () => {
    const diff = fileDiff('src/a.ts', '@@ -1,0 +1,1 @@\n+export function run() {\n')
    expect(extractDiffNames(diff).defined).toEqual([])
  })

  test('stoplisted names are skipped', () => {
    const diff = fileDiff('src/a.ts', '@@ -1,0 +1,1 @@\n+export const config = {}\n')
    expect(extractDiffNames(diff).defined).toEqual([])
  })
})

describe('extractDiffNames: uses, stores, routes', () => {
  test('a called name not defined in the diff goes to used', () => {
    const diff = fileDiff('src/a.ts', '@@ -1,0 +1,1 @@\n+  await verifyToken(req)\n')
    expect(extractDiffNames(diff).used).toEqual([
      { name: 'verifyToken', file: 'src/a.ts', line: 1 },
    ])
  })

  test('a called name the diff itself defines is not used', () => {
    const diff = fileDiff(
      'src/a.ts',
      '@@ -1,0 +1,2 @@\n+export function verifyToken(t) {\n+  return verifyToken(t)\n',
    )
    expect(extractDiffNames(diff).used).toEqual([])
  })

  test('a backticked name on an added markdown line goes to used', () => {
    const diff = fileDiff('docs/guide.md', '@@ -1,0 +1,1 @@\n+Call `rotateKeys` before deploy.\n')
    expect(extractDiffNames(diff).used).toEqual([
      { name: 'rotateKeys', file: 'docs/guide.md', line: 1 },
    ])
  })

  test('a .from(identifier) call yields a table store', () => {
    const diff = fileDiff('src/q.ts', '@@ -1,0 +1,1 @@\n+  db.select().from(videoVerification)\n')
    expect(extractDiffNames(diff).stores).toEqual([
      { name: 'videoVerification', kind: 'table', file: 'src/q.ts', line: 1 },
    ])
  })

  test('an INSERT INTO statement yields a table store', () => {
    const diff = fileDiff(
      'src/q.py',
      '@@ -1,0 +1,1 @@\n+    sql = "INSERT INTO report_locks (id) VALUES (?)"\n',
    )
    expect(extractDiffNames(diff).stores).toEqual([
      { name: 'report_locks', kind: 'table', file: 'src/q.py', line: 1 },
    ])
  })

  test('a .db string literal yields a file store', () => {
    const diff = fileDiff('src/h.py', '@@ -1,0 +1,1 @@\n+    path = "history.db"\n')
    expect(extractDiffNames(diff).stores).toEqual([
      { name: 'history.db', kind: 'file', file: 'src/h.py', line: 1 },
    ])
  })

  test('a slash-rooted string literal yields a route', () => {
    const diff = fileDiff('src/r.ts', "@@ -1,0 +1,1 @@\n+  await fetch('/api/verify/x')\n")
    expect(extractDiffNames(diff).routes).toEqual([
      { path: '/api/verify/x', file: 'src/r.ts', line: 1 },
    ])
  })

  test('Array.from on a built-in receiver yields no store', () => {
    const diff = fileDiff('src/q.ts', '@@ -1,0 +1,1 @@\n+  const all = Array.from(rows)\n')
    expect(extractDiffNames(diff).stores).toEqual([])
  })

  test('an update( call yields no store', () => {
    const diff = fileDiff('src/q.ts', '@@ -1,0 +1,1 @@\n+  hash.update(payload)\n')
    expect(extractDiffNames(diff).stores).toEqual([])
  })

  test('lowercase SQL inside a string yields a table store', () => {
    const diff = fileDiff(
      'src/q.py',
      '@@ -1,0 +1,1 @@\n+    sql = "select id from report_locks where id = ?"\n',
    )
    expect(extractDiffNames(diff).stores).toEqual([
      { name: 'report_locks', kind: 'table', file: 'src/q.py', line: 1 },
    ])
  })

  test('a Python from-import yields no store', () => {
    const diff = fileDiff('src/q.py', '@@ -1,0 +1,1 @@\n+from report_tools import build\n')
    expect(extractDiffNames(diff).stores).toEqual([])
  })

  function storesOnAddedLine(file: string, line: string): DiffNames['stores'] {
    return extractDiffNames(fileDiff(file, `@@ -1,0 +1,1 @@\n+${line}\n`)).stores
  }

  test('English "read from" inside an error message yields no store', () => {
    expect(storesOnAddedLine('src/a.ts', 'throw new Error("could not read from disk")')).toEqual([])
  })

  test('English "update" inside a toast message yields no store', () => {
    expect(storesOnAddedLine('src/a.ts', 'toast("Please update your password")')).toEqual([])
  })

  test('English "from" inside a template literal yields no store', () => {
    expect(storesOnAddedLine('src/a.ts', 'log(`Loaded items from cache`)')).toEqual([])
  })

  test('a Python import naming SQL verbs yields no store', () => {
    expect(storesOnAddedLine('app/db.py', 'from sqlalchemy import select, update')).toEqual([])
  })

  test('a lowercase insert statement in a string yields its table', () => {
    expect(
      storesOnAddedLine('src/db.rs', 'sqlx::query("insert into report_locks (id) values ($1)")'),
    ).toEqual([{ name: 'report_locks', kind: 'table', file: 'src/db.rs', line: 1 }])
  })

  test('an uppercase SELECT in a string yields its table', () => {
    expect(storesOnAddedLine('src/db.ts', 'db.query("SELECT id FROM report_locks")')).toEqual([
      { name: 'report_locks', kind: 'table', file: 'src/db.ts', line: 1 },
    ])
  })

  test('a lowercase statement in a .sql file yields its table', () => {
    expect(storesOnAddedLine('db/up.sql', 'delete from report_locks where id = 1;')).toEqual([
      { name: 'report_locks', kind: 'table', file: 'db/up.sql', line: 1 },
    ])
  })

  test('addedLines records the new-side numbers of added lines only', () => {
    const diff = fileDiff('src/a.ts', '@@ -3,2 +3,3 @@\n keep\n+one\n-gone\n+two\n')
    const names = extractDiffNames(diff)
    expect(names.changedFiles).toEqual(['src/a.ts'])
    expect(names.addedLines.get('src/a.ts')).toEqual(new Set([4, 5]))
  })
})

describe('parseGrepOutput', () => {
  test('splits a path containing a colon at the first colon followed by digits and a colon', () => {
    expect(parseGrepOutput('docs/a:b.md:12:  see foo  \n')).toEqual([
      { file: 'docs/a:b.md', line: 12, text: 'see foo', indented: true },
    ])
  })

  test('cuts text at 160 characters', () => {
    const long = 'x'.repeat(200)
    const hits = parseGrepOutput(`src/a.ts:3:${long}\n`)
    expect(hits[0]?.text).toBe('x'.repeat(160))
  })

  test('keeps a carriage return line whole', () => {
    expect(parseGrepOutput('src/win.ts:4:const a = 1\r\n')).toEqual([
      { file: 'src/win.ts', line: 4, text: 'const a = 1', indented: false },
    ])
  })

  test('keeps a line containing U+2028 whole', () => {
    expect(parseGrepOutput('src/a.ts:2:x = "a\u2028b"\n')).toEqual([
      { file: 'src/a.ts', line: 2, text: 'x = "a\u2028b"', indented: false },
    ])
  })

  test('reads an unquoted non-ASCII path as is', () => {
    expect(parseGrepOutput('café.ts:1:x\n')).toEqual([
      { file: 'café.ts', line: 1, text: 'x', indented: false },
    ])
  })

  test('records that the matched line was indented', () => {
    expect(parseGrepOutput('src/a.ts:9:  const helperFn = 2\n')).toEqual([
      { file: 'src/a.ts', line: 9, text: 'const helperFn = 2', indented: true },
    ])
  })

  test('throws on a line without a line number', () => {
    expect(() => parseGrepOutput('src/a.ts: no number here\n')).toThrow()
  })
})

describe('planSearches', () => {
  test('references search each defined name as a whole fixed word read from stdin', () => {
    const names = noNames()
    names.defined = [
      { name: 'scheduleJob', kind: 'added', file: 'src/a.ts', line: 1 },
      { name: 'JobRunner', kind: 'removed', file: 'src/a.ts', line: 9 },
    ]
    const refs = planSearches(names).find((p) => p.kind === 'references')
    expect(refs).toEqual({
      kind: 'references',
      args: ['-c', 'core.quotePath=false', 'grep', '-n', '-I', '-F', '-w', '-f', '-'],
      patterns: ['scheduleJob', 'JobRunner'],
    })
  })

  test('used names are searched as whole fixed words, not definition regexes', () => {
    const names = noNames()
    names.used = [{ name: 'verifyToken', file: 'src/a.ts', line: 2 }]
    expect(planSearches(names)).toEqual([
      {
        kind: 'definitions',
        args: ['-c', 'core.quotePath=false', 'grep', '-n', '-I', '-F', '-w', '-f', '-'],
        patterns: ['verifyToken'],
      },
    ])
  })

  test('table names are one case-insensitive whole-word search', () => {
    const names = noNames()
    names.stores = [
      { name: 'report_locks', kind: 'table', file: 'src/a.ts', line: 3 },
      { name: 'asset_salts', kind: 'table', file: 'src/a.ts', line: 4 },
    ]
    expect(planSearches(names)).toEqual([
      {
        kind: 'writers',
        args: ['-c', 'core.quotePath=false', 'grep', '-n', '-I', '-F', '-w', '-i', '-f', '-'],
        patterns: ['report_locks', 'asset_salts'],
      },
    ])
  })

  test('file-store literals are searched as fixed strings without -w', () => {
    const names = noNames()
    names.stores = [{ name: 'history.db', kind: 'file', file: 'src/h.py', line: 1 }]
    const writers = planSearches(names).filter((p) => p.kind === 'writers')
    expect(writers).toEqual([
      {
        kind: 'writers',
        args: ['-c', 'core.quotePath=false', 'grep', '-n', '-I', '-F', '-f', '-'],
        patterns: ['history.db'],
      },
    ])
  })

  test('route prefixes are searched as fixed strings without -w', () => {
    const names = noNames()
    names.routes = [{ path: '/api/verify/x', file: 'src/r.ts', line: 1 }]
    expect(planSearches(names)).toEqual([
      {
        kind: 'routes',
        args: ['-c', 'core.quotePath=false', 'grep', '-n', '-I', '-F', '-f', '-'],
        patterns: ['/api/verify'],
      },
    ])
  })

  test('docs search names and changed basenames as whole words in markdown only', () => {
    const names = noNames()
    names.changedFiles = ['src/jobs.ts']
    expect(planSearches(names)).toEqual([
      {
        kind: 'docs',
        args: [
          '-c',
          'core.quotePath=false',
          'grep',
          '-n',
          '-I',
          '-F',
          '-w',
          '-f',
          '-',
          '--',
          '*.md',
          '*.mdx',
        ],
        patterns: ['jobs.ts'],
      },
    ])
  })

  test('more than five names are split into searches of at most five', () => {
    const names = noNames()
    names.used = Array.from({ length: 12 }, (_, i) => ({
      name: `helper${i}`,
      file: 'src/a.ts',
      line: i + 1,
    }))
    expect(planSearches(names).map((p) => [p.kind, p.patterns])).toEqual([
      ['definitions', ['helper0', 'helper1', 'helper2', 'helper3', 'helper4']],
      ['definitions', ['helper5', 'helper6', 'helper7', 'helper8', 'helper9']],
      ['definitions', ['helper10', 'helper11']],
    ])
  })

  test('every plan turns off path quoting before grep', () => {
    const names = noNames()
    names.defined = [{ name: 'scheduleJob', kind: 'added', file: 'src/a.ts', line: 1 }]
    names.used = [{ name: 'verifyToken', file: 'src/a.ts', line: 2 }]
    names.stores = [
      { name: 'report_locks', kind: 'table', file: 'src/a.ts', line: 3 },
      { name: 'history.db', kind: 'file', file: 'src/a.ts', line: 4 },
    ]
    names.routes = [{ path: '/api/verify/x', file: 'src/a.ts', line: 5 }]
    names.changedFiles = ['src/a.ts']
    const plans = planSearches(names)
    expect(plans.length).toBeGreaterThan(5)
    for (const p of plans)
      expect(p.args.slice(0, 3)).toEqual(['-c', 'core.quotePath=false', 'grep'])
  })

  test('no plan is emitted for a kind with nothing to search', () => {
    expect(planSearches(noNames())).toEqual([])
  })
})

describe('buildImpactMap', () => {
  function oneSymbol(): DiffNames {
    const names = noNames()
    names.defined = [{ name: 'scheduleJob', kind: 'changed', file: 'src/jobs.ts', line: 4 }]
    names.changedFiles = ['src/jobs.ts']
    names.addedLines = new Map([['src/jobs.ts', new Set([4])]])
    return names
  }

  test('a reference on an added line of the diff is dropped', () => {
    const hits = noHits()
    hits.references = [
      {
        file: 'src/jobs.ts',
        line: 4,
        text: 'export function scheduleJob(id, at) {',
        indented: false,
      },
      { file: 'src/jobs.ts', line: 30, text: 'scheduleJob(id, now)', indented: false },
    ]
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.symbols[0]?.references).toEqual([
      { file: 'src/jobs.ts', line: 30, text: 'scheduleJob(id, now)' },
    ])
  })

  test('a reference in an excluded path is dropped', () => {
    const hits = noHits()
    hits.references = [
      { file: 'dist/jobs.js', line: 1, text: 'scheduleJob(a)', indented: false },
      { file: 'src/cron.ts', line: 2, text: 'scheduleJob(b)', indented: false },
    ]
    const map = buildImpactMap({
      names: oneSymbol(),
      hits,
      shardOf: noShard,
      excluded: (f) => f.startsWith('dist/'),
    })
    expect(map.symbols[0]?.references).toEqual([
      { file: 'src/cron.ts', line: 2, text: 'scheduleJob(b)' },
    ])
  })

  test('a line returned by two searches counts once', () => {
    const hit = {
      file: 'src/a.ts',
      line: 7,
      text: 'scheduleJob(rotateKeys())',
      indented: true,
    }
    const hits = noHits()
    hits.references = [hit, { ...hit }]
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.symbols[0]?.hits).toBe(1)
    expect(map.symbols[0]?.references).toEqual([
      { file: 'src/a.ts', line: 7, text: 'scheduleJob(rotateKeys())' },
    ])
  })

  test('references are capped at twelve while hits keeps the true count', () => {
    const hits = noHits()
    hits.references = Array.from({ length: 15 }, (_, i) => ({
      file: 'src/cron.ts',
      line: i + 1,
      text: 'scheduleJob(x)',
      indented: false,
    }))
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.symbols[0]?.hits).toBe(15)
    expect(map.symbols[0]?.references.length).toBe(12)
  })

  test('a name with more than two hundred hits lists no references', () => {
    const hits = noHits()
    hits.references = Array.from({ length: 201 }, (_, i) => ({
      file: 'src/cron.ts',
      line: i + 1,
      text: 'scheduleJob(x)',
      indented: false,
    }))
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.symbols[0]?.hits).toBe(201)
    expect(map.symbols[0]?.references).toEqual([])
  })

  test('a reference hit is assigned only to names it contains as a whole word', () => {
    const hits = noHits()
    hits.references = [
      { file: 'src/cron.ts', line: 2, text: 'scheduleJobLater(x)', indented: false },
    ]
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.symbols[0]?.hits).toBe(0)
  })

  test('shard is taken from shardOf on the defining file', () => {
    const map = buildImpactMap({
      names: oneSymbol(),
      hits: noHits(),
      shardOf: (f) => (f === 'src/jobs.ts' ? 3 : null),
      excluded: keepAll,
    })
    expect(map.symbols[0]?.shard).toBe(3)
  })

  test('a used name gets only definition hits that define it', () => {
    const names = noNames()
    names.used = [{ name: 'verifyToken', file: 'src/a.ts', line: 1 }]
    const hits = noHits()
    hits.definitions = [
      {
        file: 'src/auth.ts',
        line: 8,
        text: 'export async function verifyToken(t: string) {',
        indented: false,
      },
      { file: 'src/b.ts', line: 3, text: '// type verifyToken is legacy', indented: false },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.uses).toEqual([
      {
        name: 'verifyToken',
        usedIn: { file: 'src/a.ts', line: 1 },
        shard: null,
        definedAt: [
          { file: 'src/auth.ts', line: 8, text: 'export async function verifyToken(t: string) {' },
        ],
      },
    ])
  })

  test('a table store collects outside writer lines naming it', () => {
    const names = noNames()
    names.stores = [{ name: 'report_locks', kind: 'table', file: 'src/q.py', line: 1 }]
    const hits = noHits()
    hits.writers = [
      { file: 'src/w.py', line: 5, text: 'DELETE FROM report_locks WHERE id = ?', indented: false },
      { file: 'src/w.py', line: 9, text: 'DELETE FROM report_locks_old', indented: false },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.stores[0]?.writers).toEqual([
      { file: 'src/w.py', line: 5, text: 'DELETE FROM report_locks WHERE id = ?' },
    ])
  })

  test('a file store counts any outside line containing the literal as a writer', () => {
    const names = noNames()
    names.stores = [{ name: 'history.db', kind: 'file', file: 'src/h.py', line: 1 }]
    const hits = noHits()
    hits.writers = [
      { file: 'tools/prune.py', line: 2, text: 'open("data/history.db", "w")', indented: false },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.stores[0]?.writers).toEqual([
      { file: 'tools/prune.py', line: 2, text: 'open("data/history.db", "w")' },
    ])
  })

  test('route siblings are other literals sharing the first two segments', () => {
    const names = noNames()
    names.routes = [{ path: '/api/verify/x', file: 'src/r.ts', line: 1 }]
    const hits = noHits()
    hits.routes = [
      { file: 'src/r.ts', line: 4, text: "app.get('/api/verify/x', h)", indented: false },
      { file: 'src/server.ts', line: 5, text: "app.post('/api/verify/y', h)", indented: false },
      { file: 'src/server.ts', line: 6, text: "app.get('/api/verifyall', h)", indented: false },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.routes[0]?.siblings).toEqual([
      { file: 'src/server.ts', line: 5, text: "app.post('/api/verify/y', h)" },
    ])
  })

  test('route siblings keep the same path used in another file', () => {
    const names = noNames()
    names.routes = [{ path: '/api/verify/x', file: 'src/r.ts', line: 1 }]
    const hits = noHits()
    hits.routes = [
      { file: 'src/server.ts', line: 4, text: "app.get('/api/verify/x', h)", indented: false },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.routes[0]?.siblings).toEqual([
      { file: 'src/server.ts', line: 4, text: "app.get('/api/verify/x', h)" },
    ])
  })

  test('an indented TS const is not taken as the definition of a used name', () => {
    const names = noNames()
    names.used = [{ name: 'helperFn', file: 'src/a.ts', line: 1 }]
    const hits = noHits()
    hits.definitions = [
      { file: 'src/b.ts', line: 7, text: 'const helperFn = 2', indented: true },
      { file: 'src/c.ts', line: 1, text: 'export const helperFn = () => 1', indented: false },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.uses[0]?.definedAt).toEqual([
      { file: 'src/c.ts', line: 1, text: 'export const helperFn = () => 1' },
    ])
  })

  test('a lowercase SQL writer counts for a table store', () => {
    const names = noNames()
    names.stores = [{ name: 'report_locks', kind: 'table', file: 'src/q.py', line: 1 }]
    const hits = noHits()
    hits.writers = [
      {
        file: 'src/w.py',
        line: 5,
        text: 'cur.execute("delete from report_locks")',
        indented: false,
      },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.stores[0]?.writers).toEqual([
      { file: 'src/w.py', line: 5, text: 'cur.execute("delete from report_locks")' },
    ])
  })

  function tableWriters(writerHits: GrepHit[]): ImpactRef[] | undefined {
    const names = noNames()
    names.stores = [{ name: 'report_locks', kind: 'table', file: 'src/q.py', line: 1 }]
    const hits = noHits()
    hits.writers = writerHits
    return buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll }).stores[0]?.writers
  }

  test('a line that only reads the table is not a writer', () => {
    expect(
      tableWriters([
        { file: 'src/q.ts', line: 3, text: 'db.select().from(report_locks)', indented: true },
      ]),
    ).toEqual([])
  })

  test('a comment mentioning an update of the table is not a writer', () => {
    expect(
      tableWriters([
        { file: 'src/job.ts', line: 3, text: '// we update report_locks nightly', indented: true },
      ]),
    ).toEqual([])
  })

  test('a markdown line is not a writer', () => {
    expect(
      tableWriters([
        { file: 'docs/ops.md', line: 2, text: 'UPDATE report_locks SET owner', indented: false },
      ]),
    ).toEqual([])
  })

  test('an UPDATE statement in a .sql file is a writer', () => {
    expect(
      tableWriters([
        {
          file: 'db/fix.sql',
          line: 1,
          text: 'UPDATE report_locks SET owner = 1;',
          indented: false,
        },
      ]),
    ).toEqual([{ file: 'db/fix.sql', line: 1, text: 'UPDATE report_locks SET owner = 1;' }])
  })

  test('docs list markdown lines with the changed names they mention', () => {
    const hits = noHits()
    hits.docs = [
      {
        file: 'README.md',
        line: 7,
        text: 'Use scheduleJob from jobs.ts to queue work.',
        indented: false,
      },
      { file: 'src/notes.ts', line: 1, text: '// scheduleJob', indented: false },
    ]
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.docs).toEqual([
      {
        file: 'README.md',
        line: 7,
        text: 'Use scheduleJob from jobs.ts to queue work.',
        mentions: ['scheduleJob', 'jobs.ts'],
        shards: [],
      },
    ])
  })

  function docLines(count: number, text: string): GrepHit[] {
    return Array.from({ length: count }, (_, i) => ({
      file: 'docs/guide.md',
      line: i + 1,
      text,
      indented: false,
    }))
  }

  test('a name with more than two hundred doc lines appears in no doc', () => {
    const hits = noHits()
    hits.docs = docLines(201, 'scheduleJob runs here.')
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.docs).toEqual([])
  })

  test('a name with fifteen doc lines keeps the first twelve', () => {
    const hits = noHits()
    hits.docs = docLines(15, 'scheduleJob runs here.')
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.docs.map((d) => d.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  test('a line naming a common and a rare name keeps only the rare one', () => {
    const names = oneSymbol()
    names.defined.push({ name: 'rotateKeys', kind: 'changed', file: 'src/keys.ts', line: 2 })
    const hits = noHits()
    hits.docs = [
      ...docLines(201, 'scheduleJob runs here.'),
      { file: 'README.md', line: 4, text: 'scheduleJob calls rotateKeys.', indented: false },
    ]
    const map = buildImpactMap({
      names,
      hits,
      shardOf: (f) => (f === 'src/jobs.ts' ? 1 : f === 'src/keys.ts' ? 2 : null),
      excluded: keepAll,
    })
    expect(map.docs).toEqual([
      {
        file: 'README.md',
        line: 4,
        text: 'scheduleJob calls rotateKeys.',
        mentions: ['rotateKeys'],
        shards: [2],
      },
    ])
  })

  test('a doc carries the sorted shards of the symbols and changed files it names', () => {
    const names = noNames()
    names.defined = [
      { name: 'scheduleJob', kind: 'changed', file: 'src/jobs.ts', line: 4 },
      { name: 'rotateKeys', kind: 'added', file: 'src/keys.ts', line: 1 },
    ]
    names.changedFiles = ['src/jobs.ts', 'src/keys.ts', 'src/queue.ts']
    const shards: Record<string, number> = { 'src/jobs.ts': 2, 'src/keys.ts': 0, 'src/queue.ts': 2 }
    const hits = noHits()
    hits.docs = [
      {
        file: 'README.md',
        line: 3,
        text: 'rotateKeys then scheduleJob, see queue.ts',
        indented: false,
      },
      { file: 'README.md', line: 9, text: 'jobs.ts is old', indented: false },
    ]
    const map = buildImpactMap({
      names,
      hits,
      shardOf: (f) => shards[f] ?? null,
      excluded: keepAll,
    })
    expect(map.docs.map((d) => d.shards)).toEqual([[0, 2], [2]])
  })

  test('a doc whose names resolve to no shard carries no shards', () => {
    const hits = noHits()
    hits.docs = [{ file: 'README.md', line: 1, text: 'see scheduleJob', indented: false }]
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.docs.map((d) => d.shards)).toEqual([[]])
  })
})

describe('impact map over a real repository', () => {
  const REPO_FILES: Record<string, string> = {
    'src/caller.ts': [
      'export function rotateKeys() {',
      '  scheduleJob(1)',
      '  load_rows()',
      '  db.select().from(report_locks)',
      '}',
      '',
    ].join('\n'),
    'src/jobs.ts': 'export function scheduleJob(id: number) {\n  return id\n}\n',
    'src/db.rs': 'use std::fmt;\n\npub(crate) async fn load_rows() {\n}\n',
    'src/w.ts': 'db.insert(report_locks).values(row)\n',
    'src/w.py': [
      'def save(cur):',
      '    cur.execute("INSERT INTO report_locks (id) VALUES (?)")',
      '    cur.execute("INSERT INTO report_locks_old (id) VALUES (?)")',
      '',
    ].join('\n'),
    'docs/ops.md': 'Run rotateKeys nightly.\n',
  }

  const DIFF = `diff --git a/src/caller.ts b/src/caller.ts
new file mode 100644
--- /dev/null
+++ b/src/caller.ts
@@ -0,0 +1,5 @@
+export function rotateKeys() {
+  scheduleJob(1)
+  load_rows()
+  db.select().from(report_locks)
+}
`

  async function gitIn(cwd: string, args: string[], stdin = ''): Promise<string> {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      stdin: new TextEncoder().encode(stdin),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    // git grep exits 1 when nothing matches.
    if (code === 1 && args.includes('grep')) return ''
    if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${err}`)
    return out
  }

  test('real git grep results feed the expected uses, writers and docs', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'magpie-impact-'))
    try {
      for (const [file, body] of Object.entries(REPO_FILES)) {
        await mkdir(dirname(join(repo, file)), { recursive: true })
        await writeFile(join(repo, file), body)
      }
      await gitIn(repo, ['init', '-q'])
      await gitIn(repo, ['add', '.'])

      const names = extractDiffNames(DIFF)
      const hits = noHits()
      for (const plan of planSearches(names)) {
        hits[plan.kind].push(
          ...parseGrepOutput(await gitIn(repo, plan.args, `${plan.patterns.join('\n')}\n`)),
        )
      }
      const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })

      expect(map.uses).toEqual([
        {
          name: 'scheduleJob',
          usedIn: { file: 'src/caller.ts', line: 2 },
          shard: null,
          definedAt: [
            { file: 'src/jobs.ts', line: 1, text: 'export function scheduleJob(id: number) {' },
          ],
        },
        {
          name: 'load_rows',
          usedIn: { file: 'src/caller.ts', line: 3 },
          shard: null,
          definedAt: [{ file: 'src/db.rs', line: 3, text: 'pub(crate) async fn load_rows() {' }],
        },
      ])
      expect(map.stores.map((s) => s.writers)).toEqual([
        [
          {
            file: 'src/w.py',
            line: 2,
            text: 'cur.execute("INSERT INTO report_locks (id) VALUES (?)")',
          },
          { file: 'src/w.ts', line: 1, text: 'db.insert(report_locks).values(row)' },
        ],
      ])
      expect(map.docs).toEqual([
        {
          file: 'docs/ops.md',
          line: 1,
          text: 'Run rotateKeys nightly.',
          mentions: ['rotateKeys'],
          shards: [],
        },
      ])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})
