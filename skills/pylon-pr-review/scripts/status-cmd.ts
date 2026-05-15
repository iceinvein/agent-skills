import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ORDER = [
  'setup',
  'context',
  'specialists',
  'dedupe',
  'critic',
  'peer-review',
  'report',
  'post',
] as const

export type StatusResult = {
  lastCompleted: (typeof ORDER)[number] | null
  next: (typeof ORDER)[number] | 'cleanup'
  error: string | null
}

export async function runStatus(runDir: string): Promise<StatusResult> {
  const text = await readFile(join(runDir, 'log.jsonl'), 'utf8').catch(() => '')
  let lastCompleted: StatusResult['lastCompleted'] = null
  let error: string | null = null
  for (const line of text.split('\n').filter(Boolean)) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const stage = entry.stage as string
    const status = entry.status as string
    if (status === 'error') {
      error = stage
      break
    }
    if (status === 'done' && (ORDER as readonly string[]).includes(stage)) {
      lastCompleted = stage as StatusResult['lastCompleted']
    }
  }
  const idx = lastCompleted ? ORDER.indexOf(lastCompleted) : -1
  const nextStage = ORDER[idx + 1]
  const next: StatusResult['next'] = nextStage ?? 'cleanup'
  return { lastCompleted, next, error }
}
