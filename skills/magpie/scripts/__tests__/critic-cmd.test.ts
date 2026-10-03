import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCriticApply, runCriticPrompt } from '../critic-cmd.ts'
import type { ReviewFinding } from '../types.ts'

let runDir: string
let stdout: string
let stderr: string

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-critic-'))
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
})

function finding(id: string, domain: string): ReviewFinding {
  return {
    id,
    file: 'src/a.ts',
    line: 10,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: `title ${id}`,
    description: `description ${id}`,
    domain,
  }
}

async function writeDeduped(findings: ReviewFinding[]): Promise<void> {
  await writeFile(join(runDir, 'findings.deduped.json'), JSON.stringify(findings))
}

const TEMPLATE_DOC = [
  '# Critic',
  '',
  '````magpie-critic',
  'Candidates: <<CANDIDATES>>',
  'Groups: <<MERGE_CANDIDATES>>',
  'Rules: <<REVIEW_RULES>>',
  'Worktree: <<WORKTREE>>',
  'Diff: <<DIFF_PATH>>',
  'Write to: <<OUTPUT_PATH>>',
  '````',
  '',
].join('\n')

test('critic-prompt writes the prompt file from the magpie-critic block and prints its paths', async () => {
  const templatePath = join(runDir, 'critic.md')
  await writeFile(templatePath, TEMPLATE_DOC)
  await writeDeduped([finding('a', 'bugs')])
  await writeFile(
    join(runDir, 'brief.json'),
    JSON.stringify({
      purpose: 'p',
      reviewRules: [{ rule: 'no default exports', source: 'CLAUDE.md' }],
    }),
  )

  const exit = await runCriticPrompt(runDir, { templatePath })

  expect(exit).toBe(0)
  const promptPath = join(runDir, 'critic-prompt.md')
  const outputPath = join(runDir, 'critic.json')
  expect(stdout).toBe(`${promptPath}\t${outputPath}\n`)
  const prompt = await readFile(promptPath, 'utf8')
  expect(prompt.startsWith('Candidates: [')).toBe(true)
  expect(prompt).toContain('"id": "a"')
  expect(prompt).toContain('Groups: []\n')
  expect(prompt).toContain('Rules: - no default exports (CLAUDE.md)\n')
  expect(prompt).toContain(`Worktree: ${join(runDir, 'worktree')}\n`)
  expect(prompt).toContain(`Diff: ${join(runDir, 'diff.patch')}\n`)
  expect(prompt).toContain(`Write to: ${outputPath}`)
})

test('critic-prompt writes one numbered prompt per batch', async () => {
  const templatePath = join(runDir, 'critic.md')
  await writeFile(templatePath, TEMPLATE_DOC)
  await writeDeduped([finding('a', 'bugs'), finding('b', 'bugs'), finding('c', 'bugs')])

  const exit = await runCriticPrompt(runDir, { templatePath, batchSize: 2 })

  expect(exit).toBe(0)
  expect(stdout).toBe(
    `${join(runDir, 'critic-prompt-1.md')}\t${join(runDir, 'critic-1.json')}\n` +
      `${join(runDir, 'critic-prompt-2.md')}\t${join(runDir, 'critic-2.json')}\n`,
  )
  expect(existsSync(join(runDir, 'critic-prompt-2.md'))).toBe(true)
})

test('critic-prompt with a template using old placeholders exits 1 naming the missing ones', async () => {
  const templatePath = join(runDir, 'critic.md')
  await writeFile(
    templatePath,
    '````magpie-critic\n<<DEDUPED_FINDINGS_COMPACT>>\n<<DIFF_EXCERPT>>\n````\n',
  )
  await writeDeduped([finding('a', 'bugs')])

  const exit = await runCriticPrompt(runDir, { templatePath })

  expect(exit).toBe(1)
  expect(stderr).toContain('<<CANDIDATES>>')
  expect(stderr).toContain('<<OUTPUT_PATH>>')
  expect(existsSync(join(runDir, 'critic-prompt.md'))).toBe(false)
})

test('critic-apply writes kept findings and dropped verdicts', async () => {
  await writeDeduped([finding('a', 'bugs'), finding('b', 'security')])
  await writeFile(
    join(runDir, 'critic.json'),
    JSON.stringify([
      {
        id: 'a',
        verdict: 'keep',
        reason: 'reachable',
        risk: { impact: 'high', likelihood: 'likely', confidence: 'high', action: 'must-fix' },
        checked: ['src/a.ts:10'],
      },
      { id: 'b', verdict: 'drop', reason: 'input is validated upstream', checked: ['src/b.ts:3'] },
    ]),
  )

  const exit = await runCriticApply(runDir)

  expect(exit).toBe(0)
  const kept = JSON.parse(await readFile(join(runDir, 'findings.kept.json'), 'utf8'))
  expect(kept.map((f: ReviewFinding) => f.id)).toEqual(['a'])
  expect(kept[0].severity).toBe('high')
  const dropped = JSON.parse(await readFile(join(runDir, 'critic-dropped.json'), 'utf8'))
  expect(dropped).toEqual([{ id: 'b', reason: 'input is validated upstream' }])
  const log = await readFile(join(runDir, 'log.jsonl'), 'utf8')
  expect(JSON.parse(log.trim())).toMatchObject({
    stage: 'critic',
    status: 'done',
    kept: 1,
    dropped: 1,
    merged: 0,
    capped: 0,
  })
})

