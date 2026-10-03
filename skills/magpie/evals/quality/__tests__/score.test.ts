import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FindingLabel } from '../../../scripts/labels.ts'
import type { ReviewFinding } from '../../../scripts/types.ts'
import { assertOutsideRepo, buildCorpusRun, listSourceRuns, loadCorpusRun } from '../corpus.ts'
import { matchFindings, parseClaudeResult, scoreReplay, scoreSelection } from '../score.ts'

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

// 2 posted kept, 1 posted dropped, 1 dismissed `wrong` kept, 2 ignored kept.
const fixtureFindings: ReviewFinding[] = [
  finding({ id: 'p1', domain: 'bugs' }),
  finding({ id: 'p2', domain: 'security' }),
  finding({ id: 'p3', domain: 'bugs' }),
  finding({ id: 'd1', domain: 'bugs' }),
  finding({ id: 'i1', domain: 'code-smells' }),
  finding({ id: 'i2', domain: 'code-smells' }),
]
const fixtureLabels: FindingLabel[] = [
  { id: 'p1', label: 'posted', via: 'recommended' },
  { id: 'p2', label: 'posted', via: 'selected' },
  { id: 'p3', label: 'posted', via: 'selected' },
  { id: 'd1', label: 'dismissed', reason: 'wrong' },
  { id: 'i1', label: 'ignored' },
  { id: 'i2', label: 'ignored' },
]
const fixtureKept = ['p1', 'p2', 'd1', 'i1', 'i2']

function scoreFixture() {
  return scoreSelection({ labels: fixtureLabels, keptIds: fixtureKept, findings: fixtureFindings })
}

test('precision is posted kept over labelled kept', () => {
  expect(scoreFixture().precision).toBe(2 / 5)
})

test('recall is posted kept over all posted', () => {
  expect(scoreFixture().recall).toBe(2 / 3)
})

test('kept dismissals are counted by reason', () => {
  expect(scoreFixture().dismissedKept).toEqual({ wrong: 1 })
})

test('kept and posted-kept counts are split by domain', () => {
  expect(scoreFixture().byDomain).toEqual({
    bugs: { kept: 2, postedKept: 1 },
    security: { kept: 1, postedKept: 1 },
    'code-smells': { kept: 2, postedKept: 0 },
  })
})

test('posted kept findings are counted by post route', () => {
  expect(scoreFixture().byVia).toEqual({ recommended: 1, selected: 1 })
})

test('totals count kept, posted and posted kept', () => {
  const s = scoreFixture()
  expect([s.kept, s.posted, s.postedKept]).toEqual([5, 3, 2])
})

test('zero kept findings gives a null precision', () => {
  const s = scoreSelection({ labels: fixtureLabels, keptIds: [], findings: fixtureFindings })
  expect(s.precision).toBeNull()
})

test('a kept id with no label stays out of the precision denominator', () => {
  const findings = [...fixtureFindings, finding({ id: 'new-1' })]
  const s = scoreSelection({
    labels: fixtureLabels,
    keptIds: [...fixtureKept, 'new-1'],
    findings,
  })
  expect([s.kept, s.precision]).toEqual([6, 2 / 5])
})

test('a kept id missing from the findings is an error naming it', () => {
  expect(() =>
    scoreSelection({ labels: fixtureLabels, keptIds: ['ghost'], findings: fixtureFindings }),
  ).toThrow('ghost')
})

const labelled = finding({
  id: 'L',
  file: 'src/orders.ts',
  line: 10,
  title: 'Unbounded retry loop in fetchOrders handler',
})

test('a 4-line offset with a similar title matches', () => {
  const moved = finding({
    id: 'N',
    line: 14,
    title: 'Unbounded retry loop when fetchOrders fails',
  })
  expect(matchFindings([moved], [labelled])).toEqual(new Map([['N', 'L']]))
})

test('a 6-line offset does not match', () => {
  const moved = finding({ id: 'N', line: 16, title: labelled.title })
  expect(matchFindings([moved], [labelled]).size).toBe(0)
})

test('a different file does not match', () => {
  const elsewhere = finding({ id: 'N', file: 'src/billing.ts', title: labelled.title })
  expect(matchFindings([elsewhere], [labelled]).size).toBe(0)
})

