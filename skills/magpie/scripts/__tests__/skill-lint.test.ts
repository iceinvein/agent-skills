import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const SKILL = new URL('../../SKILL.md', import.meta.url).pathname
const SKILL_JSON = new URL('../../skill.json', import.meta.url).pathname
const ref = (name: string) => new URL(`../../references/${name}`, import.meta.url).pathname
const FOCUSES = ['security', 'bugs', 'performance', 'code-smells', 'architecture'] as const

test('every references/ path SKILL.md cites exists on disk', async () => {
  const text = await readFile(SKILL, 'utf8')
  const cited = [...text.matchAll(/references\/[a-z0-9-]+\.md/g)].map((m) => m[0])
  expect(cited.length).toBeGreaterThan(0)
  for (const rel of new Set(cited)) {
    const body = await readFile(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8')
    expect(body.length).toBeGreaterThan(0)
  }
})

test('references/ ships in the install bundle', async () => {
  // resolveBundlePaths silently drops include entries that match nothing, so a
  // missing entry here would install a SKILL.md whose prompts are all 404s.
  const manifest = JSON.parse(await readFile(SKILL_JSON, 'utf8')) as {
    bundle: { include: string[] }
  }
  const covers = (p: string) =>
    manifest.bundle.include.some((inc) => inc === p || p.startsWith(`${inc}/`))
  for (const name of ['specialists.md', 'critic.md', 'peer-review.md', 'scout.md']) {
    expect(covers(`references/${name}`)).toBe(true)
  }
})

test('references/specialists.md has a block for every focus', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  for (const focus of FOCUSES) {
    const tag = `magpie-specialist-${focus}`
    const fence = `\`\`\`${tag}`
    expect(text).toContain(fence)
    const start = text.indexOf(fence)
    const end = text.indexOf('```', start + tag.length + 3)
    const block = text.slice(start, end)
    expect(block).toContain('Output Contract')
    expect(block).toContain(focus)
  }
})

test('references/specialists.md carries the output contract next to the blocks', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  // The contract has to travel with the prompts: the orchestrator assembles
  // both into one subagent prompt from this single file.
  const contract = text.slice(0, text.indexOf('```magpie-specialist-'))
  expect(contract).toContain('## Output Contract')
  expect(contract).toMatch(/findings\/<focus>\.json/)
  expect(contract).toMatch(/Write findings to/i)
  // Severity, impact, likelihood, confidence, action enums must all be listed.
  expect(contract).toMatch(/"blocker".*"high".*"medium".*"low"/)
  expect(contract).toMatch(/"critical".*"high".*"medium".*"low"/)
  expect(contract).toMatch(/"likely".*"possible".*"edge-case".*"unknown"/)
  expect(contract).toMatch(/"must-fix".*"should-fix".*"consider".*"optional"/)
  expect(contract).toMatch(/"impact"[\s\S]*"likelihood"[\s\S]*"confidence"[\s\S]*"action"/)
  expect(contract).toMatch(/"body"[\s\S]*"startLine"[\s\S]*"endLine"/)
  // Anti-patterns flagged explicitly so subagents don't repeat the JSON-shape mistakes.
  expect(contract).toMatch(/NOT "lines"/)
  expect(contract).toMatch(/NOT "recommendation"/)
})

test('references/critic.md holds the rubric and both placeholders', async () => {
  const text = await readFile(ref('critic.md'), 'utf8')
  expect(text).toContain('```magpie-critic')
  expect(text).toContain('<<DEDUPED_FINDINGS_COMPACT>>')
  expect(text).toContain('<<DIFF_EXCERPT>>')
  expect(text).toContain('review-critic')
})

test('references/peer-review.md holds the prompt and the Claude preamble', async () => {
  const text = await readFile(ref('peer-review.md'), 'utf8')
  expect(text).toContain('```magpie-peer-review')
  expect(text).toContain('```magpie-peer-review-claude-preamble')
  expect(text).toContain('review-peer-review')
  for (const ph of ['<<PRIMARY_PROVIDER>>', '<<PEER_PROVIDER>>', '<<KEPT_FINDINGS_COMPACT>>']) {
    expect(text).toContain(ph)
  }
})

test('references/scout.md holds the scout prompt and the brief contract', async () => {
  const text = await readFile(ref('scout.md'), 'utf8')
  expect(text).toContain('```magpie-scout')
  expect(text).toContain('brief.json')
  for (const key of ['purpose', 'changes', 'subsystems', 'watchItems', 'unclear']) {
    expect(text).toContain(key)
  }
  for (const ph of ['<<RUN_DIR>>', '<<PR_NUMBER>>']) {
    expect(text).toContain(ph)
  }
  // The scout must never trigger a full index; that is a consent-gated GPU pass.
  expect(text).toContain('approve_indexing')
  // watchItems are context for specialists, not findings in their own right.
  expect(text).toMatch(/not a finding/i)
})

