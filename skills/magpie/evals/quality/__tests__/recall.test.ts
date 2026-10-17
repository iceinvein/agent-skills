import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReviewFinding } from '../../../scripts/types.ts'
import { listCorpusRuns } from '../corpus.ts'
import {
  loadMisses,
  type Miss,
  parseRecallVerdicts,
  type RecallVerdict,
  recallJudgeCommand,
  recallPrompt,
  scoreRecall,
} from '../recall.ts'

function finding(over: Partial<ReviewFinding> & { id: string }): ReviewFinding {
  return {
    file: 'src/orders.ts',
    line: 10,
    severity: 'medium',
    risk: { impact: 'medium', likelihood: 'possible', confidence: 'medium', action: 'should-fix' },
    title: 'Something is off',
    description: 'Details.',
    domain: 'bugs',
    ...over,
  }
}

function miss(over: Partial<Miss> & { id: string }): Miss {
  return {
    file: 'src/orders.ts',
    line: 42,
    title: 'Refund ignores partial captures',
    summary: 'A partially captured order refunds the full amount.',
    ownerDomain: 'bugs',
    bugClass: 'contract',
    outsideDiff: false,
    preExisting: false,
    source: 'human review comment',
    ...over,
  }
}

const findings = [finding({ id: 'bugs-1' }), finding({ id: 'security-2' })]
const misses = [miss({ id: 'm1' }), miss({ id: 'm2' })]

test('a bare verdict array covering every miss is accepted', () => {
  const text = JSON.stringify([
    { missId: 'm1', findingId: 'bugs-1', reason: 'Same refund defect.' },
    { missId: 'm2', findingId: null, reason: 'Nothing describes it.' },
  ])
  expect(parseRecallVerdicts(text, misses, findings)).toEqual([
    { missId: 'm1', findingId: 'bugs-1', reason: 'Same refund defect.' },
    { missId: 'm2', findingId: null, reason: 'Nothing describes it.' },
  ])
})

test('a verdict array inside a fenced json block is accepted', () => {
  const text =
    'Here are the verdicts.\n```json\n' +
    '[{"missId":"m1","findingId":null,"reason":"No match."},' +
    '{"missId":"m2","findingId":"security-2","reason":"Same defect."}]\n```\n'
  expect(parseRecallVerdicts(text, misses, findings)).toEqual([
    { missId: 'm1', findingId: null, reason: 'No match.' },
    { missId: 'm2', findingId: 'security-2', reason: 'Same defect.' },
  ])
})

test('a verdict array inside an untagged fence is accepted', () => {
  const text =
    '```\n[{"missId":"m1","findingId":"bugs-1","reason":"Same defect."},' +
    '{"missId":"m2","findingId":null,"reason":"No match."}]\n```'
  expect(parseRecallVerdicts(text, misses, findings)).toEqual([
    { missId: 'm1', findingId: 'bugs-1', reason: 'Same defect.' },
    { missId: 'm2', findingId: null, reason: 'No match.' },
  ])
})

test('a verdict array wrapped in prose without a fence is accepted', () => {
  const text =
    'Verdicts follow. [{"missId":"m1","findingId":null,"reason":"No match [none]."},' +
    '{"missId":"m2","findingId":"security-2","reason":"Same defect."}] That is all.'
  expect(parseRecallVerdicts(text, misses, findings)).toEqual([
    { missId: 'm1', findingId: null, reason: 'No match [none].' },
    { missId: 'm2', findingId: 'security-2', reason: 'Same defect.' },
  ])
})

test('a verdict with no findingId is rejected', () => {
  const text = JSON.stringify([
    { missId: 'm1', reason: 'No match.' },
    { missId: 'm2', findingId: null, reason: 'No match.' },
  ])
  expect(() => parseRecallVerdicts(text, misses, findings)).toThrow('[0]')
})

test('a verdict whose reason is not a string is rejected', () => {
  const text = JSON.stringify([
    { missId: 'm1', findingId: null, reason: 'No match.' },
    { missId: 'm2', findingId: null, reason: 7 },
  ])
  expect(() => parseRecallVerdicts(text, misses, findings)).toThrow('[1]')
})

test('the recall judge runs with no MCP servers and no tools', () => {
  expect(recallJudgeCommand('claude-sonnet-5-5')).toEqual([
    'claude',
    '-p',
    '--model',
    'claude-sonnet-5-5',
    '--output-format',
    'json',
    '--strict-mcp-config',
    '--tools',
    '',
  ])
})

test('verdicts that leave a miss unjudged are rejected', () => {
  const text = JSON.stringify([{ missId: 'm1', findingId: null, reason: 'No match.' }])
  expect(() => parseRecallVerdicts(text, misses, findings)).toThrow('m2')
})

