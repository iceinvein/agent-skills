import { splitDiffByFile } from './diff-utils.ts'
import type { ReviewFinding } from './types.ts'

const TEST_FILE_PATTERNS: RegExp[] = [
  /\.test\.[jt]sx?$/, // foo.test.ts
  /\.spec\.[jt]sx?$/, // foo.spec.ts
  /(^|\/)__tests__\//, // __tests__/foo.ts
  /(^|\/)tests?\//, // tests/foo.ts, test/foo.ts
  /(^|\/)test_[^/]+\.py$/, // test_foo.py
  /_test\.(go|py|rb)$/, // foo_test.go
  /(^|\/)spec\//, // spec/foo_spec.rb
  /Tests?\.(java|kt|cs)$/, // FooTest.java
]

const NON_CODE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.lock',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.css',
  '.scss',
  '.html',
])

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((p) => p.test(path))
}

function fileExt(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot)
}

function looksLikeSourceCode(path: string): boolean {
  return !NON_CODE_EXTENSIONS.has(fileExt(path).toLowerCase())
}

const COMMENT_PREFIXES = ['//', '#', '*', '/*', '"""', "'''"]

function isLikelyCodeLine(content: string): boolean {
  const trimmed = content.trim()
  if (trimmed.length === 0) return false
  if (COMMENT_PREFIXES.some((p) => trimmed.startsWith(p))) return false
  // Strip leading import statements; they're common churn that doesn't warrant tests.
  if (/^(import|from|require\()/.test(trimmed)) return false
  return /[A-Za-z]/.test(trimmed)
}

function countAddedCodeLines(chunk: string): number {
  let n = 0
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('+')) continue
    if (line.startsWith('+++')) continue
    if (isLikelyCodeLine(line.slice(1))) n += 1
  }
  return n
}

export type DetectMissingTestsOptions = {
  /** Minimum added code lines to trigger a missing-tests finding. Default 10. */
  minAddedLines?: number
}

/**
 * Walk the unified diff. If the diff contains zero test files anywhere, emit
 * one finding per non-test source file that added >= minAddedLines of code-ish
 * lines. Returns an empty array when test files are present (we assume the
 * author has accounted for coverage).
 */
export function detectMissingTests(
  diff: string,
  options: DetectMissingTestsOptions = {},
): ReviewFinding[] {
  if (!diff) return []
  const minAdded = options.minAddedLines ?? 10
  const byFile = splitDiffByFile(diff)
  const filePaths = [...byFile.keys()]
  const hasAnyTestFile = filePaths.some((p) => isTestFile(p))
  if (hasAnyTestFile) return []

  const findings: ReviewFinding[] = []
  let id = 1
  for (const [path, chunk] of byFile) {
    if (isTestFile(path)) continue
    if (!looksLikeSourceCode(path)) continue
    const added = countAddedCodeLines(chunk)
    if (added < minAdded) continue
    findings.push({
      id: `tests-${id++}`,
      file: path,
      line: null,
      severity: 'medium',
      risk: {
        impact: 'medium',
        likelihood: 'possible',
        confidence: 'medium',
        action: 'should-fix',
      },
      title: `No tests added for changes in ${path}`,
      description: [
        `Observation: This PR adds ${added} new code-ish line${added === 1 ? '' : 's'} in \`${path}\` and the diff contains no test or spec file anywhere.`,
        `Why it matters: Behaviour changes without test coverage are easy to regress and harder to review with confidence.`,
        `Suggested direction: Add or extend a test that exercises the new behaviour, or note explicitly why a test is not warranted (config-only change, type-only change, trivial refactor).`,
      ].join('\n\n'),
      domain: 'tests',
    })
  }
  return findings
}