test('two candidates for one labelled finding resolve to the higher dice', () => {
  const weaker = finding({ id: 'B', line: 11, title: 'Retry loop missing backoff' })
  const stronger = finding({ id: 'A', line: 12, title: labelled.title })
  expect(matchFindings([weaker, stronger], [labelled])).toEqual(new Map([['A', 'L']]))
})

test('a replayed finding that matches a posted one scores as posted kept', () => {
  const moved = finding({ id: 'bugs-9', line: 12, title: labelled.title })
  const { score } = scoreReplay({
    labels: [{ id: 'L', label: 'posted' }],
    labelled: [labelled],
    newKept: [moved],
  })
  expect([score.postedKept, score.precision]).toEqual([1, 1])
})

test('an unmatched replayed finding is unlabelled even when its id repeats a labelled id', () => {
  const unrelated = finding({ id: 'L', file: 'src/billing.ts', title: 'Totally different' })
  const { score, unlabelled } = scoreReplay({
    labels: [{ id: 'L', label: 'posted' }],
    labelled: [labelled],
    newKept: [unrelated],
  })
  expect([unlabelled, score.postedKept, score.precision]).toEqual([1, 0, null])
})

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'magpie-quality-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeRun(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true })
    await writeFile(join(dir, name), content)
  }
}

const postedRun = {
  'post-status.json': '{"a":"posted"}',
  'findings.final.json': JSON.stringify([finding({ id: 'a' })]),
}

test('an archived run with post status and final findings is a source run', async () => {
  await writeRun(join(root, 'pr-50-1.archived-2'), postedRun)
  expect(await listSourceRuns(root)).toEqual(['pr-50-1.archived-2'])
})

test('a preview run is not a source run', async () => {
  await writeRun(join(root, 'preview-123'), postedRun)
  expect(await listSourceRuns(root)).toEqual([])
})

test('a run that never posted is not a source run', async () => {
  await writeRun(join(root, 'pr-7-1'), {
    'findings.final.json': JSON.stringify([finding({ id: 'a' })]),
  })
  expect(await listSourceRuns(root)).toEqual([])
})

test('a corpus dir inside the repo is refused', () => {
  expect(() => assertOutsideRepo('/work/repo/corpus', '/work/repo')).toThrow('/work/repo')
})

test('a corpus dir beside the repo with a shared name prefix is allowed', () => {
  expect(() => assertOutsideRepo('/work/repo-corpus', '/work/repo')).not.toThrow()
})

test('a kept id absent from final findings is labelled ignored in the corpus', async () => {
  const src = join(root, 'pr-9-1')
  await writeRun(src, {
    ...postedRun,
    'findings.kept.json': JSON.stringify([finding({ id: 'a' }), finding({ id: 'b' })]),
  })
  await buildCorpusRun(src, join(root, 'corpus', 'pr-9-1'))
  const labels = JSON.parse(await readFile(join(root, 'corpus', 'pr-9-1', 'labels.json'), 'utf8'))
  expect(labels).toEqual([
    { id: 'a', label: 'posted' },
    { id: 'b', label: 'ignored' },
  ])
})

test('a corpus run without merge candidates loads them as absent', async () => {
  const dir = join(root, 'pr-9-1')
  await writeRun(dir, {
    'findings.final.json': JSON.stringify([finding({ id: 'a' })]),
    'labels.json': JSON.stringify([{ id: 'a', label: 'ignored' }]),
  })
  expect((await loadCorpusRun(dir)).mergeCandidates).toBeNull()
})

test('a corpus file that fails to parse is an error naming the file', async () => {
  const dir = join(root, 'pr-9-1')
  await writeRun(dir, {
    'findings.final.json': JSON.stringify([finding({ id: 'a' })]),
    'labels.json': JSON.stringify([{ id: 'a', label: 'ignored' }]),
    'merge-candidates.json': '{not json',
  })
  await expect(loadCorpusRun(dir)).rejects.toThrow(join(dir, 'merge-candidates.json'))
})

test('a claude result marked as an error is an error naming the step', () => {
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'error_max_budget_usd',
    is_error: true,
    result: 'budget exceeded',
  })
  expect(() => parseClaudeResult(stdout, 'critic batch 2')).toThrow('critic batch 2')
})

test('a successful claude result reports its cost', () => {
  const stdout = JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.42,
  })
  expect(parseClaudeResult(stdout, 'critic batch 1')).toEqual({ costUsd: 0.42 })
})
