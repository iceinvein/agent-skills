import { describe, expect, test } from 'bun:test'
import { filePathMatches, parseUnifiedDiffToHunks, splitDiffByFile } from '../diff-utils.ts'

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index abc..def 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
+added
 line3
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1,2 @@
+first
+second
`

describe('parseUnifiedDiffToHunks', () => {
  test('parses a single-file two-hunk diff', () => {
    const single = SAMPLE.split('diff --git a/src/b.ts')[0]
    const hunks = parseUnifiedDiffToHunks(single)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].lines).toHaveLength(5)
    const types = hunks[0].lines.map((l) => l.type)
    expect(types).toEqual(['context', 'removed', 'added', 'added', 'context'])
  })

  test('assigns new line numbers only to added and context lines', () => {
    const single = SAMPLE.split('diff --git a/src/b.ts')[0]
    const hunks = parseUnifiedDiffToHunks(single)
    const lines = hunks[0].lines
    expect(lines[0].newLineNo).toBe(1)
    expect(lines[1].newLineNo).toBeNull()
    expect(lines[2].newLineNo).toBe(2)
    expect(lines[3].newLineNo).toBe(3)
    expect(lines[4].newLineNo).toBe(4)
  })

  test('assigns old line numbers only to removed and context lines', () => {
    const single = SAMPLE.split('diff --git a/src/b.ts')[0]
    const hunks = parseUnifiedDiffToHunks(single)
    const lines = hunks[0].lines
    expect(lines[0].oldLineNo).toBe(1)
    expect(lines[1].oldLineNo).toBe(2)
    expect(lines[2].oldLineNo).toBeNull()
    expect(lines[3].oldLineNo).toBeNull()
    expect(lines[4].oldLineNo).toBe(3)
  })

  test('returns empty array for empty input', () => {
    expect(parseUnifiedDiffToHunks('')).toEqual([])
  })

  test('handles "no newline at end of file" marker by ignoring it', () => {
    const diff = `--- a/x
+++ b/x
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`
    const hunks = parseUnifiedDiffToHunks(diff)
    expect(hunks[0].lines.map((l) => l.type)).toEqual(['removed', 'added'])
  })
})

describe('splitDiffByFile', () => {
  test('returns one entry per file using the "b/" path', () => {
    const m = splitDiffByFile(SAMPLE)
    expect(m.size).toBe(2)
    expect(m.get('src/a.ts')).toContain('@@ -1,3 +1,4 @@')
    expect(m.get('src/b.ts')).toContain('@@ -0,0 +1,2 @@')
  })

  test('returns empty map for empty input', () => {
    expect(splitDiffByFile('').size).toBe(0)
  })
})

describe('filePathMatches', () => {
  test('exact match', () => {
    expect(filePathMatches('src/a.ts', 'src/a.ts')).toBe(true)
  })
  test('tolerates "b/" prefix on one side', () => {
    expect(filePathMatches('b/src/a.ts', 'src/a.ts')).toBe(true)
  })
  test('non-match returns false', () => {
    expect(filePathMatches('src/a.ts', 'src/b.ts')).toBe(false)
  })
})
