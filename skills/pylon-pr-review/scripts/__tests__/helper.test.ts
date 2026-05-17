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

test('helper.js sends periodic heartbeats', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain("fetch('/heartbeat'")
  expect(src).toMatch(/setInterval/)
})