test('verdicts that judge a miss twice are rejected', () => {
  const text = JSON.stringify([
    { missId: 'm1', findingId: null, reason: 'No match.' },
    { missId: 'm1', findingId: 'bugs-1', reason: 'Same defect.' },
    { missId: 'm2', findingId: null, reason: 'No match.' },
  ])
  expect(() => parseRecallVerdicts(text, misses, findings)).toThrow('m1')
})

test('a verdict for a miss not in the set is rejected', () => {
  const text = JSON.stringify([
    { missId: 'm1', findingId: null, reason: 'No match.' },
    { missId: 'm2', findingId: null, reason: 'No match.' },
    { missId: 'm9', findingId: null, reason: 'No match.' },
  ])
  expect(() => parseRecallVerdicts(text, misses, findings)).toThrow('m9')
})

test('a verdict naming a finding that was not kept is rejected', () => {
  const text = JSON.stringify([
    { missId: 'm1', findingId: 'bugs-7', reason: 'Same defect.' },
    { missId: 'm2', findingId: null, reason: 'No match.' },
  ])
  expect(() => parseRecallVerdicts(text, misses, findings)).toThrow('bugs-7')
})

test('a judge reply that is not JSON is rejected', () => {
  expect(() => parseRecallVerdicts('I could not decide.', misses, findings)).toThrow()
})

test('a judge reply that is a JSON object rather than an array is rejected', () => {
  const text = '{"missId":"m1","findingId":null,"reason":"No match."}'
  expect(() => parseRecallVerdicts(text, misses, findings)).toThrow('array')
})

test('recall counts caught misses overall, by domain, by class and without pre-existing ones', () => {
  const set = [
    miss({ id: 'a', ownerDomain: 'bugs', bugClass: 'contract' }),
    miss({ id: 'b', ownerDomain: 'bugs', bugClass: 'null-handling', preExisting: true }),
    miss({ id: 'c', ownerDomain: 'security', bugClass: 'contract' }),
  ]
  const verdicts: RecallVerdict[] = [
    { missId: 'a', findingId: 'bugs-1', reason: 'Same.' },
    { missId: 'b', findingId: 'bugs-3', reason: 'Same.' },
    { missId: 'c', findingId: null, reason: 'None.' },
  ]
  expect(scoreRecall(set, verdicts)).toEqual({
    misses: 3,
    caught: 2,
    recall: 2 / 3,
    byDomain: { bugs: { misses: 2, caught: 2 }, security: { misses: 1, caught: 0 } },
    byClass: { contract: { misses: 2, caught: 1 }, 'null-handling': { misses: 1, caught: 1 } },
    excludingPreExisting: { misses: 2, caught: 1, recall: 1 / 2 },
  })
})

test('recall over an empty miss set is null rather than zero', () => {
  expect(scoreRecall([], [])).toEqual({
    misses: 0,
    caught: 0,
    recall: null,
    byDomain: {},
    byClass: {},
    excludingPreExisting: { misses: 0, caught: 0, recall: null },
  })
})

test('the recall prompt names every miss and every kept finding', () => {
  const prompt = recallPrompt(
    [miss({ id: 'miss-alpha' }), miss({ id: 'miss-beta' })],
    [finding({ id: 'bugs-11' }), finding({ id: 'contracts-4' })],
  )
  for (const id of ['miss-alpha', 'miss-beta', 'bugs-11', 'contracts-4']) {
    expect(prompt).toContain(id)
  }
})

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'magpie-recall-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

test('a missing recall set loads as null', async () => {
  expect(await loadMisses(join(root, 'misses', 'pr-1-1.json'))).toBeNull()
})

test('a recall set file loads its misses', async () => {
  const path = join(root, 'pr-1-1.json')
  await writeFile(path, JSON.stringify([miss({ id: 'm1' })]))
  expect(await loadMisses(path)).toEqual([miss({ id: 'm1' })])
})

test('a malformed miss is rejected naming the file and its index', async () => {
  const path = join(root, 'pr-1-1.json')
  const { bugClass: _, ...noClass } = miss({ id: 'm2' })
  await writeFile(path, JSON.stringify([miss({ id: 'm1' }), noClass]))
  await expect(loadMisses(path)).rejects.toThrow(`${path}[1]`)
})

test('the corpus run list leaves out the results and misses directories', async () => {
  await mkdir(join(root, 'results'))
  await mkdir(join(root, 'misses'))
  await mkdir(join(root, 'pr-46-1787748571'))
  expect(await listCorpusRuns(root)).toEqual(['pr-46-1787748571'])
})
