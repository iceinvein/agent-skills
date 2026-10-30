import { basename, extname } from 'node:path'
import { parseUnifiedDiffToHunks, splitDiffByFile } from './diff-utils.ts'

export const MIN_NAME_LENGTH = 4
export const MAX_REFS_PER_NAME = 12
export const COMMON_NAME_HITS = 200
export const TEXT_MAX_CHARS = 160

export const NAME_STOPLIST = [
  'self',
  'this',
  'that',
  'data',
  'value',
  'values',
  'result',
  'error',
  'props',
  'index',
  'name',
  'test',
  'main',
  'type',
  'item',
  'items',
  'list',
  'info',
  'args',
  'opts',
  'options',
  'config',
  'state',
  'event',
  'input',
  'output',
  'path',
  'file',
  'text',
  'line',
  'next',
  'done',
  'none',
  'true',
  'false',
  'null',
  'undefined',
  'return',
  'async',
  'await',
  'export',
  'import',
  'const',
  'string',
  'number',
  'boolean',
  'object',
]

export type ImpactLocation = { file: string; line: number }
export type ImpactRef = { file: string; line: number; text: string }
export type ImpactSymbol = {
  name: string
  kind: 'added' | 'changed' | 'removed'
  definedAt: ImpactLocation[]
  shard: number | null
  hits: number
  references: ImpactRef[]
}
export type ImpactUse = {
  name: string
  usedIn: ImpactLocation
  shard: number | null
  definedAt: ImpactRef[]
}
export type ImpactStore = {
  name: string
  kind: 'table' | 'file'
  usedIn: ImpactLocation[]
  shard: number | null
  writers: ImpactRef[]
}
export type ImpactRoute = {
  path: string
  usedIn: ImpactLocation
  shard: number | null
  siblings: ImpactRef[]
}
export type ImpactDoc = {
  file: string
  line: number
  text: string
  mentions: string[]
  shards: number[]
}
export type ImpactMap = {
  version: 1
  symbols: ImpactSymbol[]
  uses: ImpactUse[]
  stores: ImpactStore[]
  routes: ImpactRoute[]
  docs: ImpactDoc[]
}

export type DiffNames = {
  defined: Array<{
    name: string
    kind: 'added' | 'changed' | 'removed'
    file: string
    line: number
  }>
  used: Array<{ name: string; file: string; line: number }>
  stores: Array<{ name: string; kind: 'table' | 'file'; file: string; line: number }>
  routes: Array<{ path: string; file: string; line: number }>
  changedFiles: string[]
  addedLines: Map<string, Set<number>>
}

