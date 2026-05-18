import { describe, expect, test } from 'bun:test'
import { renderFileTree } from '../render-file-tree.ts'
import type { PrFileEntry, ReviewFinding } from '../types.ts'

const files: PrFileEntry[] = [
  { path: 'src/a.ts', additions: 5, deletions: 1 },
  { path: 'src/b.ts', additions: 2, deletions: 0 },
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
] as ReviewFinding[]

describe('renderFileTree', () => {
  test('emits a button per file with data-file attribute', () => {
    const html = renderFileTree({ files, findings })
    expect(html).toContain('data-file="src/a.ts"')
    expect(html).toContain('data-file="src/b.ts"')
    expect(html).toContain('data-file="README.md"')
  })

  test('emits +adds -dels deltas per file', () => {
    const html = renderFileTree({ files, findings })
    expect(html).toContain('+5')
    expect(html).toContain('-1')
  })

  test('emits severity pip counts on files that have findings', () => {
    const html = renderFileTree({ files, findings })
    expect(html).toMatch(/data-file="src\/a\.ts"[\s\S]*?sev-pip blocker[\s\S]*?>1</)
  })

  test('renders an Overview entry as data-file=""', () => {
    const html = renderFileTree({ files, findings })
    expect(html).toContain('data-file=""')
    expect(html).toContain('Overview')
  })

  test('collapses single-child directory chains', () => {
    const f: PrFileEntry[] = [{ path: 'apps/server/lib/x.ts', additions: 1, deletions: 0 }]
    const html = renderFileTree({ files: f, findings: [] })
    expect(html).toContain('apps/server/lib')
  })
})
