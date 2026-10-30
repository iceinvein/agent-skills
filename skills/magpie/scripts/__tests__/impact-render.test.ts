import { describe, expect, test } from 'bun:test'
import type { ImpactMap } from '../impact.ts'
import {
  IMPACT_FULL_CAP_BYTES,
  renderImpactForCandidates,
  renderImpactMarkdown,
} from '../impact-render.ts'
import type { ReviewFinding } from '../types.ts'

// Entries are deliberately out of render order so the tests pin the sort.
function sampleMap(): ImpactMap {
  return {
    version: 1,
    symbols: [
      {
        name: 'formatTotal',
        kind: 'added',
        definedAt: [{ file: 'src/total.ts', line: 3 }],
        shard: 1,
        hits: 1,
        references: [{ file: 'src/cart.ts', line: 7, text: 'formatTotal(cart)' }],
      },
      {
        name: 'render',
        kind: 'changed',
        definedAt: [{ file: 'src/view.ts', line: 1 }],
        shard: 1,
        hits: 230,
        references: [],
      },
      {
        name: 'loadUser',
        kind: 'changed',
        definedAt: [{ file: 'src/user.ts', line: 5 }],
        shard: 0,
        hits: 30,
        references: [
          { file: 'src/api.ts', line: 2, text: 'loadUser(id)' },
          { file: 'src/page.ts', line: 8, text: 'await loadUser(params.id)' },
        ],
      },
      {
        name: 'parseRow',
        kind: 'removed',
        definedAt: [{ file: 'src/a.ts', line: 2 }],
        shard: 1,
        hits: 1,
        references: [{ file: 'src/b.ts', line: 9, text: 'parseRow(r)' }],
      },
    ],
    uses: [
      {
        name: 'getConfig',
        usedIn: { file: 'src/user.ts', line: 12 },
        shard: 0,
        definedAt: [{ file: 'lib/config.ts', line: 1, text: 'export function getConfig() {' }],
      },
    ],
    stores: [
      {
        name: 'orders',
        kind: 'table',
        usedIn: [{ file: 'src/db.ts', line: 10 }],
        shard: 0,
        writers: [{ file: 'jobs/sync.ts', line: 4, text: 'INSERT INTO orders (id) VALUES (1)' }],
      },
    ],
    routes: [
      {
        path: '/api/users/:id',
        usedIn: { file: 'src/routes.ts', line: 20 },
        shard: 1,
        siblings: [{ file: 'src/admin.ts', line: 3, text: "router.get('/api/users', list)" }],
      },
    ],
    docs: [
      {
        file: 'docs/user.md',
        line: 4,
        text: 'Call loadUser before render.',
        mentions: ['loadUser', 'render'],
      },
    ],
  }
}

function emptyMap(): ImpactMap {
  return { version: 1, symbols: [], uses: [], stores: [], routes: [], docs: [] }
}

function finding(file: string): ReviewFinding {
  return {
    id: 'x-1',
    file,
    line: 1,
    severity: 'high',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
    title: 't',
    description: 'd',
    domain: 'bugs',
  }
}

const FULL = `### Other writers of the same data
- \`orders\` (diff: src/db.ts:10)
  - jobs/sync.ts:4 \`INSERT INTO orders (id) VALUES (1)\`

### References to changed symbols
- \`parseRow\` (diff: src/a.ts:2)
  - src/b.ts:9 \`parseRow(r)\`
- \`loadUser\` (diff: src/user.ts:5)
  - src/api.ts:2 \`loadUser(id)\`
  - src/page.ts:8 \`await loadUser(params.id)\`
  - 2 of 30 shown
- \`render\`: 230 hits, too common to list

### References to added symbols
- \`formatTotal\` (diff: src/total.ts:3)
  - src/cart.ts:7 \`formatTotal(cart)\`

### Definitions this change relies on
- \`getConfig\` (diff: src/user.ts:12)
  - lib/config.ts:1 \`export function getConfig() {\`

### Sibling routes
- \`/api/users/:id\` (diff: src/routes.ts:20)
  - src/admin.ts:3 \`router.get('/api/users', list)\`

### Docs naming what changed
- docs/user.md:4 \`Call loadUser before render.\` (names: loadUser, render)`

const SHARD_0 = `### Other writers of the same data
- \`orders\` (diff: src/db.ts:10)
  - jobs/sync.ts:4 \`INSERT INTO orders (id) VALUES (1)\`

### References to changed symbols
- \`loadUser\` (diff: src/user.ts:5)
  - src/api.ts:2 \`loadUser(id)\`
  - src/page.ts:8 \`await loadUser(params.id)\`
  - 2 of 30 shown

### Definitions this change relies on
- \`getConfig\` (diff: src/user.ts:12)
  - lib/config.ts:1 \`export function getConfig() {\``

