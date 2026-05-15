import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const HELPER = new URL('../helper.js', import.meta.url).pathname

test('helper.js posts to /events on change and click events', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain('addEventListener')
  expect(src).toContain("addEventListener('change'")
  expect(src).toContain("addEventListener('click'")
  expect(src).toContain("fetch('/events'")
  expect(src).toContain("'select'")
  expect(src).toContain("'deselect'")
  expect(src).toContain("type: 'submit'")
})

test('helper.js sends periodic heartbeats', async () => {
  const src = await readFile(HELPER, 'utf8')
  expect(src).toContain("fetch('/heartbeat'")
  expect(src).toMatch(/setInterval/)
})