function designKeeps(ids: string[]) {
  return ids.map((id) => ({
    id,
    verdict: 'keep',
    reason: 'names the change it breaks',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'high', action: 'should-fix' },
    checked: ['src/a.ts:10'],
  }))
}

test('critic-apply with no --design-cap keeps every design finding the critic kept', async () => {
  const ids = ['a1', 'a2', 's1', 's2', 's3']
  await writeDeduped(
    ids.map((id) => finding(id, id.startsWith('a') ? 'architecture' : 'code-smells')),
  )
  await writeFile(join(runDir, 'critic.json'), JSON.stringify(designKeeps(ids)))

  const exit = await runCriticApply(runDir)

  expect(exit).toBe(0)
  const kept = JSON.parse(await readFile(join(runDir, 'findings.kept.json'), 'utf8'))
  expect(kept.map((f: ReviewFinding) => f.id)).toEqual(ids)
})

test('critic-apply with --design-cap 3 drops design keeps beyond three', async () => {
  const ids = ['a1', 'a2', 's1', 's2', 's3']
  await writeDeduped(
    ids.map((id) => finding(id, id.startsWith('a') ? 'architecture' : 'code-smells')),
  )
  await writeFile(join(runDir, 'critic.json'), JSON.stringify(designKeeps(ids)))

  const exit = await runCriticApply(runDir, { designCap: 3 })

  expect(exit).toBe(0)
  const kept = JSON.parse(await readFile(join(runDir, 'findings.kept.json'), 'utf8'))
  expect(kept.map((f: ReviewFinding) => f.id)).toEqual(['a1', 'a2', 's1'])
})

test('critic-apply reads every numbered critic file', async () => {
  await writeDeduped([finding('a', 'bugs'), finding('b', 'bugs')])
  await writeFile(
    join(runDir, 'critic-1.json'),
    JSON.stringify([{ id: 'a', verdict: 'drop', reason: 'r1', checked: [] }]),
  )
  await writeFile(
    join(runDir, 'critic-2.json'),
    JSON.stringify([{ id: 'b', verdict: 'drop', reason: 'r2', checked: [] }]),
  )

  const exit = await runCriticApply(runDir)

  expect(exit).toBe(0)
  const dropped = JSON.parse(await readFile(join(runDir, 'critic-dropped.json'), 'utf8'))
  expect(dropped).toEqual([
    { id: 'a', reason: 'r1' },
    { id: 'b', reason: 'r2' },
  ])
})

test('critic-apply with a candidate missing its verdict exits 1 naming the id', async () => {
  await writeDeduped([finding('a', 'bugs'), finding('forgotten', 'bugs')])
  await writeFile(
    join(runDir, 'critic.json'),
    JSON.stringify([{ id: 'a', verdict: 'drop', reason: 'r', checked: [] }]),
  )

  const exit = await runCriticApply(runDir)

  expect(exit).toBe(1)
  expect(stderr).toContain('forgotten')
  expect(existsSync(join(runDir, 'findings.kept.json'))).toBe(false)
})

test('critic-apply with no candidates and no critic file writes an empty kept list', async () => {
  await writeDeduped([])

  const exit = await runCriticApply(runDir)

  expect(exit).toBe(0)
  expect(JSON.parse(await readFile(join(runDir, 'findings.kept.json'), 'utf8'))).toEqual([])
})

test('critic-apply with candidates but no critic file exits 1 naming the missing file', async () => {
  await writeDeduped([finding('a', 'bugs')])

  const exit = await runCriticApply(runDir)

  expect(exit).toBe(1)
  expect(stderr).toContain('critic.json')
})

test('critic-apply with a critic file that is not JSON exits 1 naming that file', async () => {
  await writeDeduped([finding('a', 'bugs')])
  await writeFile(join(runDir, 'critic-1.json'), JSON.stringify([]))
  await writeFile(
    join(runDir, 'critic-2.json'),
    '```json\n[{"id": "a", "verdict": "drop", "reason": "r", "checked": []}]\n```\n',
  )

  const exit = await runCriticApply(runDir)

  expect(exit).toBe(1)
  expect(stderr).toContain(join(runDir, 'critic-2.json'))
})
