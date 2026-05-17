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

test('styles.css declares a prefers-color-scheme:dark block that overrides core tokens', async () => {
  const STYLES = new URL('../../templates/styles.css', import.meta.url).pathname
  const css = await readFile(STYLES, 'utf8')
  expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/)
  const darkBlockStart = css.search(/@media\s*\(prefers-color-scheme:\s*dark\)/)
  expect(darkBlockStart).toBeGreaterThan(-1)
  const darkBlock = css.slice(darkBlockStart)
  for (const token of ['--surface:', '--card:', '--ink:', '--line:', '--accent:']) {
    expect(darkBlock).toContain(token)
  }
  // Severity chips must be re-tuned for dark contrast, not left at the light values.
  expect(darkBlock).toContain('--sev-blocker-bg:')
  expect(darkBlock).toContain('--sev-medium-bg:')
  // Card shadow drops to none in dark.
  expect(darkBlock).toMatch(/--shadow-card:\s*none/)
})

test('rendered HTML opts into light/dark with a color-scheme meta tag', async () => {
  const { renderFindingsHtml } = await import('../render-findings.ts')
  const { renderProgressHtml } = await import('../render-progress.ts')
  const findings = renderFindingsHtml({ findings: [], postStatus: {} })
  const progress = renderProgressHtml({
    prNumber: 1,
    headSha: 'deadbeef0011',
    branch: 'main',
    stages: {
      setup: 'done',
      context: 'pending',
      specialists: 'pending',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: {},
  })
  for (const html of [findings, progress]) {
    expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"/)
  }
})

test('severity chips and submit button no longer hardcode `color: white` (must flip with theme)', async () => {
  const STYLES = new URL('../../templates/styles.css', import.meta.url).pathname
  const css = await readFile(STYLES, 'utf8')
  // White text on saturated chips is fine in light, broken in dark; we now drive
  // chip ink from --sev-*-ink so it adapts. Don't allow `color: white` to creep back.
  for (const selector of [
    '.sev-blocker',
    '.sev-high',
    '.step.error',
    '.submit-btn',
    '.badge.failed',
  ]) {
    const start = css.indexOf(selector + ' {')
    if (start === -1) continue
    const end = css.indexOf('}', start)
    const block = css.slice(start, end)
    expect(block).not.toMatch(/color:\s*white\b/)
  }
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
