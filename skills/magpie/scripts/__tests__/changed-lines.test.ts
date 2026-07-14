import { describe, expect, test } from 'bun:test'
import { annotateChangedLines } from '../changed-lines.ts'
import type { ReviewFinding } from '../types.ts'

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
`

function finding(overrides: Partial<ReviewFinding>): ReviewFinding {
  return {
    id: 'x-1',
    file: 'src/a.ts',
    line: 2,
    severity: 'high',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
    title: 't',
    description: 'd',
    domain: 'bugs',
    ...overrides,
  }
}

describe('annotateChangedLines', () => {
  test('flags an anchor inside a changed hunk as true', () => {
    const [f] = annotateChangedLines([finding({ line: 3 })], SAMPLE)
    expect(f?.onChangedLine).toBe(true)
  })

  test('flags a context line inside a hunk as true', () => {
    const [f] = annotateChangedLines([finding({ line: 4 })], SAMPLE)
    expect(f?.onChangedLine).toBe(true)
  })

  test('flags an anchor outside any hunk as false', () => {
    const [f] = annotateChangedLines([finding({ line: 99 })], SAMPLE)
    expect(f?.onChangedLine).toBe(false)
  })

  test('flags a finding whose file is absent from the diff as false', () => {
    const [f] = annotateChangedLines([finding({ file: 'src/other.ts', line: 1 })], SAMPLE)
    expect(f?.onChangedLine).toBe(false)
  })

  test('leaves unanchorable findings null', () => {
    const [f] = annotateChangedLines([finding({ line: null })], SAMPLE)
    expect(f?.onChangedLine).toBeNull()
  })

  test('leaves everything null when the diff is unavailable', () => {
    const [f] = annotateChangedLines([finding({ line: 3 })], '')
    expect(f?.onChangedLine).toBeNull()
  })

  test('matches paths that differ only by a b/ prefix', () => {
    const [f] = annotateChangedLines([finding({ file: 'b/src/a.ts', line: 2 })], SAMPLE)
    expect(f?.onChangedLine).toBe(true)
  })
})
