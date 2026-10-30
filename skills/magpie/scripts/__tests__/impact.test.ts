import { describe, expect, test } from 'bun:test'
import {
  buildImpactMap,
  type DiffNames,
  extractDiffNames,
  type GrepHit,
  type GrepPlan,
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
      { file: 'docs/a:b.md', line: 12, text: 'see foo' },
    ])
  })

  test('cuts text at 160 characters', () => {
    const long = 'x'.repeat(200)
    const hits = parseGrepOutput(`src/a.ts:3:${long}\n`)
    expect(hits[0]?.text).toBe('x'.repeat(160))
  })

  test('throws on a line without a line number', () => {
    expect(() => parseGrepOutput('src/a.ts: no number here\n')).toThrow()
  })
})

describe('planSearches', () => {
  test('references search each defined name as a whole fixed word', () => {
    const names = noNames()
    names.defined = [
      { name: 'scheduleJob', kind: 'added', file: 'src/a.ts', line: 1 },
      { name: 'JobRunner', kind: 'removed', file: 'src/a.ts', line: 9 },
    ]
    const refs = planSearches(names).find((p) => p.kind === 'references')
    expect(refs?.args).toEqual([
      'grep',
      '-n',
      '-I',
      '-w',
      '-F',
      '-e',
      'scheduleJob',
      '-e',
      'JobRunner',
    ])
  })

  test('file-store literals are searched as fixed strings without -w', () => {
    const names = noNames()
    names.stores = [{ name: 'history.db', kind: 'file', file: 'src/h.py', line: 1 }]
    const writers = planSearches(names).filter((p) => p.kind === 'writers')
    expect(writers).toEqual([
      { kind: 'writers', args: ['grep', '-n', '-I', '-F', '-e', 'history.db'] },
    ])
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
      { file: 'src/jobs.ts', line: 4, text: 'export function scheduleJob(id, at) {' },
      { file: 'src/jobs.ts', line: 30, text: 'scheduleJob(id, now)' },
    ]
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.symbols[0]?.references).toEqual([
      { file: 'src/jobs.ts', line: 30, text: 'scheduleJob(id, now)' },
    ])
  })

  test('a reference in an excluded path is dropped', () => {
    const hits = noHits()
    hits.references = [
      { file: 'dist/jobs.js', line: 1, text: 'scheduleJob(a)' },
      { file: 'src/cron.ts', line: 2, text: 'scheduleJob(b)' },
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

  test('references are capped at twelve while hits keeps the true count', () => {
    const hits = noHits()
    hits.references = Array.from({ length: 15 }, (_, i) => ({
      file: 'src/cron.ts',
      line: i + 1,
      text: 'scheduleJob(x)',
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
    }))
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.symbols[0]?.hits).toBe(201)
    expect(map.symbols[0]?.references).toEqual([])
  })

  test('a reference hit is assigned only to names it contains as a whole word', () => {
    const hits = noHits()
    hits.references = [{ file: 'src/cron.ts', line: 2, text: 'scheduleJobLater(x)' }]
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
      { file: 'src/auth.ts', line: 8, text: 'export async function verifyToken(t: string) {' },
      { file: 'src/b.ts', line: 3, text: '// type verifyToken is legacy' },
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
      { file: 'src/w.py', line: 5, text: 'DELETE FROM report_locks WHERE id = ?' },
      { file: 'src/w.py', line: 9, text: 'DELETE FROM report_locks_old' },
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
    hits.writers = [{ file: 'tools/prune.py', line: 2, text: 'open("data/history.db", "w")' }]
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
      { file: 'src/server.ts', line: 4, text: "app.get('/api/verify/x', h)" },
      { file: 'src/server.ts', line: 5, text: "app.post('/api/verify/y', h)" },
      { file: 'src/server.ts', line: 6, text: "app.get('/api/verifyall', h)" },
    ]
    const map = buildImpactMap({ names, hits, shardOf: noShard, excluded: keepAll })
    expect(map.routes[0]?.siblings).toEqual([
      { file: 'src/server.ts', line: 5, text: "app.post('/api/verify/y', h)" },
    ])
  })

  test('docs list markdown lines with the changed names they mention', () => {
    const hits = noHits()
    hits.docs = [
      { file: 'README.md', line: 7, text: 'Use scheduleJob from jobs.ts to queue work.' },
      { file: 'src/notes.ts', line: 1, text: '// scheduleJob' },
    ]
    const map = buildImpactMap({ names: oneSymbol(), hits, shardOf: noShard, excluded: keepAll })
    expect(map.docs).toEqual([
      {
        file: 'README.md',
        line: 7,
        text: 'Use scheduleJob from jobs.ts to queue work.',
        mentions: ['scheduleJob', 'jobs.ts'],
      },
    ])
  })
})
