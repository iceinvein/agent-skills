import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProofDropped, runProofApply, runProofPrompt } from '../proof-cmd.ts'
import type { ReviewFinding, Risk } from '../types.ts'

let runDir: string
let repo: string
let stdout: string
let stderr: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-proof-'))
  await writeFile(join(runDir, 'log.jsonl'), '')
  repo = await mkdtemp(join(tmpdir(), 'magpie-proof-repo-'))
  const init = Bun.spawn(['git', 'init', '-q', repo], { stdout: 'pipe', stderr: 'pipe' })
  if ((await init.exited) !== 0) throw new Error(await new Response(init.stderr).text())
  stdout = ''
  stderr = ''
  spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk)
    return true
  })
  spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk)
    return true
  })
})

afterEach(async () => {
  mock.restore()
  await rm(runDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

const HIGH: Risk = {
  impact: 'high',
  likelihood: 'possible',
  confidence: 'high',
  action: 'must-fix',
}
const LOW: Risk = { impact: 'low', likelihood: 'possible', confidence: 'high', action: 'optional' }

function finding(id: string, risk: Risk): ReviewFinding {
  return {
    id,
    file: 'src/a.ts',
    line: 10,
    severity: risk.impact === 'high' ? 'high' : 'low',
    risk,
    title: `title ${id}`,
    description: `description ${id}`,
    domain: 'bugs',
  }
}

const REPRO = {
  path: 'magpie-proof-a.test.ts',
  command: 'bun test magpie-proof-a.test.ts',
  source: 'test',
  output: 'fail',
}

const TEMPLATE_DOC = [
  '# Proof',
  '',
  '````magpie-proof',
  'Finding: <<FINDING>>',
  'Worktree: <<WORKTREE>>',
  'Diff: <<DIFF_PATH>>',
  'Write to: <<OUTPUT_PATH>>',
  '````',
  '',
].join('\n')

async function seedRun(findings: ReviewFinding[]): Promise<string> {
  await writeFile(join(runDir, 'findings.final.json'), JSON.stringify(findings))
  await writeFile(join(runDir, 'target.json'), JSON.stringify({ mode: 'local', root: repo }))
  const templatePath = join(runDir, 'proof.md')
  await writeFile(templatePath, TEMPLATE_DOC)
  return templatePath
}

async function readJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(runDir, name), 'utf8'))
}

test('proof-prompt writes a prompt for each selected finding and prints its paths', async () => {
  const templatePath = await seedRun([finding('a', HIGH), finding('b', LOW)])

  const exit = await runProofPrompt(runDir, { templatePath })

  expect(exit).toBe(0)
  const promptPath = join(runDir, 'proof-prompt-a.md')
  expect(stdout).toBe(`${promptPath}\t${join(runDir, 'proof-a.json')}\n`)
  const prompt = await readFile(promptPath, 'utf8')
  expect(prompt).toContain(`Worktree: ${repo}`)
  expect(prompt).toContain('"id": "a"')
})

test('proof-prompt prints nothing when no finding qualifies', async () => {
  const templatePath = await seedRun([finding('b', LOW)])
  expect(await runProofPrompt(runDir, { templatePath })).toBe(0)
  expect(stdout).toBe('')
})

test('proof-apply folds results into the final findings and records the disproved ones', async () => {
  const templatePath = await seedRun([finding('a', HIGH), finding('c', HIGH), finding('b', LOW)])
  await runProofPrompt(runDir, { templatePath })
  await writeFile(
    join(runDir, 'proof-a.json'),
    JSON.stringify({ id: 'a', outcome: 'reproduced', reason: 'fails', repro: REPRO }),
  )
  await writeFile(
    join(runDir, 'proof-c.json'),
    JSON.stringify({ id: 'c', outcome: 'disproved', reason: 'guarded', repro: REPRO }),
  )

  const exit = await runProofApply(runDir)

  expect(stderr).toBe('')
  expect(exit).toBe(0)
  const final = (await readJson('findings.final.json')) as ReviewFinding[]
  expect(final.map((f) => [f.id, f.proof?.status ?? null])).toEqual([
    ['a', 'reproduced'],
    ['b', null],
  ])
  expect(await readJson('proof-dropped.json')).toEqual([
    { id: 'c', file: 'src/a.ts', line: 10, title: 'title c', reason: 'guarded', repro: REPRO },
  ])
  const log = (await readFile(join(runDir, 'log.jsonl'), 'utf8')).trim().split('\n')
  expect(JSON.parse(log.at(-1) as string)).toMatchObject({
    stage: 'proof',
    status: 'done',
    reproduced: 1,
    notProven: 0,
    disproved: 1,
  })
})

