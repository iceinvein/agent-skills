#!/usr/bin/env bun
// A stateful stand-in for `gh`, covering exactly the six invocations the
// github adapter makes. Magpie's fake-gh.sh is a static case statement, which
// is right for a tool that only reads; this adapter creates issues and then
// has to find them again on the next run, so idempotency cannot be tested
// against a fixture that forgets what it was told.
//
// State lives at <cwd>/gh-state.json and the invocation log at
// <cwd>/gh-log.txt. Both are keyed off the working directory rather than off
// environment variables, because the adapter already runs gh with cwd set to
// the target root and a spawned child does not reliably pick up an env var a
// test set on its own process after startup.
//
// Nothing here validates arguments the way real gh does. It exists to record
// what the adapter asked for and to answer consistently, not to be a
// specification of gh.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Milestone = { number: number; title: string; description: string }
type Issue = {
  number: number
  title: string
  body: string
  state: 'OPEN' | 'CLOSED'
  closedAt: string | null
  milestone: string | null
}
type State = { milestones: Milestone[]; issues: Issue[] }

const statePath = join(process.cwd(), 'gh-state.json')
const logPath = join(process.cwd(), 'gh-log.txt')
const argv = process.argv.slice(2)

appendFileSync(logPath, `${argv.join(' ')}\n`)

function load(): State {
  if (!existsSync(statePath)) return { milestones: [], issues: [] }
  return JSON.parse(readFileSync(statePath, 'utf8')) as State
}
function save(state: State): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}
function flag(name: string): string | undefined {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
// `gh api -f key=value` repeated; returns the value for a given key.
function field(key: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '-f') continue
    const pair = argv[i + 1] ?? ''
    if (pair.startsWith(`${key}=`)) return pair.slice(key.length + 1)
  }
  return undefined
}

const state = load()
const out = (v: unknown): void => {
  process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v)}\n`)
}

if (argv[0] === 'repo' && argv[1] === 'view') {
  out({ nameWithOwner: 'acme/target' })
} else if (argv[0] === 'api' && (argv[2] === '-X' ? argv[3] : '') === 'POST') {
  const title = field('title') ?? ''
  const description = field('description') ?? ''
  const number = state.milestones.length + 1
  state.milestones.push({ number, title, description })
  save(state)
  out({ number, title, description })
} else if (argv[0] === 'api') {
  out(state.milestones)
} else if (argv[0] === 'issue' && argv[1] === 'list') {
  out(
    state.issues.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      state: i.state,
      closedAt: i.closedAt,
    })),
  )
} else if (argv[0] === 'issue' && argv[1] === 'create') {
  const number = 100 + state.issues.length
  state.issues.push({
    number,
    title: flag('--title') ?? '',
    body: flag('--body') ?? '',
    state: 'OPEN',
    closedAt: null,
    milestone: flag('--milestone') ?? null,
  })
  save(state)
  out(`https://github.com/acme/target/issues/${number}`)
} else if (argv[0] === 'issue' && argv[1] === 'edit') {
  const number = Number(argv[2])
  const issue = state.issues.find((i) => i.number === number)
  if (!issue) {
    process.stderr.write(`no issue ${number}\n`)
    process.exit(1)
  }
  const body = flag('--body')
  if (body !== undefined) issue.body = body
  const milestone = flag('--milestone')
  if (milestone !== undefined) issue.milestone = milestone
  save(state)
  out(`https://github.com/acme/target/issues/${number}`)
} else {
  process.stderr.write(`fake-gh: unhandled invocation: ${argv.join(' ')}\n`)
  process.exit(1)
}
