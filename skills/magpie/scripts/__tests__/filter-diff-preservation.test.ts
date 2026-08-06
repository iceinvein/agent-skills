import { expect, test } from 'bun:test'
import { filterDiff } from '../path-filter.ts'

// filterDiff's refactor onto the shared diff-chunks module (scripts/diff-chunks.ts)
// must preserve two branches that scripts/__tests__/path-filter.test.ts's DIFF
// fixture never exercises, because that fixture always starts with a well-formed
// `diff --git a/... b/...` header:
//
//   1. a leading non-`diff --git` preamble chunk is kept in `filtered`
//   2. a chunk whose header cannot be parsed is kept in `filtered`
//
// These tests assert directly on filterDiff's output for both, so a future edit
// to diff-chunks.ts that breaks either preservation is caught here rather than
// resting on a manual code trace.

const VALID_CHUNK = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-x',
  '+y',
  '',
].join('\n')

test('filterDiff keeps a leading preamble that appears before the first file header', () => {
  const preamble = 'Note: this diff was truncated by the transport layer\n'
  const diff = preamble + VALID_CHUNK
  const { filtered } = filterDiff(diff, { exclude: [], include: [], useDefaults: false })
  expect(filtered).toContain('Note: this diff was truncated by the transport layer')
})

test('filterDiff keeps a chunk whose diff --git header cannot be parsed', () => {
  // No " b/" separator after the a-side path, so FILE_HEADER cannot match and
  // chunkPath returns null; filterDiff must keep the chunk rather than drop it.
  const malformed = [
    'diff --git a/foo.ts b-badformat',
    'index 1234567..89abcde 100644',
    '--- a/foo.ts',
    '+++ b-badformat',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    '',
  ].join('\n')
  const { filtered, excluded } = filterDiff(malformed, {
    exclude: ['**/*'],
    include: [],
    useDefaults: false,
  })
  expect(filtered).toContain('b-badformat')
  expect(excluded).toEqual([])
})
