import { createHighlighter, type Highlighter } from 'shiki'

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  rb: 'ruby',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  sql: 'sql',
}

const REGISTERED_LANGS: string[] = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'go',
  'rust',
  'java',
  'ruby',
  'bash',
  'json',
  'yaml',
  'markdown',
  'html',
  'css',
  'sql',
]

const THEMES = { light: 'vitesse-light', dark: 'vitesse-dark' } as const

export function languageFromPath(path: string): string {
  if (!path) return 'plaintext'
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot === path.length - 1) return 'plaintext'
  const ext = path.slice(dot + 1).toLowerCase()
  return LANG_BY_EXT[ext] ?? 'plaintext'
}

let cached: Promise<Highlighter> | null = null

export function getHighlighter(): Promise<Highlighter> {
  if (!cached) {
    cached = createHighlighter({
      themes: [THEMES.light, THEMES.dark],
      langs: REGISTERED_LANGS,
    })
  }
  return cached
}

export function _resetHighlighterForTests(): void {
  cached = null
}

export function highlightCodeBlock(highlighter: Highlighter, code: string, lang: string): string {
  const safeLang = REGISTERED_LANGS.includes(lang) ? lang : 'plaintext'
  return highlighter.codeToHtml(code, {
    lang: safeLang,
    themes: THEMES,
    defaultColor: 'light',
  })
}

export function highlightDiffSide(highlighter: Highlighter, code: string, lang: string): string[] {
  const safeLang = REGISTERED_LANGS.includes(lang) ? lang : 'plaintext'
  const html = highlighter.codeToHtml(code, {
    lang: safeLang,
    themes: THEMES,
    defaultColor: 'light',
  })
  return extractShikiLines(html)
}

// Shiki wraps each line in <span class="line">...</span>. Each such outer span
// sits on one text line in the rendered HTML, but the first and last lines also
// carry the <pre>/<code> wrappers. We use a per-text-line greedy match (no `s`
// flag, so `.` stops at newlines) which correctly captures all inner spans while
// treating the last </span> on that text line as the outer closer.
// Empty input produces a single empty-span line which we normalise to [].
export function extractShikiLines(shikiHtml: string): string[] {
  const results: string[] = []
  for (const textLine of shikiHtml.split('\n')) {
    const match = textLine.match(/<span class="line"[^>]*>(.*)<\/span>/)
    if (match) {
      results.push(match[1] ?? '')
    }
  }
  // Shiki always emits at least one line span even for empty input; collapse that.
  if (results.length === 1 && results[0] === '') return []
  return results
}