test('proof-apply run twice gives the same final findings', async () => {
  const templatePath = await seedRun([finding('a', HIGH), finding('c', HIGH)])
  await runProofPrompt(runDir, { templatePath })
  await writeFile(
    join(runDir, 'proof-a.json'),
    JSON.stringify({ id: 'a', outcome: 'not-proven', reason: 'no runner' }),
  )
  await writeFile(
    join(runDir, 'proof-c.json'),
    JSON.stringify({ id: 'c', outcome: 'disproved', reason: 'guarded', repro: REPRO }),
  )
  await runProofApply(runDir)
  const first = await readJson('findings.final.json')

  expect(await runProofApply(runDir)).toBe(0)
  expect(await readJson('findings.final.json')).toEqual(first)
})

test('proof-prompt run again after apply still selects from the findings before proof', async () => {
  const templatePath = await seedRun([finding('a', HIGH)])
  await runProofPrompt(runDir, { templatePath })
  await writeFile(
    join(runDir, 'proof-a.json'),
    JSON.stringify({ id: 'a', outcome: 'disproved', reason: 'guarded', repro: REPRO }),
  )
  await runProofApply(runDir)
  stdout = ''

  await runProofPrompt(runDir, { templatePath })

  expect(stdout).toBe(`${join(runDir, 'proof-prompt-a.md')}\t${join(runDir, 'proof-a.json')}\n`)
})

test('proof-apply fails naming each selected finding whose result file is missing', async () => {
  const templatePath = await seedRun([finding('a', HIGH), finding('c', HIGH)])
  await runProofPrompt(runDir, { templatePath })
  await writeFile(
    join(runDir, 'proof-a.json'),
    JSON.stringify({ id: 'a', outcome: 'not-proven', reason: 'no runner' }),
  )

  expect(await runProofApply(runDir)).toBe(1)
  expect(stderr).toBe(`proof-apply: no proof result: ${join(runDir, 'proof-c.json')}\n`)
})

test('proof-apply fails on a result file whose id is not its finding', async () => {
  const templatePath = await seedRun([finding('a', HIGH)])
  await runProofPrompt(runDir, { templatePath })
  await writeFile(
    join(runDir, 'proof-a.json'),
    JSON.stringify({ id: 'other', outcome: 'not-proven', reason: 'r' }),
  )

  expect(await runProofApply(runDir)).toBe(1)
  expect(stderr).toBe(`proof-apply: ${join(runDir, 'proof-a.json')}: id is other, expected a\n`)
})

test('proof-apply before proof-prompt fails', async () => {
  await seedRun([finding('a', HIGH)])
  expect(await runProofApply(runDir)).toBe(1)
  expect(stderr).toContain('findings.unproven.json')
})

test('proof-apply fails naming a repro a prover left in the worktree', async () => {
  const templatePath = await seedRun([finding('a', HIGH)])
  await runProofPrompt(runDir, { templatePath })
  await writeFile(
    join(runDir, 'proof-a.json'),
    JSON.stringify({ id: 'a', outcome: 'not-proven', reason: 'no runner' }),
  )
  await mkdir(join(repo, 'src'))
  await writeFile(join(repo, 'src', 'magpie-proof-a.test.ts'), 'test')

  expect(await runProofApply(runDir)).toBe(1)
  expect(stderr).toBe(
    `proof-apply: provers left files in ${repo}; delete them: src/magpie-proof-a.test.ts\n`,
  )
})

test('proof-apply rewrites the worktree path in a repro to a relative one', async () => {
  const templatePath = await seedRun([finding('a', HIGH)])
  await runProofPrompt(runDir, { templatePath })
  await writeFile(
    join(runDir, 'proof-a.json'),
    JSON.stringify({
      id: 'a',
      outcome: 'reproduced',
      reason: 'fails',
      repro: {
        path: 'src/magpie-proof-a.test.ts',
        command: `cd ${repo} && bun test src/magpie-proof-a.test.ts`,
        source: 'test',
        output: `at ${repo}/src/a.ts:10`,
      },
    }),
  )

  expect(await runProofApply(runDir)).toBe(0)
  const final = (await readJson('findings.final.json')) as ReviewFinding[]
  expect(final[0]?.proof).toEqual({
    status: 'reproduced',
    reason: 'fails',
    repro: {
      path: 'src/magpie-proof-a.test.ts',
      command: 'cd . && bun test src/magpie-proof-a.test.ts',
      source: 'test',
      output: 'at ./src/a.ts:10',
    },
  })
})

test('a run with no proof-dropped.json has no disproved findings', async () => {
  expect(await readProofDropped(runDir)).toEqual([])
})

test('readProofDropped fails on a file that does not parse, naming it', async () => {
  await writeFile(join(runDir, 'proof-dropped.json'), '{nope')
  await expect(readProofDropped(runDir)).rejects.toThrow(join(runDir, 'proof-dropped.json'))
})