test('SKILL.md sends each stage to the reference file it needs', async () => {
  const text = await readFile(SKILL, 'utf8')
  const section = (heading: string) => {
    const start = text.indexOf(heading)
    expect(start).toBeGreaterThan(-1)
    const next = text.indexOf('\n### ', start + heading.length)
    return text.slice(start, next === -1 ? undefined : next)
  }
  expect(section('### 3. Specialists')).toContain('references/specialists.md')
  expect(section('### 5. Critic')).toContain('references/critic.md')
  expect(section('### 6. Peer review')).toContain('references/peer-review.md')
})

test('SKILL.md no longer inlines the prompt bodies it moved out', async () => {
  const text = await readFile(SKILL, 'utf8')
  for (const tag of ['magpie-specialist-', 'magpie-critic', 'magpie-peer-review']) {
    expect(text).not.toContain(`\`\`\`${tag}`)
  }
  // The walkthrough is the always-read part; keep it small enough to be cheap.
  expect(text.split(/\s+/).length).toBeLessThan(2600)
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
  const { getHighlighter } = await import('../highlight.ts')
  const highlighter = await getHighlighter()
  const findings = renderFindingsHtml({ findings: [], postStatus: {}, highlighter })
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

test('styles.css honors the HTML `hidden` attribute even on flex/grid elements', async () => {
  const STYLES = new URL('../../templates/styles.css', import.meta.url).pathname
  const css = await readFile(STYLES, 'utf8')
  // Specifically guards against the regression where .confirm-bar with
  // display: flex stayed visible despite a `hidden` attribute on the element.
  expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/)
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

test('SKILL.md checks for a resumable run before minting a new run id', async () => {
  const text = await readFile(SKILL, 'utf8')
  // §0 always computed a fresh `pr-<n>-<epoch>` id, so the resume section
  // (which keyed off that brand-new directory) could never fire.
  const setupSection = text.slice(0, text.indexOf('### 1. Setup'))
  expect(setupSection).toContain('magpie --list-runs')
  expect(setupSection).toMatch(/active/i)
})

test('SKILL.md does not gate resume on state/server-info', async () => {
  const text = await readFile(SKILL, 'utf8')
  const start = text.indexOf('## Resuming a crashed run')
  expect(start).toBeGreaterThan(-1)
  const section = text.slice(start, text.indexOf('## Aborting', start))
  // server-info is deleted when the server idles out, so a resumable run
  // fails that check. log.jsonl is the durable signal.
  expect(section).toContain('log.jsonl')
  expect(section).not.toMatch(/if .*server-info.* exists/i)
  // Resuming must restart the server; the old one is gone.
  expect(section).toContain('magpie serve')
  // `context` is a no-op stage: say so, or the agent stalls on it.
  expect(section).toContain('context')
})

test('SKILL.md names the report buttons that actually exist', async () => {
  const text = await readFile(SKILL, 'utf8')
  const actionBar = await readFile(
    new URL('../render-action-bar.ts', import.meta.url).pathname,
    'utf8',
  )
  for (const label of ['Post Selected', 'Post Recommended']) {
    expect(actionBar).toContain(label)
    expect(text).toContain(label)
  }
  // The old label was never rendered anywhere.
  expect(text).not.toContain('Post to PR')
})

test('SKILL.md has the stage walkthrough', async () => {
  const text = await readFile(SKILL, 'utf8')
  expect(text).toContain('## Stage walkthrough')
  expect(text).toMatch(/magpie setup/)
  expect(text).toMatch(/magpie serve/)
  expect(text).toMatch(/magpie dedupe/)
  expect(text).toMatch(/magpie render/)
  expect(text).toMatch(/magpie cleanup/)
})

test('references/specialists.md carries the codebase-intelligence block', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  expect(text).toContain('```magpie-codebase-intelligence')
  const start = text.indexOf('```magpie-codebase-intelligence')
  const block = text.slice(start, text.indexOf('```', start + 32))
  expect(block).toContain('bind_workspace')
  expect(block).toContain('indexing_in_progress')
  // The one operation a specialist must never perform.
  expect(block).toContain('approve_indexing')
})

test('every focus block names the code-intelligence tool for its focus', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  const tools: Record<(typeof FOCUSES)[number], string> = {
    security: 'trace_data_flow',
    bugs: 'get_call_hierarchy',
    performance: 'find_affected_code',
    'code-smells': 'search_code',
    architecture: 'explore_dependency_graph',
  }
  for (const focus of FOCUSES) {
    const fence = `\`\`\`magpie-specialist-${focus}`
    const start = text.indexOf(fence)
    const block = text.slice(start, text.indexOf('```', start + fence.length))
    expect(block).toContain(tools[focus])
  }
})

test('the output contract tells specialists to look before they hedge', async () => {
  const text = await readFile(ref('specialists.md'), 'utf8')
  const contract = text.slice(0, text.indexOf('```magpie-specialist-'))
  expect(contract).toContain('Needs verification:')
  expect(contract).toMatch(/look before .*hedg/i)
})
