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
    expect(block).toContain('orchestrator')
    expect(block).toContain(focus)
  }
})

test('SKILL.md §4 specifies the findings file path', async () => {
  const text = await readFile(SKILL, 'utf8')
  // The file-write instruction lives once, in the orchestrator template before §5.
  const orchestrator = text.slice(0, text.indexOf('```pr-review-specialist-'))
  expect(orchestrator).toMatch(/findings\/<focus>\.json/)
  expect(orchestrator).toMatch(/Write findings to/i)
})

test('SKILL.md has the critic and peer-review blocks', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('```pr-review-critic')
  expect(text).toContain('```pr-review-peer-review')
})

test('SKILL.md §4 inlines the full specialist schema with enum vocabularies', async () => {
  const text = await readFile(SKILL, 'utf8')
  // The schema block sits inside the specialist orchestrator template (§4),
  // before the specialist blocks begin (the first `pr-review-specialist-` tag).
  const schemaCutoff = text.indexOf('```pr-review-specialist-')
  expect(schemaCutoff).toBeGreaterThan(-1)
  const orchestrator = text.slice(0, schemaCutoff)
  // Severity, impact, likelihood, confidence, action enums must all be listed.
  expect(orchestrator).toMatch(/"blocker".*"high".*"medium".*"low"/)
  expect(orchestrator).toMatch(/"critical".*"high".*"medium".*"low"/)
  expect(orchestrator).toMatch(/"likely".*"possible".*"edge-case".*"unknown"/)
  expect(orchestrator).toMatch(/"must-fix".*"should-fix".*"consider".*"optional"/)
  // The risk field must be documented as an object with the four required keys.
  expect(orchestrator).toMatch(/"impact"[\s\S]*"likelihood"[\s\S]*"confidence"[\s\S]*"action"/)
  // suggestion shape: body/startLine/endLine.
  expect(orchestrator).toMatch(/"body"[\s\S]*"startLine"[\s\S]*"endLine"/)
  // Anti-patterns flagged explicitly so subagents don't repeat the JSON-shape mistakes.
  expect(orchestrator).toMatch(/NOT "lines"/)
  expect(orchestrator).toMatch(/NOT "recommendation"/)
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
