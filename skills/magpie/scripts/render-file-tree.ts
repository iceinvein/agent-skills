import {
  buildTree,
  collapseTree,
  countDirFindings,
  type DirNode,
  findingCountsBySeverity,
} from './file-tree.ts'
import type { PrFileEntry, ReviewFinding } from './types.ts'

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const m: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return m[c] ?? c
  })
}

function pipsHtml(findings: ReviewFinding[], path: string): string {
  const counts = findingCountsBySeverity(findings, path)
  if (counts.length === 0) return ''
  return counts
    .map(
      (c) =>
        `<span class="sev-pip ${c.severity}" aria-label="${c.count} ${c.severity}">${c.count}</span>`,
    )
    .join('')
}

function deltaHtml(f: PrFileEntry): string {
  return `<span class="delta" aria-label="${f.additions} additions, ${f.deletions} deletions"><span class="add">+${f.additions}</span> <span class="del">-${f.deletions}</span></span>`
}

function renderFiles(files: PrFileEntry[], findings: ReviewFinding[], depth: number): string {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const fileName = file.path.split('/').pop() ?? file.path
      return `<button type="button" class="tree-file" data-action="select-file" data-file="${esc(file.path)}" style="padding-left:${depth * 12 + 12}px">
        <span class="name">${esc(fileName)}</span>
        ${pipsHtml(findings, file.path)}
        ${deltaHtml(file)}
      </button>`
    })
    .join('')
}

function renderDirs(dirs: Map<string, DirNode>, findings: ReviewFinding[], depth: number): string {
  return [...dirs.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((dir) => {
      const totalCount = countDirFindings(findings, dir)
      const countBadge = totalCount > 0 ? `<span class="dir-count">${totalCount}</span>` : ''
      return `<details class="tree-dir" open data-dir="${esc(dir.fullPath)}">
        <summary style="padding-left:${depth * 12 + 6}px"><span class="chev"></span><span class="name">${esc(dir.name)}</span>${countBadge}</summary>
        ${renderDirs(dir.dirs, findings, depth + 1)}
        ${renderFiles(dir.files, findings, depth + 1)}
      </details>`
    })
    .join('')
}

export type RenderFileTreeInput = {
  files: PrFileEntry[]
  findings: ReviewFinding[]
  selectedFile?: string | null
}

export function renderFileTree(input: RenderFileTreeInput): string {
  const tree = collapseTree(buildTree(input.files))
  const generalCount = input.findings.filter((f) => !f.file).length
  const overviewBadge = generalCount > 0 ? `<span class="dir-count">${generalCount}</span>` : ''
  return `<aside class="file-rail" data-role="file-tree">
    <button type="button" class="tree-overview" data-action="select-file" data-file="">
      <span class="name">Overview</span>${overviewBadge}
    </button>
    <div class="tree-body">
      ${renderDirs(tree.dirs, input.findings, 0)}
      ${renderFiles(tree.files, input.findings, 0)}
    </div>
  </aside>`
}
