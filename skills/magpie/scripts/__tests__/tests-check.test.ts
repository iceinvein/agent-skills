import { expect, test } from 'bun:test'
import { detectMissingTests, isTestFile } from '../tests-check.ts'

const sourceDiff = (path: string, added: number): string => {
  const lines = [
    `diff --git a/${path} b/${path}`,
    'index 1..2 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,1 +1,${added + 1} @@`,
    ' const existing = 1',
  ]
  for (let i = 0; i < added; i++) {
    lines.push(`+export function newFn${i}() { return ${i} }`)
  }
  return `${lines.join('\n')}\n`
}

const testDiff = (path: string): string =>
  [
    `diff --git a/${path} b/${path}`,
    'index 1..2 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,1 +1,2 @@',
    ' import { x } from "./x"',
    '+test("x", () => expect(x()).toBe(1))',
    '',
  ].join('\n')

test('isTestFile: common patterns', () => {
  expect(isTestFile('src/a.test.ts')).toBe(true)
  expect(isTestFile('src/a.spec.ts')).toBe(true)
  expect(isTestFile('src/__tests__/a.ts')).toBe(true)
  expect(isTestFile('tests/foo.ts')).toBe(true)
  expect(isTestFile('app/test_foo.py')).toBe(true)
  expect(isTestFile('cmd/foo_test.go')).toBe(true)
  expect(isTestFile('UserTest.java')).toBe(true)
  expect(isTestFile('src/a.ts')).toBe(false)
  expect(isTestFile('docs/a.md')).toBe(false)
})

test('detectMissingTests: flags source files when no test file in diff', () => {
  const findings = detectMissingTests(sourceDiff('src/a.ts', 12))
  expect(findings).toHaveLength(1)
  expect(findings[0]?.file).toBe('src/a.ts')
  expect(findings[0]?.domain).toBe('tests')
  expect(findings[0]?.severity).toBe('medium')
  expect(findings[0]?.line).toBeNull()
})

test('detectMissingTests: empty when a test file is present anywhere', () => {
  const diff = sourceDiff('src/a.ts', 20) + testDiff('src/a.test.ts')
  const findings = detectMissingTests(diff)
  expect(findings).toHaveLength(0)
})

test('detectMissingTests: respects minAddedLines threshold', () => {
  const findings = detectMissingTests(sourceDiff('src/a.ts', 5))
  expect(findings).toHaveLength(0)
})

test('detectMissingTests: skips non-source files', () => {
  const diff = sourceDiff('README.md', 30)
  expect(detectMissingTests(diff)).toHaveLength(0)
})

test('detectMissingTests: emits one finding per source file', () => {
  const diff = sourceDiff('src/a.ts', 12) + sourceDiff('src/b.ts', 15)
  const findings = detectMissingTests(diff)
  expect(findings.map((f) => f.file).sort()).toEqual(['src/a.ts', 'src/b.ts'])
})

test('detectMissingTests: empty diff yields nothing', () => {
  expect(detectMissingTests('')).toEqual([])
})

test('detectMissingTests: ignores comment-only and import-only additions', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,15 @@',
    ' const x = 1',
    '+// just a comment',
    '+import { foo } from "./foo"',
    '+import { bar } from "./bar"',
    '+// another comment',
    '+# python-style comment',
    '',
  ].join('\n')
  expect(detectMissingTests(diff)).toHaveLength(0)
})