// `indented` survives trimming because a column-0 TS `const` is a module
// definition while an indented one is a local.
export type GrepHit = { file: string; line: number; text: string; indented: boolean }
// `args` is the argv after `git`, starting `-c core.quotePath=false grep`:
// quoted non-ASCII paths would never match the diff's paths. `patterns` are
// fixed strings for `-f -`, one per line on stdin.
export type GrepPlan = {
  kind: 'references' | 'definitions' | 'writers' | 'routes' | 'docs'
  args: string[]
  patterns: string[]
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*'

const TS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const DOC_EXTS = ['.md', '.mdx']

// Top-level const/let/var only: indented ones are locals, and searching every
// local name across the repo is noise.
const TS_DEFS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=/,
]
const RS_DEFS = [
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|type|const|static)\s+(?:mut\s+)?([A-Za-z_]\w*)/,
]
const PY_DEFS = [/^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/]
const GO_DEFS = [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /^\s*type\s+([A-Za-z_]\w*)/]
const SH_DEFS = [/^\s*([A-Za-z_]\w*)\s*\(\)\s*\{/, /^\s*function\s+([A-Za-z_]\w*)/]

function definitionPatterns(file: string): RegExp[] {
  const ext = extname(file)
  if (TS_EXTS.includes(ext)) return TS_DEFS
  if (ext === '.rs') return RS_DEFS
  if (ext === '.py') return PY_DEFS
  if (ext === '.go') return GO_DEFS
  if (ext === '.sh' || ext === '.bash') return SH_DEFS
  return []
}

function definedNamesIn(file: string, text: string): string[] {
  const names: string[] = []
  for (const re of definitionPatterns(file)) {
    const m = text.match(re)
    if (m?.[1]) names.push(m[1])
  }
  return names
}

function isDoc(file: string): boolean {
  return DOC_EXTS.includes(extname(file))
}

function isSearchableName(name: string): boolean {
  return name.length >= MIN_NAME_LENGTH && !NAME_STOPLIST.includes(name)
}

// Control-flow keywords sit directly before `(` in most languages but name
// nothing a reviewer could look up.
const CALL_KEYWORDS = ['while', 'switch', 'catch', 'function', 'typeof', 'elif', 'match']

const CALL = new RegExp(`(?<![A-Za-z0-9_$])(${IDENT})\\(`, 'g')
const BACKTICKED = new RegExp(`\`(${IDENT})(?:\\(\\))?\``, 'g')

// update( and delete( stay writer verbs on the grep side, but as names they
// catch hash.update(payload) and map.delete(key), which are not tables.
const TABLE_CALL = new RegExp(
  `(?:([A-Za-z_$][\\w$]*)\\s*)?\\.(?:from|insert|into)\\(\\s*["'\`]?(${IDENT})`,
  'g',
)
const BUILTIN_RECEIVERS = [
  'Array',
  'Buffer',
  'Object',
  'Promise',
  'JSON',
  'Math',
  'Date',
  'String',
  'Number',
  'URL',
  'Symbol',
  'Reflect',
]
const TABLE_SQL = new RegExp(
  `(?:INSERT\\s+INTO|REPLACE\\s+INTO|DELETE\\s+FROM|UPDATE|FROM|JOIN)\\s+["\`]?(${IDENT})`,
  'gi',
)
const SQL_VERB = /(?<![A-Za-z0-9_])(?:select|insert|update|delete|replace)(?![A-Za-z0-9_])/i
const FILE_STORE = /["'`]([^"'`\s]+\.(?:db|sqlite|sqlite3))["'`]/g
const ROUTE = /["'`](\/[A-Za-z0-9_\-.:{}$]+(?:\/[A-Za-z0-9_\-.:{}$]*)+)["'`]/g

function captures(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].flatMap((m) => (m[1] ? [m[1]] : []))
}

function tableCalls(text: string): string[] {
  return [...text.matchAll(TABLE_CALL)].flatMap((m) =>
    m[2] && !(m[1] && BUILTIN_RECEIVERS.includes(m[1])) ? [m[2]] : [],
  )
}

const PYTHON_IMPORT = /^\s*from\s+\S+\s+import(?![A-Za-z0-9_])/
const SQL_START = /^\s*(?:select|insert|update|delete|replace|with)(?![A-Za-z0-9_])/i

// The content of the string literal open at `index`, from its opening quote,
// or null when `index` is outside any literal.
function openLiteral(text: string, index: number): string | null {
  const before = text.slice(0, index)
  let open = -1
  for (const q of ['"', "'", '`']) {
    if (before.split(q).length % 2 === 0) open = Math.max(open, before.lastIndexOf(q))
  }
  return open < 0 ? null : text.slice(open + 1)
}

// Lowercase `from`, `update` and the rest are everyday English, so they count
// only in a literal that reads as SQL, or in a .sql file. Uppercase ones are
// trusted with any SQL context on the line.
function sqlTables(file: string, text: string): string[] {
  if (PYTHON_IMPORT.test(text)) return []
  const sqlLine = SQL_VERB.test(text)
  return [...text.matchAll(TABLE_SQL)].flatMap((m) => {
    if (!m[1]) return []
    const keyword = m[0].slice(0, m[0].search(/\s/))
    const literal = openLiteral(text, m.index)
    const counts =
      keyword === keyword.toUpperCase()
        ? sqlLine || literal !== null
        : literal !== null
          ? SQL_START.test(literal)
          : extname(file) === '.sql' && sqlLine
    return counts ? [m[1]] : []
  })
}

function routePrefix(path: string): string {
  return path.split('/').slice(0, 3).join('/')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wholeWord(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(name)}(?![A-Za-z0-9_])`)
}

export function extractDiffNames(diff: string): DiffNames {
  type Seen = { file: string; line: number }
  const added = new Map<string, Seen[]>()
  const removed = new Map<string, Seen[]>()
  const fromHeader = new Map<string, Seen[]>()
  const calls: DiffNames['used'] = []
  const stores: DiffNames['stores'] = []
  const routes: DiffNames['routes'] = []
  const changedFiles: string[] = []
  const addedLines = new Map<string, Set<number>>()

  const note = (into: Map<string, Seen[]>, name: string, at: Seen) => {
    if (!isSearchableName(name)) return
    const list = into.get(name)
    if (list) list.push(at)
    else into.set(name, [at])
  }

  for (const [file, chunk] of splitDiffByFile(diff)) {
    changedFiles.push(file)
    const lines = new Set<number>()
    addedLines.set(file, lines)
    const doc = isDoc(file)
    for (const hunk of parseUnifiedDiffToHunks(chunk)) {
      const touched = hunk.lines.some((l) => l.type !== 'context')
      if (touched) {
        for (const name of definedNamesIn(file, hunk.header.trim())) {
          note(fromHeader, name, { file, line: hunk.newStart })
        }
      }
      for (const l of hunk.lines) {
        if (l.type === 'removed' && l.oldLineNo !== null) {
          for (const name of definedNamesIn(file, l.content)) {
            note(removed, name, { file, line: l.oldLineNo })
          }
        }
        if (l.type !== 'added' || l.newLineNo === null) continue
        const line = l.newLineNo
        lines.add(line)
        for (const name of definedNamesIn(file, l.content)) note(added, name, { file, line })
        if (doc) {
          for (const name of captures(BACKTICKED, l.content)) calls.push({ name, file, line })
          continue
        }
        for (const name of captures(CALL, l.content)) {
          if (!CALL_KEYWORDS.includes(name)) calls.push({ name, file, line })
        }
        const tables = [...tableCalls(l.content), ...sqlTables(file, l.content)]
        for (const name of new Set(tables)) {
          if (isSearchableName(name)) stores.push({ name, kind: 'table', file, line })
        }
        for (const name of new Set(captures(FILE_STORE, l.content))) {
          stores.push({ name, kind: 'file', file, line })
        }
        for (const path of new Set(captures(ROUTE, l.content))) routes.push({ path, file, line })
      }
    }
  }

  const defined: DiffNames['defined'] = []
  const names = new Set([...added.keys(), ...removed.keys(), ...fromHeader.keys()])
  for (const name of names) {
    const a = added.get(name)
    const r = removed.get(name)
    const kind = a && !r ? 'added' : r && !a ? 'removed' : 'changed'
    const sites = a ?? r ?? fromHeader.get(name) ?? []
    const perFile = new Map<string, Seen>()
    for (const s of sites) if (!perFile.has(s.file)) perFile.set(s.file, s)
    for (const s of perFile.values()) defined.push({ name, kind, file: s.file, line: s.line })
  }

  const used: DiffNames['used'] = []
  const usedNames = new Set<string>()
  for (const c of calls) {
    if (names.has(c.name) || usedNames.has(c.name) || !isSearchableName(c.name)) continue
    usedNames.add(c.name)
    used.push(c)
  }

  const seenRoutes = new Set<string>()
  const uniqueRoutes = routes.filter((r) => {
    if (seenRoutes.has(r.path)) return false
    seenRoutes.add(r.path)
    return true
  })

  return { defined, used, stores, routes: uniqueRoutes, changedFiles, addedLines }
}

const LINE_NUMBER = /:(\d+):/

export function parseGrepOutput(out: string): GrepHit[] {
  const hits: GrepHit[] = []
  for (const raw of out.split('\n')) {
    if (raw.length === 0) continue
    const m = raw.match(LINE_NUMBER)
    if (!m?.[1] || m.index === undefined || m.index === 0) {
      throw new Error(`unparseable git grep line: ${raw.slice(0, TEXT_MAX_CHARS)}`)
    }
    const rest = raw.slice(m.index + m[0].length)
    hits.push({
      file: raw.slice(0, m.index),
      line: Number(m[1]),
      text: rest.trim().slice(0, TEXT_MAX_CHARS),
      indented: /^\s/.test(rest),
    })
  }
  return hits
}

const COMMENT_START = /^(?:\/\/|#|\*|\/\*|--)/

function isTableWriter(table: string, text: string): boolean {
  const t = escapeRegex(table)
  const call = new RegExp(`\\.(?:insert|update|delete|into)\\(\\s*["'\`]?${t}(?![A-Za-z0-9_])`)
  const sql = new RegExp(
    `(?:INSERT\\s+INTO|REPLACE\\s+INTO|DELETE\\s+FROM|UPDATE)\\s+["\`]?${t}(?![A-Za-z0-9_])`,
    'i',
  )
  // A case-insensitive verb in a comment is prose about the table, not a write.
  return call.test(text) || (sql.test(text) && !COMMENT_START.test(text))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function changedBasenames(names: DiffNames): string[] {
  return unique(names.changedFiles.filter((f) => !isDoc(f)).map((f) => basename(f)))
}

// Fixed strings read from stdin: thousands of names stay under ARG_MAX, and
// -F matching is fast where ERE alternations ran for minutes. The shape checks
// a regex would have made run in buildImpactMap instead.
const GREP = ['-c', 'core.quotePath=false', 'grep', '-n', '-I', '-F']
const WORDS = [...GREP, '-w']
const STDIN = ['-f', '-']
// git grep checks every pattern on every line once it has more than one, so a
// search's time grows with its pattern count. On a 4000-file repo, 50 names
// took 4.9s as one search, 2.2s as 50 searches and 0.9s as ten searches of five.
const GREP_BATCH = 5

export function planSearches(names: DiffNames): GrepPlan[] {
  const plans: GrepPlan[] = []
  const add = (plan: GrepPlan): void => {
    for (let i = 0; i < plan.patterns.length; i += GREP_BATCH) {
      plans.push({ ...plan, patterns: plan.patterns.slice(i, i + GREP_BATCH) })
    }
  }
  const definedNames = unique(names.defined.map((d) => d.name))
  if (definedNames.length > 0) {
    add({ kind: 'references', args: [...WORDS, ...STDIN], patterns: definedNames })
  }
  const usedNames = unique(names.used.map((u) => u.name))
  if (usedNames.length > 0) {
    add({ kind: 'definitions', args: [...WORDS, ...STDIN], patterns: usedNames })
  }
  const tables = unique(names.stores.filter((s) => s.kind === 'table').map((s) => s.name))
  if (tables.length > 0) {
    // -i because SQL verbs and table names appear in either case.
    add({ kind: 'writers', args: [...WORDS, '-i', ...STDIN], patterns: tables })
  }
  const files = unique(names.stores.filter((s) => s.kind === 'file').map((s) => s.name))
  if (files.length > 0) {
    add({ kind: 'writers', args: [...GREP, ...STDIN], patterns: files })
  }
  const prefixes = unique(names.routes.map((r) => routePrefix(r.path)))
  if (prefixes.length > 0) {
    add({ kind: 'routes', args: [...GREP, ...STDIN], patterns: prefixes })
  }
  const mentions = unique([...definedNames, ...changedBasenames(names)])
  if (mentions.length > 0) {
    add({
      kind: 'docs',
      args: [...WORDS, ...STDIN, '--', '*.md', '*.mdx'],
      patterns: mentions,
    })
  }
  return plans
}

function byFileThenLine(a: ImpactLocation, b: ImpactLocation): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1
  return a.line - b.line
}

export function buildImpactMap(input: {
  names: DiffNames
  hits: Record<GrepPlan['kind'], GrepHit[]>
  shardOf: (file: string) => number | null
  excluded: (file: string) => boolean
}): ImpactMap {
  const { names, hits, shardOf, excluded } = input
  // Batched searches return a line once per batch whose names it holds.
  const outside = (list: GrepHit[]): GrepHit[] => {
    const seen = new Set<string>()
    return list
      .filter((h) => {
        const key = `${h.file}:${h.line}`
        if (seen.has(key)) return false
        seen.add(key)
        return !excluded(h.file) && !names.addedLines.get(h.file)?.has(h.line)
      })
      .sort(byFileThenLine)
  }
  const ref = (h: GrepHit): ImpactRef => ({ file: h.file, line: h.line, text: h.text })

  const references = outside(hits.references)
  const symbols: ImpactSymbol[] = []
  const symbolIndex = new Map<string, ImpactSymbol>()
  for (const d of names.defined) {
    const existing = symbolIndex.get(d.name)
    if (existing) {
      existing.definedAt.push({ file: d.file, line: d.line })
      continue
    }
    const word = wholeWord(d.name)
    const matched = references.filter((h) => word.test(h.text))
    const symbol: ImpactSymbol = {
      name: d.name,
      kind: d.kind,
      definedAt: [{ file: d.file, line: d.line }],
      shard: shardOf(d.file),
      hits: matched.length,
      references:
        matched.length > COMMON_NAME_HITS ? [] : matched.slice(0, MAX_REFS_PER_NAME).map(ref),
    }
    symbolIndex.set(d.name, symbol)
    symbols.push(symbol)
  }

  // Indexed once: a definitions search returns every line naming a used name,
  // and only the lines shaped as a definition of it count.
  const definedBy = new Map<string, ImpactRef[]>()
  for (const h of outside(hits.definitions)) {
    // The leading space restores the indentation the column-0 TS rule reads.
    for (const name of new Set(definedNamesIn(h.file, h.indented ? ` ${h.text}` : h.text))) {
      const list = definedBy.get(name)
      if (list) list.push(ref(h))
      else definedBy.set(name, [ref(h)])
    }
  }
  const uses: ImpactUse[] = []
  for (const u of names.used) {
    const definedAt = (definedBy.get(u.name) ?? []).slice(0, MAX_REFS_PER_NAME)
    if (definedAt.length === 0) continue
    uses.push({
      name: u.name,
      usedIn: { file: u.file, line: u.line },
      shard: shardOf(u.file),
      definedAt,
    })
  }

  const writers = outside(hits.writers).filter((h) => !isDoc(h.file))
  const stores: ImpactStore[] = []
  const storeIndex = new Map<string, ImpactStore>()
  for (const s of names.stores) {
    const existing = storeIndex.get(s.name)
    if (existing) {
      existing.usedIn.push({ file: s.file, line: s.line })
      continue
    }
    const matches =
      s.kind === 'file'
        ? (h: GrepHit) => h.text.includes(s.name)
        : (h: GrepHit) => isTableWriter(s.name, h.text)
    const store: ImpactStore = {
      name: s.name,
      kind: s.kind,
      usedIn: [{ file: s.file, line: s.line }],
      shard: shardOf(s.file),
      writers: writers.filter(matches).slice(0, MAX_REFS_PER_NAME).map(ref),
    }
    storeIndex.set(s.name, store)
    stores.push(store)
  }

  const routeHits = outside(hits.routes)
  const routes: ImpactRoute[] = names.routes.map((r) => {
    const prefix = routePrefix(r.path)
    const siblings = routeHits
      .filter((h) =>
        captures(ROUTE, h.text).some((p) =>
          p === r.path ? h.file !== r.file : routePrefix(p) === prefix,
        ),
      )
      .slice(0, MAX_REFS_PER_NAME)
      .map(ref)
    return {
      path: r.path,
      usedIn: { file: r.file, line: r.line },
      shard: shardOf(r.file),
      siblings,
    }
  })

  const mentionable = unique([...names.defined.map((d) => d.name), ...changedBasenames(names)])
  const mentionWords = mentionable.map((m) => ({ name: m, word: wholeWord(m) }))
  const shardsNamed = (mentions: string[]): number[] => {
    const found = new Set<number>()
    for (const m of mentions) {
      const symbolShard = symbolIndex.get(m)?.shard
      if (symbolShard !== undefined && symbolShard !== null) found.add(symbolShard)
      for (const f of names.changedFiles) {
        const fileShard = basename(f) === m ? shardOf(f) : null
        if (fileShard !== null) found.add(fileShard)
      }
    }
    return [...found].sort((a, b) => a - b)
  }
  const docHits = outside(hits.docs)
    .filter((h) => isDoc(h.file))
    .map((h) => ({ hit: h, mentions: mentionWords.filter((m) => m.word.test(h.text)) }))
  // The symbol rules, per name: a name on too many doc lines is a common word
  // that names nothing, and a rare one lists only its first few lines.
  const docLineCount = new Map<string, number>()
  for (const d of docHits) {
    for (const m of d.mentions) docLineCount.set(m.name, (docLineCount.get(m.name) ?? 0) + 1)
  }
  const docLinesKept = new Map<string, number>()
  const docs: ImpactDoc[] = []
  for (const { hit: h, mentions: found } of docHits) {
    const mentions: string[] = []
    for (const { name } of found) {
      const kept = docLinesKept.get(name) ?? 0
      if ((docLineCount.get(name) ?? 0) > COMMON_NAME_HITS || kept >= MAX_REFS_PER_NAME) continue
      docLinesKept.set(name, kept + 1)
      mentions.push(name)
    }
    if (mentions.length === 0) continue
    docs.push({ file: h.file, line: h.line, text: h.text, mentions, shards: shardsNamed(mentions) })
  }

  return { version: 1, symbols, uses, stores, routes, docs }
}
