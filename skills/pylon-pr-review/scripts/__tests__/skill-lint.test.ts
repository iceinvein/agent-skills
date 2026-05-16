import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const SKILL = new URL('../../SKILL.md', import.meta.url).pathname
const FOCUSES = ['security', 'bugs', 'performance', 'code-smells', 'architecture'] as const

test('SKILL.md has a specialist block for every focus', async () => {
  const text = await readFile(SKILL, 'utf8')
  for (const focus of FOCUSES) {
    const tag = `pr-review-specialist-${focus}`
    const fence = `\`\`\`${tag}`
    expect(text).toContain(fence)
    const start = text.indexOf(fence)
    const end = text.indexOf('```', start + tag.length + 3)
    const block = text.slice(start, end)
    expect(block).toContain('write findings to')
    expect(block).toContain(focus)
  }
})

test('SKILL.md has the critic and peer-review blocks', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('```pr-review-critic')
  expect(text).toContain('```pr-review-peer-review')
})

test('SKILL.md has the stage walkthrough', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('## Stage walkthrough')
  expect(text).toMatch(/pr-review setup/)
  expect(text).toMatch(/pr-review serve/)
  expect(text).toMatch(/pr-review dedupe/)
  expect(text).toMatch(/pr-review render/)
  expect(text).toMatch(/pr-review cleanup/)
})
