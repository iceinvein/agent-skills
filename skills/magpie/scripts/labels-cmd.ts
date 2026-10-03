import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { foldLabels, readJsonLines } from './labels.ts'
import type { PostStatusMap } from './types.ts'

export async function writeLabels(runDir: string): Promise<number> {
  const findingsPath = join(runDir, 'findings.final.json')
  const raw = JSON.parse(await readFile(findingsPath, 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error(`${findingsPath} is not an array`)
  const findingIds = raw.map((f, i) => {
    const id = (f as { id?: unknown } | null)?.id
    if (typeof id !== 'string') throw new Error(`${findingsPath}[${i}] has no string id`)
    return id
  })

  // A run that never posted has no post-status.json; that means nothing was posted.
  let postStatus: PostStatusMap = {}
  try {
    postStatus = JSON.parse(await readFile(join(runDir, 'post-status.json'), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  const labels = foldLabels({
    findingIds,
    postStatus,
    events: await readJsonLines(join(runDir, 'state', 'events')),
    log: await readJsonLines(join(runDir, 'log.jsonl')),
  })
  await writeFile(join(runDir, 'labels.json'), `${JSON.stringify(labels, null, 2)}\n`)
  return labels.length
}

export async function runLabels(runDir: string): Promise<number> {
  const exists = await Bun.file(join(runDir, 'findings.final.json')).exists()
  if (!exists) {
    process.stderr.write(`labels: no findings.final.json in ${runDir}\n`)
    return 1
  }
  const count = await writeLabels(runDir)
  process.stdout.write(`wrote ${count} label(s) to ${join(runDir, 'labels.json')}\n`)
  return 0
}
