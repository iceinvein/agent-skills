import { copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { loadConfig } from './config.ts'
import { assertNotUnderSource, storePaths } from './paths.ts'
import { isMissingFrontmatter, loadQueue, parseQueueItem } from './queue.ts'
import { readTextFile } from './store.ts'

export async function runQueue(opts: { root: string; args: string[] }): Promise<number> {
  const [verb, ...rest] = opts.args
  const cfg = await loadConfig(opts.root)
  const queueDir = storePaths(opts.root).queueDir

  if (verb === 'add') {
    const file = rest[0]
    if (!file) {
      process.stderr.write('queue add: missing <file.md>\n')
      return 2
    }
    let text: string
    try {
      text = await readTextFile(file)
    } catch (e) {
      // Missing file, a directory passed as a file, or an unreadable file:
      // the request can never be serviced, the same usage-error class as
      // import-cmd.ts's and census-cmd.ts's readJsonFile catch.
      process.stderr.write(`queue add: ${(e as Error).message}\n`)
      return 2
    }
    const dest = join(queueDir, basename(file))
    const parsed = parseQueueItem(text, dest)
    if (!parsed.ok) {
      for (const e of parsed.errors) process.stderr.write(`queue add: ${e}\n`)
      // No frontmatter at all belongs to the same usage-error class as the
      // read failure above; every other grammar violation (bad severity, a
      // missing or empty section, a filename/id mismatch, an adjudicated
      // item with no ruling) is a well-formed file with bad content -- a
      // content failure instead.
      return isMissingFrontmatter(parsed.errors) ? 2 : 1
    }
    try {
      await assertNotUnderSource(dest, cfg.source.path)
    } catch (e) {
      // A store whose configured source.path resolves to include its own
      // queue directory (e.g. source.path: '.') can never be written to,
      // for any well-formed item whatsoever: an environment/config
      // problem, invariant across every possible file, not a property of
      // this item's own content, so it is a usage error (2), not the
      // content failure (1) returned just above for a bad grammar.
      process.stderr.write(`queue add: ${(e as Error).message}\n`)
      return 2
    }
    await mkdir(queueDir, { recursive: true })
    await copyFile(file, dest)
    process.stdout.write(`queue add: ${parsed.value.id} [${parsed.value.severity}]\n`)
    return 0
  }

  if (verb === 'list') {
    const openOnly = rest.includes('--open')
    const { items, errors } = await loadQueue(queueDir)
    for (const e of errors) process.stderr.write(`queue: ${e}\n`)
    const shown = openOnly ? items.filter((i) => i.status === 'open') : items
    for (const item of shown) {
      process.stdout.write(`${item.id}\t${item.severity}\t${item.status}\n`)
    }
    process.stdout.write(`${shown.length} item(s)\n`)
    return errors.length > 0 ? 1 : 0
  }

  if (verb === 'show') {
    const id = rest[0]
    if (!id) {
      process.stderr.write('queue show: missing <id>\n')
      return 2
    }
    const { items } = await loadQueue(queueDir)
    const item = items.find((i) => i.id === id)
    if (!item) {
      process.stderr.write(`queue show: no item ${id}\n`)
      return 1
    }
    let text: string
    try {
      text = await readTextFile(item.path)
    } catch (e) {
      // The item was in the index a moment ago; its file vanishing or
      // becoming unreadable between load and show is a domain failure on an
      // otherwise well-formed request, not a malformed one.
      process.stderr.write(`queue show: ${(e as Error).message}\n`)
      return 1
    }
    process.stdout.write(text)
    return 0
  }

  process.stderr.write('queue: want add <file.md> | list [--open] | show <id>\n')
  return 2
}
