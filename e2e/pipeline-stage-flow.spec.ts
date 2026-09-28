/**
 * E2E coverage for #100: the per-issue stage-flow view on the pipeline
 * detail page — connected `Work → Test → Review → Uat → Merge` boxes each
 * with their own leg count, plus the leg list below naming the machine each
 * leg ran on.
 *
 * `PipelineStageFlow.test.tsx` already covers this in isolation with a fake
 * `fetchPipelineLegs`, and `Detail.test.tsx` covers the combined render path
 * with the same fake. Neither drives a real browser against the real
 * `GET /api/pipeline/{repo}/{issue}/legs` route through the actual app
 * shell/router the way a user reaches it — a queue or pipeline row click
 * into `/pipeline/:repo/:issue`. This closes that gap, mirroring
 * `pipeline-detail-board-link.spec.ts` / `pipeline-detail-findings-markdown.
 * spec.ts`'s `page.route()` mocking pattern for this same page.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

const SEEDED_PIPELINE = [
  {
    assignment_id: 'work-1',
    issue_number: 42,
    issue_title: 'Fix the dashboard rendering',
    repo_name: 'api',
    machine_name: 'precision',
    current_stage: 'review_done',
    stages: [
      { name: 'coding', status: 'completed', is_current: false },
      { name: 'smoke', status: 'completed', is_current: false },
      { name: 'review', status: 'completed', is_current: true },
      { name: 'uat', status: 'skipped', is_current: false },
      { name: 'merge', status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 50,
    review_findings_pending: false,
    review_verdict: 'approve',
    review_findings_body: null,
    test_verdict: 'passed',
  },
]

const SEEDED_LEGS = {
  repo_name: 'api',
  issue_number: 42,
  legs: [
    {
      assignment_id: 'rev-1',
      stage: 'review',
      status: 'done',
      machine_name: 'precision',
      dispatched_at: 1749971100,
      finished_at: 1749971600,
    },
    {
      assignment_id: 'work-1',
      stage: 'work',
      status: 'done',
      machine_name: 'dellserver',
      dispatched_at: 1749970000,
      finished_at: 1749971000,
    },
  ],
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json(SEEDED_PIPELINE)))
  await page.route('**/api/pipeline/api/42/legs', (route) => route.fulfill(json(SEEDED_LEGS)))
  await page.route('**/api/sessions', (route) => route.fulfill(json([])))
  await page.route('**/api/board', (route) =>
    route.fulfill(json({ round_number: 1, active: [], completed: [] })),
  )
  await page.route('**/api/diff/**', (route) =>
    route.fulfill(json({ diff: '', source: 'compare' })),
  )
}

test.describe('Pipeline detail → stage flow (#100)', () => {
  test('renders the connected stage boxes with leg counts, and the leg list naming each machine', async ({
    page,
  }) => {
    await mockApi(page)
    await page.goto('/pipeline/api/42')

    await expect(page.getByText('Fix the dashboard rendering').first()).toBeVisible()

    const boxes = page.getByRole('list', { name: 'Stage boxes' })
    await expect(boxes).toBeVisible()
    await expect(boxes.getByTestId('stage-box-coding')).toContainText('Work')
    await expect(boxes.getByTestId('stage-box-coding')).toContainText('1')
    await expect(boxes.getByTestId('stage-box-review')).toContainText('Review')
    await expect(boxes.getByTestId('stage-box-review')).toContainText('1')

    // The whole point of #100: the leg list names the machine each leg
    // actually ran on, newest-dispatch-first -- review (precision) before
    // work (dellserver), even though the issue's own header shows only its
    // current/last machine ('precision').
    const rows = page.getByTestId('leg-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Review')
    await expect(rows.nth(0)).toContainText('precision')
    await expect(rows.nth(1)).toContainText('Work')
    await expect(rows.nth(1)).toContainText('dellserver')
  })

  test('degrades to an explanatory note, without breaking the rest of the page, on an older coord server', async ({
    page,
  }) => {
    await page.route('**/api/pipeline', (route) => route.fulfill(json(SEEDED_PIPELINE)))
    // Older server: the legs route doesn't exist at all.
    await page.route('**/api/pipeline/api/42/legs', (route) =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }),
    )
    await page.route('**/api/sessions', (route) => route.fulfill(json([])))
    await page.route('**/api/board', (route) =>
      route.fulfill(json({ round_number: 1, active: [], completed: [] })),
    )
    await page.route('**/api/diff/**', (route) =>
      route.fulfill(json({ diff: '', source: 'compare' })),
    )

    await page.goto('/pipeline/api/42')

    await expect(page.getByText('Fix the dashboard rendering').first()).toBeVisible()
    await expect(page.getByRole('list', { name: 'Stage boxes' })).toBeVisible()
    await expect(page.getByText(/isn't available from this coord server yet/)).toBeVisible()
  })
})
