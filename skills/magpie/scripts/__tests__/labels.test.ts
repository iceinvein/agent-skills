import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldLabels, readDismissed } from '../labels.ts'

test('a posted id is labelled posted with the via from its post log entry', () => {
  const labels = foldLabels({
    findingIds: ['a'],
    postStatus: { a: 'posted' },
    events: [],
    log: [
      { stage: 'post', status: 'start', count: 1 },
      { stage: 'post', status: 'ok', id: 'a', via: 'recommended' },
    ],
  })
  expect(labels).toEqual([{ id: 'a', label: 'posted', via: 'recommended' }])
})

test('dismiss followed by undismiss leaves the id ignored', () => {
  const labels = foldLabels({
    findingIds: ['a'],
    postStatus: {},
    events: [
      { type: 'dismiss', findingId: 'a', reason: 'wrong', timestamp: 1 },
      { type: 'undismiss', findingId: 'a', timestamp: 2 },
    ],
    log: [],
  })
  expect(labels).toEqual([{ id: 'a', label: 'ignored' }])
})

test('undismiss followed by dismiss style leaves the id dismissed as style', () => {
  const labels = foldLabels({
    findingIds: ['a'],
    postStatus: {},
    events: [
      { type: 'undismiss', findingId: 'a', timestamp: 1 },
      { type: 'dismiss', findingId: 'a', reason: 'style', timestamp: 2 },
    ],
    log: [],
  })
  expect(labels).toEqual([{ id: 'a', label: 'dismissed', reason: 'style' }])
})

test('a dismissed id that was later posted is labelled posted', () => {
  const labels = foldLabels({
    findingIds: ['a'],
    postStatus: { a: 'posted' },
    events: [{ type: 'dismiss', findingId: 'a', reason: 'not-worth-it', timestamp: 1 }],
    log: [{ stage: 'post', status: 'ok', id: 'a', via: 'one' }],
  })
  expect(labels).toEqual([{ id: 'a', label: 'posted', via: 'one' }])
})

test('an id with no events and no post is labelled ignored', () => {
  const labels = foldLabels({ findingIds: ['a'], postStatus: {}, events: [], log: [] })
  expect(labels).toEqual([{ id: 'a', label: 'ignored' }])
})

test('a failed post status does not count as posted', () => {
  const labels = foldLabels({
    findingIds: ['a'],
    postStatus: { a: { status: 'failed', message: 'gh exited 1' } },
    events: [],
    log: [{ stage: 'post', status: 'failed', id: 'a', error: 'gh exited 1' }],
  })
  expect(labels).toEqual([{ id: 'a', label: 'ignored' }])
})

test('a posted id from a run that logged no via is labelled without via', () => {
  const labels = foldLabels({
    findingIds: ['a'],
    postStatus: { a: 'posted' },
    events: [],
    log: [{ stage: 'post', status: 'ok', id: 'a' }],
  })
  expect(labels).toEqual([{ id: 'a', label: 'posted' }])
})

test('a dismiss event with an unknown reason is rejected', () => {
  expect(() =>
    foldLabels({
      findingIds: ['a'],
      postStatus: {},
      events: [{ type: 'dismiss', findingId: 'a', reason: 'meh', timestamp: 1 }],
      log: [],
    }),
  ).toThrow(/meh/)
})

let runDir: string
beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), 'magpie-labels-'))
})
afterEach(async () => {
  await rm(runDir, { recursive: true, force: true })
})

test('readDismissed returns the folded reason per id from state/events', async () => {
  await mkdir(join(runDir, 'state'), { recursive: true })
  const lines = [
    { type: 'select', findingId: 'a', timestamp: 1 },
    { type: 'dismiss', findingId: 'a', reason: 'duplicate', timestamp: 2 },
    { type: 'dismiss', findingId: 'b', reason: 'wrong', timestamp: 3 },
    { type: 'undismiss', findingId: 'b', timestamp: 4 },
  ]
  await writeFile(
    join(runDir, 'state', 'events'),
    `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`,
  )
  const dismissed = await readDismissed(runDir)
  expect([...dismissed.entries()]).toEqual([['a', 'duplicate']])
})

test('readDismissed returns an empty map when state/events does not exist', async () => {
  const dismissed = await readDismissed(runDir)
  expect(dismissed.size).toBe(0)
})
