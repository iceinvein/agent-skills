import { expect, test } from 'bun:test'
import { renderProgressHtml } from '../render-progress.ts'

test('renderProgressHtml shows all stages with status classes', () => {
  const html = renderProgressHtml({
    prNumber: 1234,
    headSha: 'deadbeef',
    branch: 'feature-x',
    stages: {
      setup: 'done',
      context: 'done',
      specialists: 'running',
      dedupe: 'pending',
      critic: 'pending',
      'peer-review': 'pending',
      report: 'pending',
      post: 'pending',
    },
    specialistCounts: { security: 2, bugs: 0, performance: 0, 'code-smells': 0, architecture: 0 },
  })
  expect(html).toContain('#1234')
  expect(html).toContain('feature-x')
  expect(html).toContain('class="stage done">setup')
  expect(html).toContain('class="stage running">specialists')
  expect(html).toContain('security: 2')
})
