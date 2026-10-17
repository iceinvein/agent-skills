import { expect, test } from 'bun:test'
import { replaySummary } from '../replay-full.ts'

const base = {
  runId: 'pr-50-1789099641',
  kept: 12,
  unlabelled: 4,
  precision: 0.5,
  recall: 0.75,
  costUsd: 3.456,
  outPath: '/corpus/results/x-full-pr-50-1789099641.json',
}

test('a replay without a recall set prints no missed-recall figure', () => {
  expect(replaySummary({ ...base, missedRecall: null })).toBe(
    'pr-50-1789099641: kept 12 (4 unlabelled), precision 0.50, recall 0.75, cost $3.46\n' +
      'wrote /corpus/results/x-full-pr-50-1789099641.json\n',
  )
})

test('a replay judged against a recall set prints caught over misses', () => {
  expect(replaySummary({ ...base, missedRecall: { caught: 3, misses: 14 } })).toBe(
    'pr-50-1789099641: kept 12 (4 unlabelled), precision 0.50, recall 0.75, cost $3.46, ' +
      'missed-recall 3/14\nwrote /corpus/results/x-full-pr-50-1789099641.json\n',
  )
})

test('a replay whose cost Claude did not report says so', () => {
  expect(
    replaySummary({ ...base, precision: null, recall: null, costUsd: null, missedRecall: null }),
  ).toBe(
    'pr-50-1789099641: kept 12 (4 unlabelled), precision -, recall -, cost unreported\n' +
      'wrote /corpus/results/x-full-pr-50-1789099641.json\n',
  )
})
