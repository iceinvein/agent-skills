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
export type ImpactDoc = { file: string; line: number; text: string; mentions: string[] }
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

export type GrepHit = { file: string; line: number; text: string }
export type GrepPlan = {
  kind: 'references' | 'definitions' | 'writers' | 'routes' | 'docs'
  args: string[]
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

const TABLE_WRITER_CALL = new RegExp(
  `\\.(?:insert|update|delete|into)\\(\\s*["'\`]?(${IDENT})`,
  'g',
)
const TABLE_READER_CALL = new RegExp(`\\.from\\(\\s*["'\`]?(${IDENT})`, 'g')
const TABLE_SQL = new RegExp(
  `(?:INSERT\\s+INTO|REPLACE\\s+INTO|DELETE\\s+FROM|UPDATE|FROM|JOIN)\\s+["\`]?(${IDENT})`,
  'g',
)
const FILE_STORE = /["'`]([^"'`\s]+\.(?:db|sqlite|sqlite3))["'`]/g
const ROUTE = /["'`](\/[A-Za-z0-9_\-.:{}$]+(?:\/[A-Za-z0-9_\-.:{}$]*)+)["'`]/g

function captures(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].flatMap((m) => (m[1] ? [m[1]] : []))
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
        const tables = [
          ...captures(TABLE_WRITER_CALL, l.content),
          ...captures(TABLE_READER_CALL, l.content),
          ...captures(TABLE_SQL, l.content),
        ]
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

const GREP_LINE = /^(.*?):(\d+):(.*)$/

export function parseGrepOutput(out: string): GrepHit[] {
  const hits: GrepHit[] = []
  for (const raw of out.split('\n')) {
    if (raw.length === 0) continue
    const m = raw.match(GREP_LINE)
    if (!m?.[1] || !m[2] || m[3] === undefined) {
      throw new Error(`unparseable git grep line: ${raw.slice(0, TEXT_MAX_CHARS)}`)
    }
    hits.push({ file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, TEXT_MAX_CHARS) })
  }
  return hits
}

// POSIX ERE for git grep -E: this git's `\b` silently matched nothing.
const ERE_END = '([^[:alnum:]_]|$)'
const ERE_START = '(^|[^[:alnum:]_])'

function definitionEre(name: string): string[] {
  return [
    `${ERE_START}(function|class|interface|type|enum|const|let|var|fn|struct|trait|static|def|func)[[:space:]]+${name}${ERE_END}`,
    `${ERE_START}func[[:space:]]*\\([^)]*\\)[[:space:]]*${name}\\(`,
    `${ERE_START}${name}[[:space:]]*\\(\\)`,
  ]
}

function writerEre(table: string): string[] {
  return [
    `(insert|update|delete|into)\\([[:space:]]*["'\`]?${table}${ERE_END}`,
    `(INSERT[[:space:]]+INTO|REPLACE[[:space:]]+INTO|DELETE[[:space:]]+FROM|UPDATE)[[:space:]]+["\`]?${table}${ERE_END}`,
  ]
}

function writerRegexes(table: string): RegExp[] {
  const t = escapeRegex(table)
  return [
    new RegExp(`\\.(?:insert|update|delete|into)\\(\\s*["'\`]?${t}(?![A-Za-z0-9_])`),
    new RegExp(
      `(?:INSERT\\s+INTO|REPLACE\\s+INTO|DELETE\\s+FROM|UPDATE)\\s+["\`]?${t}(?![A-Za-z0-9_])`,
    ),
  ]
}

function patternArgs(patterns: string[]): string[] {
  return patterns.flatMap((p) => ['-e', p])
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function changedBasenames(names: DiffNames): string[] {
  return unique(names.changedFiles.filter((f) => !isDoc(f)).map((f) => basename(f)))
}

export function planSearches(names: DiffNames): GrepPlan[] {
  const plans: GrepPlan[] = []
  const definedNames = unique(names.defined.map((d) => d.name))
  if (definedNames.length > 0) {
    plans.push({
      kind: 'references',
      args: ['grep', '-n', '-I', '-w', '-F', ...patternArgs(definedNames)],
    })
  }
  const usedNames = unique(names.used.map((u) => u.name))
  if (usedNames.length > 0) {
    plans.push({
      kind: 'definitions',
      args: ['grep', '-n', '-I', '-E', ...patternArgs(usedNames.flatMap(definitionEre))],
    })
  }
  const tables = unique(names.stores.filter((s) => s.kind === 'table').map((s) => s.name))
  if (tables.length > 0) {
    plans.push({
      kind: 'writers',
      args: ['grep', '-n', '-I', '-E', ...patternArgs(tables.flatMap(writerEre))],
    })
  }
  const files = unique(names.stores.filter((s) => s.kind === 'file').map((s) => s.name))
  if (files.length > 0) {
    plans.push({ kind: 'writers', args: ['grep', '-n', '-I', '-F', ...patternArgs(files)] })
  }
  const prefixes = unique(names.routes.map((r) => routePrefix(r.path)))
  if (prefixes.length > 0) {
    plans.push({ kind: 'routes', args: ['grep', '-n', '-I', '-F', ...patternArgs(prefixes)] })
  }
  const mentions = unique([...definedNames, ...changedBasenames(names)])
  if (mentions.length > 0) {
    plans.push({
      kind: 'docs',
      args: ['grep', '-n', '-I', '-w', '-F', ...patternArgs(mentions), '--', '*.md', '*.mdx'],
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
  const outside = (list: GrepHit[]): GrepHit[] =>
    list
      .filter((h) => !excluded(h.file) && !names.addedLines.get(h.file)?.has(h.line))
      .sort(byFileThenLine)
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

  const definitions = outside(hits.definitions)
  const uses: ImpactUse[] = []
  for (const u of names.used) {
    const definedAt = definitions
      .filter((h) => definedNamesIn(h.file, h.text).includes(u.name))
      .slice(0, MAX_REFS_PER_NAME)
      .map(ref)
    if (definedAt.length === 0) continue
    uses.push({
      name: u.name,
      usedIn: { file: u.file, line: u.line },
      shard: shardOf(u.file),
      definedAt,
    })
  }

  const writers = outside(hits.writers)
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
        : (h: GrepHit) => writerRegexes(s.name).some((re) => re.test(h.text))
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
      .filter((h) => captures(ROUTE, h.text).some((p) => p !== r.path && routePrefix(p) === prefix))
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
  const docs: ImpactDoc[] = []
  for (const h of outside(hits.docs)) {
    if (!isDoc(h.file)) continue
    const mentions = mentionWords.filter((m) => m.word.test(h.text)).map((m) => m.name)
    if (mentions.length === 0) continue
    docs.push({ file: h.file, line: h.line, text: h.text, mentions })
  }

  return { version: 1, symbols, uses, stores, routes, docs }
}
