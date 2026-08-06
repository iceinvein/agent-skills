import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { isValidSlug } from './ids.ts'
import { readTextFile } from './store.ts'
import type { QueueItem, Severity } from './types.ts'

const SEVERITIES: Severity[] = ['critical', 'moderate', 'minor']
const SECTIONS = ['Evidence', 'Options', 'Recommendation'] as const

// A file with no --- frontmatter block at all never gets far enough to be
// treated as a queue item; the message below is the sole diagnostic on that
// path (see parseQueueItem). isMissingFrontmatter lets callers tell that
// case apart from every other grammar violation.
const NO_FRONTMATTER = 'missing --- frontmatter block'

export type ParsedQueue = { ok: true; value: QueueItem } | { ok: false; errors: string[] }

function splitFrontmatter(text: string): { fm: Record<string, string>; body: string } | null {
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---', 3)
  if (end === -1) return null
  const fmText = text.slice(4, end)
  const body = text.slice(end + 4).replace(/^\n/, '')
  const fm: Record<string, string> = {}
  for (const line of fmText.split('\n')) {
    const at = line.indexOf(':')
    if (at === -1) continue
    fm[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { fm, body }
}

function sectionBody(body: string, name: string): string | null {
  const heading = `## ${name}`
  const start = body.indexOf(heading)
  if (start === -1) return null
  const after = start + heading.length
  const next = body.slice(after).search(/\n## /)
  const raw = next === -1 ? body.slice(after) : body.slice(after, after + next)
  return raw.trim()
}

// A queue file that cannot be parsed at all (no --- frontmatter block found)
// is a usage error: the request never resolved to a queue item in the first
// place. Every other error below comes from a file that did parse, so it is
// a well-formed file with invalid content -- a content failure instead.
// Callers (queue-cmd.ts) use this to pick the right exit code without
// re-parsing the file themselves.
export function isMissingFrontmatter(errors: string[]): boolean {
  return errors.length === 1 && (errors[0]?.includes(NO_FRONTMATTER) ?? false)
}

export function parseQueueItem(text: string, path: string): ParsedQueue {
  const errors: string[] = []
  const split = splitFrontmatter(text)
  if (!split) return { ok: false, errors: [`${path}: ${NO_FRONTMATTER}`] }
  const { fm, body } = split

  const id = fm.id ?? ''
  if (!id) errors.push(`${path}: frontmatter is missing id`)
  const stem = basename(path).replace(/\.md$/, '')
  if (id && stem !== id) errors.push(`${path}: filename ${stem} does not match id ${id}`)
  if (id && !(id.startsWith('q-') && isValidSlug(id.slice(2)))) {
    errors.push(`${path}: id ${id} must be q- followed by a lowercase kebab-case slug`)
  }

  const severity = fm.severity ?? ''
  if (!SEVERITIES.includes(severity as Severity)) {
    errors.push(
      `${path}: severity must be one of ${SEVERITIES.join(', ')}, got ${severity || '<none>'}`,
    )
  }
  const status = fm.status ?? ''
  if (status !== 'open' && status !== 'adjudicated') {
    errors.push(`${path}: status must be open or adjudicated, got ${status || '<none>'}`)
  }
  if (status === 'adjudicated' && !fm.ruling) {
    errors.push(`${path}: an adjudicated item needs a ruling`)
  }

  const found: Record<string, string> = {}
  for (const name of SECTIONS) {
    const section = sectionBody(body, name)
    if (section === null) errors.push(`${path}: missing ## ${name} section`)
    else if (section.length === 0) errors.push(`${path}: ## ${name} section is empty`)
    else found[name] = section
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      id,
      severity: severity as Severity,
      status: status as QueueItem['status'],
      ...(fm.ruling ? { ruling: fm.ruling } : {}),
      ...(fm.adjudicated ? { adjudicated: fm.adjudicated } : {}),
      evidence: found.Evidence ?? '',
      options: found.Options ?? '',
      recommendation: found.Recommendation ?? '',
      path,
    },
  }
}

export async function loadQueue(
  queueDir: string,
): Promise<{ items: QueueItem[]; errors: string[] }> {
  if (!existsSync(queueDir)) return { items: [], errors: [] }
  let names: string[]
  try {
    names = (await readdir(queueDir)).filter((n) => n.endsWith('.md')).sort()
  } catch {
    // existsSync just confirmed the path exists, so a readdir failure here
    // means it is not a readable directory (e.g. a file sits at the queue
    // path). One clean diagnostic naming the path, not an uncaught throw.
    return { items: [], errors: [`${queueDir}: cannot be read as a directory`] }
  }
  const items: QueueItem[] = []
  const errors: string[] = []
  for (const name of names) {
    const path = join(queueDir, name)
    let text: string
    try {
      text = await readTextFile(path)
    } catch (e) {
      // One unreadable entry (permission denied, a directory named *.md, or
      // a file removed between readdir and read) must not hide the rest of
      // the directory: report it and keep going.
      errors.push((e as Error).message)
      continue
    }
    const parsed = parseQueueItem(text, path)
    if (parsed.ok) items.push(parsed.value)
    else errors.push(...parsed.errors)
  }
  items.sort((a, b) => {
    const bySeverity = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity)
    return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id)
  })
  return { items, errors }
}
