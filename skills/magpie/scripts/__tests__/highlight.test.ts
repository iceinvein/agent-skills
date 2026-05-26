import { describe, expect, test } from 'bun:test'
import {
  getHighlighter,
  highlightCodeBlock,
  highlightDiffSide,
  languageFromPath,
} from '../highlight.ts'

describe('languageFromPath', () => {
  test('maps known extensions to languages', () => {
    expect(languageFromPath('src/foo.ts')).toBe('typescript')
    expect(languageFromPath('src/foo.tsx')).toBe('tsx')
    expect(languageFromPath('a/b/c.py')).toBe('python')
    expect(languageFromPath('main.go')).toBe('go')
    expect(languageFromPath('lib.rs')).toBe('rust')
    expect(languageFromPath('App.java')).toBe('java')
    expect(languageFromPath('app.rb')).toBe('ruby')
    expect(languageFromPath('run.sh')).toBe('bash')
    expect(languageFromPath('data.json')).toBe('json')
    expect(languageFromPath('ci.yml')).toBe('yaml')
    expect(languageFromPath('readme.md')).toBe('markdown')
    expect(languageFromPath('page.html')).toBe('html')
    expect(languageFromPath('styles.css')).toBe('css')
    expect(languageFromPath('schema.sql')).toBe('sql')
  })

  test('falls back to plaintext for unknown/empty', () => {
    expect(languageFromPath('LICENSE')).toBe('plaintext')
    expect(languageFromPath('file.xyz')).toBe('plaintext')
    expect(languageFromPath('')).toBe('plaintext')
  })

  test('is case-insensitive on extension', () => {
    expect(languageFromPath('FOO.TS')).toBe('typescript')
  })
})

describe('highlightCodeBlock', () => {
  test('wraps output in shiki pre/code', async () => {
    const hl = await getHighlighter()
    const html = highlightCodeBlock(hl, 'const x = 1', 'typescript')
    expect(html).toContain('<pre')
    expect(html).toContain('class="shiki')
    expect(html).toContain('<code>')
    expect(html).toContain('<span class="line">')
  })

  test('falls back to plaintext for unregistered langs without throwing', async () => {
    const hl = await getHighlighter()
    const html = highlightCodeBlock(hl, 'hello world', 'klingon')
    expect(html).toContain('<pre')
    expect(html).toContain('hello world')
  })

  test('emits dual-theme CSS variables for prefers-color-scheme', async () => {
    const hl = await getHighlighter()
    const html = highlightCodeBlock(hl, 'const x = 1', 'typescript')
    expect(html).toMatch(/--shiki-dark/)
  })
})

describe('highlightDiffSide', () => {
  test('returns one entry per source line', async () => {
    const hl = await getHighlighter()
    const code = 'const a = 1\nconst b = 2\nconst c = 3'
    const lines = highlightDiffSide(hl, code, 'typescript')
    expect(lines.length).toBe(3)
  })

  test('handles multi-line template literal without losing lines', async () => {
    const hl = await getHighlighter()
    const code = 'const x = `line1\nline2\nline3`\nconst y = 2'
    const lines = highlightDiffSide(hl, code, 'typescript')
    expect(lines.length).toBe(4)
    expect(lines[0]).toContain('line1')
    expect(lines[1]).toContain('line2')
    expect(lines[2]).toContain('line3')
    expect(lines[3]).toContain('y')
  })

  test('returns empty array for empty input', async () => {
    const hl = await getHighlighter()
    expect(highlightDiffSide(hl, '', 'typescript')).toEqual([])
  })

  test('plaintext fallback still splits per line', async () => {
    const hl = await getHighlighter()
    const lines = highlightDiffSide(hl, 'a\nb\nc', 'plaintext')
    expect(lines.length).toBe(3)
  })
})
