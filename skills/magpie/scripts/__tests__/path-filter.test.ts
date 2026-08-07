import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_EXCLUDES,
  filterDiff,
  globToRegex,
  loadPathFilterConfig,
  matchesAny,
} from '../path-filter.ts'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'magpie-pathfilter-'))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

test('globToRegex: * does not cross path segments', () => {
  expect(globToRegex('*.lock').test('bun.lock')).toBe(true)
  expect(globToRegex('*.lock').test('a/bun.lock')).toBe(false)
})

test('globToRegex: ** matches across segments', () => {
  expect(globToRegex('**/*.lock').test('bun.lock')).toBe(true)
  expect(globToRegex('**/*.lock').test('a/b/bun.lock')).toBe(true)
  expect(globToRegex('dist/**').test('dist/index.js')).toBe(true)
  expect(globToRegex('dist/**').test('dist/sub/index.js')).toBe(true)
  expect(globToRegex('dist/**').test('src/index.js')).toBe(false)
})

test('globToRegex: dot is literal', () => {
  expect(globToRegex('*.generated.*').test('user.generated.ts')).toBe(true)
  expect(globToRegex('*.generated.*').test('usergeneratedts')).toBe(false)
})

test('matchesAny returns the matched pattern or null', () => {
  expect(matchesAny('bun.lock', ['**/*.lock'])).toBe('**/*.lock')
  expect(matchesAny('src/a.ts', ['**/*.lock', 'dist/**'])).toBeNull()
})

test('DEFAULT_EXCLUDES covers common targets', () => {
  const cases = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'bun.lock',
    'dist/index.js',
    'node_modules/foo/index.js',
    'coverage/lcov.info',
    'src/types.generated.ts',
    'src/types.pb.go',
    'src/__snapshots__/foo.test.ts.snap',
  ]
  for (const c of cases) {
    expect(matchesAny(c, DEFAULT_EXCLUDES)).not.toBeNull()
  }
})

test('DEFAULT_EXCLUDES keeps normal source', () => {
  for (const c of ['src/index.ts', 'apps/server/src/main.ts', 'README.md']) {
    expect(matchesAny(c, DEFAULT_EXCLUDES)).toBeNull()
  }
})

test('loadPathFilterConfig: missing file returns defaults', async () => {
  const cfg = await loadPathFilterConfig(cwd)
  expect(cfg.useDefaults).toBe(true)
  expect(cfg.exclude).toEqual([...DEFAULT_EXCLUDES])
  expect(cfg.include).toEqual([])
})

test('loadPathFilterConfig: user exclude appends to defaults', async () => {
  await writeFile(join(cwd, '.magpie.json'), JSON.stringify({ exclude: ['fixtures/**'] }))
  const cfg = await loadPathFilterConfig(cwd)
  expect(cfg.exclude).toContain('fixtures/**')
  expect(cfg.exclude.length).toBe(DEFAULT_EXCLUDES.length + 1)
})

test('loadPathFilterConfig: useDefaults false drops defaults', async () => {
  await writeFile(
    join(cwd, '.magpie.json'),
    JSON.stringify({ useDefaults: false, exclude: ['fixtures/**'] }),
  )
  const cfg = await loadPathFilterConfig(cwd)
  expect(cfg.exclude).toEqual(['fixtures/**'])
})

test('loadPathFilterConfig: malformed JSON falls back to defaults', async () => {
  await writeFile(join(cwd, '.magpie.json'), 'not json {')
  const cfg = await loadPathFilterConfig(cwd)
  expect(cfg.useDefaults).toBe(true)
  expect(cfg.exclude).toEqual([...DEFAULT_EXCLUDES])
})

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-x
+y
diff --git a/bun.lock b/bun.lock
index 1..2 100644
--- a/bun.lock
+++ b/bun.lock
@@ -1 +1 @@
-{}
+{"a":1}
diff --git a/dist/index.js b/dist/index.js
index 1..2 100644
--- a/dist/index.js
+++ b/dist/index.js
@@ -1 +1 @@
-1
+2
`

test('filterDiff: keeps source, drops lockfile and dist/', () => {
  const { filtered, excluded } = filterDiff(DIFF, {
    exclude: [...DEFAULT_EXCLUDES],
    include: [],
    useDefaults: true,
  })
  expect(filtered).toContain('src/a.ts')
  expect(filtered).not.toContain('bun.lock')
  expect(filtered).not.toContain('dist/index.js')
  expect(excluded.map((e) => e.path).sort()).toEqual(['bun.lock', 'dist/index.js'])
})

test('filterDiff: empty diff', () => {
  const { filtered, excluded } = filterDiff('', {
    exclude: ['**/*'],
    include: [],
    useDefaults: false,
  })
  expect(filtered).toBe('')
  expect(excluded).toEqual([])
})

test('filterDiff: include overrides excludes', () => {
  const { filtered, excluded } = filterDiff(DIFF, {
    exclude: ['**/*'],
    include: ['src/**'],
    useDefaults: false,
  })
  expect(filtered).toContain('src/a.ts')
  expect(excluded.map((e) => e.path).sort()).toEqual(['bun.lock', 'dist/index.js'])
})

test('filterDiff: include records not-in-include reason', () => {
  const { excluded } = filterDiff(DIFF, {
    exclude: [],
    include: ['src/**'],
    useDefaults: false,
  })
  expect(excluded.find((e) => e.path === 'bun.lock')?.pattern).toBe('not-in-include')
})

test('DEFAULT_EXCLUDES covers generated .NET sources', () => {
  const generated = [
    'src/Data/Migrations/20260801_AddUsers.Designer.cs',
    'src/Data/Migrations/AppDbContextModelSnapshot.cs',
    'src/Generated/Api.g.cs',
    'src/Generated/Api.g.i.cs',
    'src/Forms/MainForm.designer.vb',
  ]
  for (const path of generated) {
    expect(matchesAny(path, DEFAULT_EXCLUDES)).not.toBeNull()
  }
})

test('DEFAULT_EXCLUDES leaves hand-written C# and docs alone', () => {
  // The migration itself is reviewable; only its generated designer is not.
  const reviewable = [
    'src/Data/Migrations/20260801_AddUsers.cs',
    'src/Services/UserService.cs',
    'docs/architecture.md',
    'docs/work/notes.md',
    'README.md',
  ]
  for (const path of reviewable) {
    expect(matchesAny(path, DEFAULT_EXCLUDES)).toBeNull()
  }
})
