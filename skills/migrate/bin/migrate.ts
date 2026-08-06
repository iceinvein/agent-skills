#!/usr/bin/env bun

import pkg from '../package.json' with { type: 'json' }

const VERSION = (pkg as { version: string }).version

const USAGE = `Usage: migrate <subcommand> [args]

Subcommands:
  init --source <path> --scope <text> --name <target>
                                  Write .migrate/config.toml
  import <elements|reqs|deltas> <batch.json>
                                  Validated bulk append to the store
  census <record.json>            Record a lens accounting record
  queue add <file.md>             Add a queue item
  queue list [--open]             List queue items, severity first
  queue show <id>                 Print one queue item
  check [--citations] [--leaks]   Run the gates
  status                          Phase state, counts, resume pointer
  reset --phase <phase>           Clear one phase's derived rows
  report [--out <dir>]            Render markdown views
  --version                       Print the migrate version
  --help                          Show this message`

type Handler = (args: string[]) => Promise<number> | number

const HANDLERS: Record<string, Handler> = {
  import: async (args) => {
    const kind = args[0]
    const file = args[1]
    if (kind !== 'elements' && kind !== 'reqs' && kind !== 'deltas') {
      process.stderr.write('import: want <elements|reqs|deltas> <batch.json>\n')
      return 2
    }
    if (!file) {
      process.stderr.write('import: missing <batch.json>\n')
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('import: no .migrate store found above the cwd\n')
      return 2
    }
    const { runImport } = await import('../scripts/import-cmd.ts')
    return runImport({ root, kind, batchFile: file })
  },
  census: async (args) => {
    const file = args[0]
    if (!file) {
      process.stderr.write('census: missing <record.json>\n')
      return 2
    }
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('census: no .migrate store found above the cwd\n')
      return 2
    }
    const { runCensus } = await import('../scripts/census-cmd.ts')
    return runCensus({ root, file })
  },
  queue: async (args) => {
    const { findStoreRoot } = await import('../scripts/paths.ts')
    const root = await findStoreRoot(process.cwd())
    if (!root) {
      process.stderr.write('queue: no .migrate store found above the cwd\n')
      return 2
    }
    const { runQueue } = await import('../scripts/queue-cmd.ts')
    return runQueue({ root, args })
  },
}

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (sub === '--help' || sub === '-h') {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (sub === '--version' || sub === '-V') {
    process.stdout.write(`migrate ${VERSION}\n`)
    return 0
  }
  if (!sub) {
    process.stderr.write(`${USAGE}\n`)
    return 2
  }
  const handler = HANDLERS[sub]
  if (!handler) {
    process.stderr.write(`Unknown subcommand: ${sub}\n${USAGE}\n`)
    return 2
  }
  return await handler(rest)
}

const code = await main(process.argv.slice(2))
process.exit(code)
