import { expect, test } from 'bun:test'
import { chunkPath, splitFileChunks, splitRawChunks } from '../diff-chunks.ts'

/** A file chunk with `bodyLines` added lines, shaped like a real patch. */
function chunk(path: string, bodyLines: number): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `+line ${i}`).join('\n')
  return [
    `diff --git a/${path} b/${path}`,
    'index 0000000..1111111 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${bodyLines} @@`,
    body,
    '',
  ].join('\n')
}

test('splitFileChunks finds one chunk per file with its path and line count', () => {
  const diff = chunk('src/a.ts', 3) + chunk('src/b.ts', 5)
  const chunks = splitFileChunks(diff)
  expect(chunks.map((c) => c.path)).toEqual(['src/a.ts', 'src/b.ts'])
  expect(chunks[0]?.lines).toBeGreaterThan(3)
  expect(chunks[0]?.text).toContain('diff --git a/src/a.ts')
})

test('splitFileChunks returns nothing for an empty diff', () => {
  expect(splitFileChunks('')).toEqual([])
  expect(splitFileChunks('\n\n')).toEqual([])
})

test('splitRawChunks keeps a leading preamble as its own element', () => {
  const diff = `some preamble text\n${chunk('src/a.ts', 2)}`
  const raw = splitRawChunks(diff)
  expect(raw[0]).toBe('some preamble text\n')
  expect(raw[1]?.startsWith('diff --git ')).toBe(true)
})

test('chunkPath prefers the b-side path when a rename changes it', () => {
  const rename = [
    'diff --git a/old/name.ts b/new/name.ts',
    'similarity index 100%',
    'rename from old/name.ts',
    'rename to new/name.ts',
    '',
  ].join('\n')
  expect(chunkPath(rename)).toBe('new/name.ts')
})

test('chunkPath returns null when the header cannot be parsed', () => {
  expect(chunkPath('not a diff header at all')).toBeNull()
})
