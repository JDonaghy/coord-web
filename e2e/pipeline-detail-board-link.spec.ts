/**
 * E2E coverage for #113: the pipeline detail header's issue ref links to its
 * Board page.
 *
 * Before this issue, `coord-web#82 · dellserver` was dead text at
 * `Detail.tsx:437` — no way to get from "how did this run" to "what was it
 * asked to do" without leaving the view, going back to the Board list, and
 * hunting for the row. `paths.boardItem`'s own doc comment already named
 * this as its intended link target (#100); this closes the gap.
 *
 * Mirrors `deep-link.spec.ts` / `stage-chip-verdict.spec.ts`'s `page.route()`
 * mocking pattern (a real backend is unnecessary here — `board-detail-issue.
 * spec.ts` already proves `BoardDetail` itself against `GET /api/issue`).
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
    machine_name: 'dellserver',
    current_stage: 'coding',
    stages: [
      { name: 'coding', status: 'active', is_current: true },
      { name: 'review', status: 'waiting', is_current: false },
      { name: 'merge', status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 20,
    review_findings_pending: false,
    review_verdict: null,
    review_findings_body: null,
    test_verdict: null,
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
  await page.route('**/api/issue/api/42', (route) =>
    route.fulfill(
      json({
        repo_name: 'api',
        number: 42,
        title: 'Fix the dashboard rendering',
        body: '## What\n\nThe dashboard renders stale data on first paint.\n',
        state: 'open',
        labels: [],
        milestone_number: null,
        milestone_title: null,
        html_url: 'https://github.com/JDonaghy/api/issues/42',
      }),
    ),
  )
}

test.describe('Pipeline detail → Board link (#113)', () => {
  test('the header issue ref links to the Board page and lands on the issue body', async ({
    page,
  }) => {
    await mockApi(page)
    await page.goto('/pipeline/api/42')

    await expect(page.getByText('Fix the dashboard rendering').first()).toBeVisible()

    // `exact: true` -- Playwright's accessible-name matching is a
    // case-insensitive *substring* by default, so a bare 'A#42' would also
    // resolve the new-tab affordance's own "Open A#42 in a new tab" label and
    // trip strict mode. Same guard as `queue-exit-gate.spec.ts`.
    const issueLink = page.getByRole('link', { name: 'A#42', exact: true })
    await expect(issueLink).toHaveAttribute('href', '/board/api/42')
    // No explicit target -- in-app SPA nav; ctrl/cmd-click still opens a new
    // tab for free via plain <Link> semantics.
    await expect(issueLink).not.toHaveAttribute('target')

    const newTabLink = page.getByRole('link', { name: 'Open A#42 in a new tab' })
    await expect(newTabLink).toHaveAttribute('href', '/board/api/42')
    await expect(newTabLink).toHaveAttribute('target', '_blank')

    await issueLink.click()

    await expect(page).toHaveURL(/\/board\/api\/42$/)
    await expect(page.getByRole('heading', { name: 'What' })).toBeVisible()
    await expect(page.getByText('stale data on first paint')).toBeVisible()
  })

  test('the not-found branch links to the Board page when the issue has no pipeline row', async ({
    page,
  }) => {
    await page.route('**/api/pipeline', (route) => route.fulfill(json([])))
    await page.route('**/api/sessions', (route) => route.fulfill(json([])))
    await page.route('**/api/board', (route) =>
      route.fulfill(json({ round_number: 1, active: [], completed: [] })),
    )
    await page.route('**/api/issue/api/42', (route) =>
      route.fulfill(
        json({
          repo_name: 'api',
          number: 42,
          title: 'Fix the dashboard rendering',
          body: '## What\n\nThe dashboard renders stale data on first paint.\n',
          state: 'open',
          labels: [],
          milestone_number: null,
          milestone_title: null,
          html_url: 'https://github.com/JDonaghy/api/issues/42',
        }),
      ),
    )
    await page.goto('/pipeline/api/42')

    await expect(page.getByText(/not found in the pipeline/i)).toBeVisible()

    // `exact: true` for the same reason as above: the new-tab affordance's
    // "Open A#42 in a new tab" label substring-matches a bare 'A#42'.
    const issueLink = page.getByRole('link', { name: 'A#42', exact: true })
    await expect(issueLink).toHaveAttribute('href', '/board/api/42')

    const newTabLink = page.getByRole('link', { name: 'Open A#42 in a new tab' })
    await expect(newTabLink).toHaveAttribute('href', '/board/api/42')
    await expect(newTabLink).toHaveAttribute('target', '_blank')

    await issueLink.click()

    await expect(page).toHaveURL(/\/board\/api\/42$/)
    await expect(page.getByRole('heading', { name: 'What' })).toBeVisible()
  })
})
