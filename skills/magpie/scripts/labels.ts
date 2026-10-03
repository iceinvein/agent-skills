import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PostStatusMap } from './types.ts'

export const DISMISS_REASONS = ['wrong', 'not-worth-it', 'duplicate', 'style'] as const
export type DismissReason = (typeof DISMISS_REASONS)[number]

export const POST_VIAS = ['recommended', 'selected', 'one', 'cli'] as const
export type PostVia = (typeof POST_VIAS)[number]

export type FindingLabel = {
  id: string
  label: 'posted' | 'dismissed' | 'ignored'
  reason?: DismissReason
  via?: PostVia
}

export function parseVia(value: unknown): PostVia | undefined {
  return POST_VIAS.find((v) => v === value)
}

function foldDismissals(events: Array<Record<string, unknown>>): Map<string, DismissReason> {
  const dismissed = new Map<string, DismissReason>()
  for (const event of events) {
    if (typeof event.findingId !== 'string') continue
    if (event.type === 'undismiss') {
      dismissed.delete(event.findingId)
    } else if (event.type === 'dismiss') {
      const reason = DISMISS_REASONS.find((r) => r === event.reason)
      if (!reason) {
        throw new Error(
          `dismiss event for ${event.findingId} has unknown reason ${JSON.stringify(event.reason)}`,
        )
      }
      dismissed.set(event.findingId, reason)
    }
  }
  return dismissed
}

// A line-rejected inline comment that landed as a PR comment instead is still
// a post, so `fallback-ok` carries the via as well as `ok`.
function latestVia(log: Array<Record<string, unknown>>, id: string): PostVia | undefined {
  let via: PostVia | undefined
  for (const entry of log) {
    if (entry.stage !== 'post' || entry.id !== id) continue
    if (entry.status !== 'ok' && entry.status !== 'fallback-ok') continue
    via = parseVia(entry.via)
  }
  return via
}

export function foldLabels(input: {
  findingIds: string[]
  postStatus: PostStatusMap
  events: Array<Record<string, unknown>>
  log: Array<Record<string, unknown>>
}): FindingLabel[] {
  const dismissed = foldDismissals(input.events)
  return input.findingIds.map((id): FindingLabel => {
    if (input.postStatus[id] === 'posted') {
      const via = latestVia(input.log, id)
      return via ? { id, label: 'posted', via } : { id, label: 'posted' }
    }
    const reason = dismissed.get(id)
    if (reason) return { id, label: 'dismissed', reason }
    return { id, label: 'ignored' }
  })
}

export async function readJsonLines(path: string): Promise<Array<Record<string, unknown>>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  return text.split('\n').flatMap((line, i) => {
    if (line.trim() === '') return []
    try {
      return [JSON.parse(line) as Record<string, unknown>]
    } catch {
      throw new Error(`${path}:${i + 1} is not valid JSON`)
    }
  })
}

export async function readDismissed(runDir: string): Promise<Map<string, string>> {
  return foldDismissals(await readJsonLines(join(runDir, 'state', 'events')))
}
