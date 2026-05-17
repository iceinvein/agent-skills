import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const HELPER = new URL('../helper.js', import.meta.url).pathname

test('helper.js wires change + click + select/deselect events for the /events queue', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain('addEventListener')
  expect(src).toContain("addEventListener('change'")
  expect(src).toContain("addEventListener('click'")
  expect(src).toContain("fetch('/events'")
  expect(src).toContain("'select'")
  expect(src).toContain("'deselect'")
})

test('helper.js wires the /post endpoint with a confirm flow', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain("fetch('/post'")
  expect(src).toContain('openConfirm')
  expect(src).toContain('performPost')
  // Confirm bar action keys
  expect(src).toContain('cancel-post')
  expect(src).toContain('confirm-post')
})

test('confirm-post captures pending ids before closeConfirm clears them', async () => {
  const src = await readFile(HELPER, 'utf8')
  // The slice() must happen before closeConfirm() and the slice must be
  // what gets passed to performPost(). Regression for a bug where these
  // two calls ran in the wrong order and performPost saw an empty queue.
  const confirmIdx = src.indexOf("'confirm-post'")
  expect(confirmIdx).toBeGreaterThan(-1)
  // Inspect the lines following the case label.
  const block = src.slice(confirmIdx, confirmIdx + 400)
  const sliceIdx = block.indexOf('pendingPostIds.slice()')
  const closeIdx = block.indexOf('closeConfirm()')
  const performIdx = block.indexOf('performPost(')
  expect(sliceIdx).toBeGreaterThan(-1)
  expect(closeIdx).toBeGreaterThan(-1)
  expect(performIdx).toBeGreaterThan(-1)
  expect(sliceIdx).toBeLessThan(closeIdx)
  expect(closeIdx).toBeLessThan(performIdx)
  // performPost must be called with an argument (ids), not bare.
  expect(block).toMatch(/performPost\(\s*ids\s*\)/)
})

test('recountSelected ignores disabled checkboxes (posted findings)', async () => {
  const src = await readFile(HELPER, 'utf8')
  // Posted findings get checked+disabled; they must not count as an active
  // selection, otherwise "clear" cannot clear them and the counter stays
  // pinned at the post-status total.
  expect(src).toMatch(/allCheckboxes\(\)\.filter\(\(el\)\s*=>\s*el\.checked\s*&&\s*!el\.disabled\)/)
})

test('helper.js sends periodic heartbeats', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain("fetch('/heartbeat'")
  expect(src).toMatch(/setInterval/)
})
