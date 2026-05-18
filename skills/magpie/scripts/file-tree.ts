import { filePathMatches } from './diff-utils.ts'
import { type PrFileEntry, type ReviewFinding, SEVERITIES, type Severity } from './types.ts'

export type DirNode = {
  name: string
  fullPath: string
  files: PrFileEntry[]
  dirs: Map<string, DirNode>
}

export function buildTree(files: PrFileEntry[]): DirNode {
  const root: DirNode = { name: '', fullPath: '', files: [], dirs: new Map() }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i]
      if (!dirName) continue
      if (!node.dirs.has(dirName)) {
        const parentPath = node.fullPath ? `${node.fullPath}/${dirName}` : dirName
        node.dirs.set(dirName, { name: dirName, fullPath: parentPath, files: [], dirs: new Map() })
      }
      const next = node.dirs.get(dirName)
      if (!next) throw new Error('unreachable')
      node = next
    }
    node.files.push(file)
  }
  return root
}

export function collapseTree(node: DirNode): DirNode {
  const collapsedDirs = new Map<string, DirNode>()
  for (const [, dir] of node.dirs) {
    let current = dir
    let label = current.name
    while (current.files.length === 0 && current.dirs.size === 1) {
      const child = [...current.dirs.values()][0]
      if (!child) break
      label = `${label}/${child.name}`
      current = child
    }
    const collapsed = collapseTree(current)
    collapsed.name = label
    collapsedDirs.set(label, collapsed)
  }
  return { ...node, dirs: collapsedDirs }
}

export function findingCountsBySeverity(
  findings: ReviewFinding[],
  filePath: string,
): { severity: Severity; count: number }[] {
  const fileFindings = findings.filter((f) => f.file && filePathMatches(f.file, filePath))
  if (fileFindings.length === 0) return []
  const counts = new Map<Severity, number>()
  for (const f of fileFindings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1)
  return SEVERITIES.filter((s) => counts.has(s)).map((s) => ({
    severity: s,
    count: counts.get(s) ?? 0,
  }))
}

function collectPaths(node: DirNode): string[] {
  const paths: string[] = node.files.map((f) => f.path)
  for (const dir of node.dirs.values()) paths.push(...collectPaths(dir))
  return paths
}

export function countDirFindings(findings: ReviewFinding[], node: DirNode): number {
  const paths = collectPaths(node)
  return findings.filter((f) => f.file && paths.some((p) => filePathMatches(f.file as string, p)))
    .length
}
