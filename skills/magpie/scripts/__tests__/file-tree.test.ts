import { describe, expect, test } from 'bun:test'
import {
  buildTree,
  collapseTree,
  countDirFindings,
  type DirNode,
  findingCountsBySeverity,
} from '../file-tree.ts'
import type { PrFileEntry, ReviewFinding } from '../types.ts'

const files: PrFileEntry[] = [
  { path: 'src/a.ts', additions: 5, deletions: 1 },
  { path: 'src/b.ts', additions: 2, deletions: 0 },
  { path: 'src/deep/only.ts', additions: 1, deletions: 0 },
  { path: 'README.md', additions: 3, deletions: 0 },
]

const findings: ReviewFinding[] = [
  {
    id: '1',
    file: 'src/a.ts',
    line: 1,
    severity: 'blocker',
    title: 't',
    description: 'd',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
    domain: 'security',
  },
  {
    id: '2',
    file: 'src/a.ts',
    line: 2,
    severity: 'high',
    title: 't',
    description: 'd',
    risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'should-fix' },
    domain: 'bugs',
  },
  {
    id: '3',
    file: 'src/deep/only.ts',
    line: 1,
    severity: 'medium',
    title: 't',
    description: 'd',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'consider' },
    domain: 'bugs',
  },
] as ReviewFinding[]

describe('buildTree', () => {
  test('groups files by directory', () => {
    const tree = buildTree(files)
    expect(tree.dirs.has('src')).toBe(true)
    expect(tree.files.find((f) => f.path === 'README.md')).toBeDefined()
  })

  test('nests deep directories', () => {
    const tree = buildTree(files)
    const src = tree.dirs.get('src')
    if (!src) throw new Error('expected src dir')
    expect(src.dirs.has('deep')).toBe(true)
    expect(src.dirs.get('deep')?.files.map((f) => f.path)).toEqual(['src/deep/only.ts'])
  })
})

describe('collapseTree', () => {
  test('collapses nested single-child dirs like apps/server/lib', () => {
    const f: PrFileEntry[] = [{ path: 'apps/server/lib/x.ts', additions: 1, deletions: 0 }]
    const tree = collapseTree(buildTree(f))
    const first = [...tree.dirs.values()][0]
    if (!first) throw new Error('expected one dir')
    expect(first.name).toBe('apps/server/lib')
  })
})

describe('findingCountsBySeverity', () => {
  test('returns severity counts for a file in canonical order', () => {
    const counts = findingCountsBySeverity(findings, 'src/a.ts')
    expect(counts).toEqual([
      { severity: 'blocker', count: 1 },
      { severity: 'high', count: 1 },
    ])
  })

  test('returns empty array when the file has no findings', () => {
    expect(findingCountsBySeverity(findings, 'README.md')).toEqual([])
  })
})

describe('countDirFindings', () => {
  test('sums findings across all files in a subtree', () => {
    const tree = collapseTree(buildTree(files))
    const src = tree.dirs.get('src') as DirNode | undefined
    if (src) expect(countDirFindings(findings, src)).toBe(3)
  })
})