const SHARD_0_CUT_AFTER_TWO = `### Other writers of the same data
- \`orders\` (diff: src/db.ts:10)
  - jobs/sync.ts:4 \`INSERT INTO orders (id) VALUES (1)\`

### References to changed symbols
- \`loadUser\` (diff: src/user.ts:5)
  - src/api.ts:2 \`loadUser(id)\`
  - src/page.ts:8 \`await loadUser(params.id)\`
  - 2 of 30 shown

1 more entries in impact.json`

const SHARD_0_CUT_AFTER_ONE = `### Other writers of the same data
- \`orders\` (diff: src/db.ts:10)
  - jobs/sync.ts:4 \`INSERT INTO orders (id) VALUES (1)\`

2 more entries in impact.json`

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8')

describe('renderImpactMarkdown', () => {
  test('renders every entry in section order with shard null', () => {
    expect(renderImpactMarkdown(sampleMap(), { shard: null, capBytes: 100_000 })).toBe(FULL)
  })

  test('renders only the entries of the requested shard', () => {
    expect(renderImpactMarkdown(sampleMap(), { shard: 0, capBytes: 100_000 })).toBe(SHARD_0)
  })

  test('returns an empty string when no entry matches the shard', () => {
    expect(renderImpactMarkdown(sampleMap(), { shard: 5, capBytes: 100_000 })).toBe('')
  })

  test('returns an empty string for an empty map', () => {
    expect(renderImpactMarkdown(emptyMap(), { shard: null, capBytes: 100_000 })).toBe('')
  })

  test('keeps whole entries that fit the cap and counts the rest', () => {
    const capBytes = bytes(SHARD_0_CUT_AFTER_TWO)
    expect(renderImpactMarkdown(sampleMap(), { shard: 0, capBytes })).toBe(SHARD_0_CUT_AFTER_TWO)
  })

  test('drops a whole entry rather than cutting inside it', () => {
    const capBytes = bytes(SHARD_0_CUT_AFTER_TWO) - 1
    expect(renderImpactMarkdown(sampleMap(), { shard: 0, capBytes })).toBe(SHARD_0_CUT_AFTER_ONE)
  })

  test('counts the cap in UTF-8 bytes, not characters', () => {
    const map = emptyMap()
    map.stores.push({
      name: 'cafés',
      kind: 'file',
      usedIn: [{ file: 'a.ts', line: 1 }],
      shard: null,
      writers: [{ file: 'b.ts', line: 2, text: "write('cafés')" }],
    })
    const whole =
      "### Other writers of the same data\n- `cafés` (diff: a.ts:1)\n  - b.ts:2 `write('cafés')`"
    expect(renderImpactMarkdown(map, { shard: null, capBytes: whole.length })).toBe(
      '1 more entries in impact.json',
    )
  })
})

describe('renderImpactForCandidates', () => {
  test('returns (none) when there is no map', () => {
    expect(renderImpactForCandidates(null, [finding('src/user.ts')])).toBe('(none)')
  })

  test('returns (none) when no entry touches a candidate file', () => {
    expect(renderImpactForCandidates(sampleMap(), [finding('nowhere.ts')])).toBe('(none)')
  })

  test('selects an entry whose diff-side file is a candidate file', () => {
    expect(renderImpactForCandidates(sampleMap(), [finding('src/routes.ts')])).toBe(
      `### Sibling routes
- \`/api/users/:id\` (diff: src/routes.ts:20)
  - src/admin.ts:3 \`router.get('/api/users', list)\``,
    )
  })

  test('selects an entry whose outside file is a candidate file', () => {
    expect(renderImpactForCandidates(sampleMap(), [finding('lib/config.ts')])).toBe(
      `### Definitions this change relies on
- \`getConfig\` (diff: src/user.ts:12)
  - lib/config.ts:1 \`export function getConfig() {\``,
    )
  })

  test('selects a doc by its own file', () => {
    expect(renderImpactForCandidates(sampleMap(), [finding('docs/user.md')])).toBe(
      `### Docs naming what changed
- docs/user.md:4 \`Call loadUser before render.\` (names: loadUser, render)`,
    )
  })

  test('stays under the full cap for a large map', () => {
    const map = emptyMap()
    for (let i = 0; i < 400; i++) {
      map.uses.push({
        name: `helper${i}`,
        usedIn: { file: 'src/user.ts', line: i + 1 },
        shard: 0,
        definedAt: [{ file: 'lib/x.ts', line: i + 1, text: `export function helper${i}() {` }],
      })
    }
    const out = renderImpactForCandidates(map, [finding('src/user.ts')])
    expect(bytes(out)).toBeLessThanOrEqual(IMPACT_FULL_CAP_BYTES)
    expect(out).toMatch(/\n\d+ more entries in impact\.json$/)
  })
})
