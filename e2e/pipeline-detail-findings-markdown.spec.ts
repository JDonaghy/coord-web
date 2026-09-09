/**
 * E2E coverage for #114: review findings on the pipeline detail view render
 * as markdown, not a wall of literal `##`/`-`/backtick characters inside a
 * `<pre>`.
 *
 * Mirrors `pipeline-detail-board-link.spec.ts`'s `page.route()` mocking
 * pattern — a real backend is unnecessary; the point here is that the
 * browser actually renders `review_findings_body` through the shared
 * `Markdown` component (lazy-loaded from `Detail.tsx`) rather than dumping
 * it raw.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

const FINDINGS_MARKDOWN =
  '## Blocking\n\n- Missing test for the retry path\n- Calls `unwrap()` on a fallible result\n'

const SEEDED_PIPELINE = [
  {
    assignment_id: 'work-1',
    issue_number: 42,
    issue_title: 'Fix the dashboard rendering',
    repo_name: 'api',
    machine_name: 'dellserver',
    current_stage: 'review_done',
    stages: [
      { name: 'coding', status: 'done', is_current: false },
      { name: 'review', status: 'done', is_current: true },
      { name: 'merge', status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 60,
    review_findings_pending: false,
    review_verdict: 'request-changes',
    review_findings_body: FINDINGS_MARKDOWN,
    test_verdict: 'passed',
  },
]

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json(SEEDED_PIPELINE)))
  await page.route('**/api/sessions', (route) => route.fulfill(json([])))
  await page.route('**/api/board', (route) =>
    route.fulfill(json({ round_number: 1, active: [], completed: [] })),
  )
  await page.route('**/api/diff/**', (route) =>
    route.fulfill(json({ diff: '', source: 'compare' })),
  )
}

test.describe('Pipeline detail findings render as markdown (#114)', () => {
  test('a heading, a list item, and inline code render as elements, not literal syntax', async ({
    page,
  }) => {
    await mockApi(page)
    await page.goto('/pipeline/api/42')

    await expect(page.getByText('Fix the dashboard rendering').first()).toBeVisible()

    // The `## Blocking` line became a real heading element.
    await expect(page.getByRole('heading', { name: 'Blocking' })).toBeVisible()

    // The bullet became a real list item, not a "-"-prefixed text line.
    await expect(page.getByRole('listitem').filter({ hasText: 'Missing test for the retry path' })).toBeVisible()

    // Backtick-wrapped `unwrap()` became a real <code> element.
    const inlineCode = page.locator('code', { hasText: 'unwrap()' })
    await expect(inlineCode).toBeVisible()

    // None of the raw markdown syntax survives as literal visible text.
    await expect(page.getByText('## Blocking')).toHaveCount(0)
    await expect(page.getByText('`unwrap()`')).toHaveCount(0)
  })
})
