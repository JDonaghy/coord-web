/**
 * E2E coverage for #28: stage-chip verdict awareness + the active ring.
 *
 * Reported against claude-coordinator#1823: a rejected review (or a failed
 * test) never turned its stage chip red, because the chip-coloring logic
 * only knew about `FAILED_STAGES` (a crashed *assignment*), never a
 * stage-specific *verdict*. `review_done` is the same `current_stage` value
 * a genuinely-approved review produces, so a rejected review's chip fell
 * into the plain "completed → green" branch. This file drives the real
 * rendered app (both the Home card and the Detail screen) against a seeded
 * `/api/pipeline` response carrying that exact combination, mirroring
 * `deep-link.spec.ts` / `smoke.spec.ts`'s `page.route()` mocking pattern
 * rather than booting a live backend.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

/**
 * One pipeline row reproducing #1823's exact reported shape: `current_stage`
 * has moved on to `merge_ready` (the merge-queue behavior tracked separately
 * by claude-coordinator#2498) while `review_verdict` is still
 * `request-changes` — i.e. the acceptance bar this issue sets explicitly:
 * this must render red *even before* #2498 lands.
 */
const REJECTED_REVIEW_ITEM = {
  assignment_id: 'work-rejected-review',
  issue_number: 1823,
  issue_title: 'Verdict-blind stage badge repro',
  repo_name: 'claude-coordinator',
  machine_name: 'dellserver',
  current_stage: 'merge_ready',
  stages: [
    { name: 'coding', status: 'completed', is_current: false },
    { name: 'smoke',  status: 'completed', is_current: false },
    { name: 'review', status: 'completed', is_current: false },
    { name: 'merge',  status: 'active',    is_current: true },
  ],
  available_gates: [{ action: 'merge', label: 'Merge', endpoint: '/api/pipeline/action' }],
  progress_pct: 90,
  review_findings_pending: false,
  review_verdict: 'request-changes',
  review_findings_body: null,
  test_verdict: null,
}

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([REJECTED_REVIEW_ITEM]),
    }),
  )
  await page.route('**/api/board', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ round_number: 1, active: [], completed: [] }),
    }),
  )
  await page.route('**/api/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  await page.route('**/api/diff/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ diff: '', source: 'compare' }),
    }),
  )
}

test.describe('stage-chip verdict awareness (#28)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Home card renders the review chip red for a rejected verdict, despite current_stage having moved to merge_ready', async ({
    page,
  }) => {
    await mockApi(page)
    await page.goto('/')

    // `merge_ready` is one of the "done-ish, waiting-on-a-gate" stages
    // Home's `groupActiveItems` demotes into the collapsed "Work done"
    // section (see `src/lib/pipeline.ts`'s `STALE_FAILURE_WINDOW_MS` doc
    // comment) — expand it before looking for the card.
    await page.getByRole('button', { name: /work done/i }).click()

    const card = page.getByRole('button').filter({ hasText: 'Verdict-blind stage badge repro' })
    const reviewChip = card.getByText('review', { exact: true })
    await expect(reviewChip).toBeVisible()
    await expect(reviewChip).toHaveClass(/bg-destructive/)
  })

  test('Detail screen renders both the header chip and the merge-section gate row red for the same rejected verdict', async ({
    page,
  }) => {
    await mockApi(page)
    await page.goto('/pipeline/claude-coordinator/1823')

    // Header stage-chip strip.
    const headerReviewChip = page.locator('span').filter({ hasText: /^review$/ }).first()
    await expect(headerReviewChip).toBeVisible()
    await expect(headerReviewChip).toHaveClass(/bg-destructive/)

    // Merge-section gate-status list — before #28 this list had no fail-red
    // case at all, so it rendered the review row identically to an approved
    // one even while the header strip (once FAILED_STAGES-aware) might not.
    const mergeSection = page.getByRole('region', { name: /merge/i });
    await expect(mergeSection).toBeVisible()
    const gateReviewRow = mergeSection.getByText('review', { exact: true }).locator('..')
    const gateReviewDot = gateReviewRow.locator('span').first()
    await expect(gateReviewDot).toHaveClass(/bg-destructive/)

    // The merge stage is the one actually in flight (`is_current: true`) —
    // it should carry the active ring, independent of its (pending) fill.
    const gateMergeRow = mergeSection.getByText('merge', { exact: true }).locator('..')
    const gateMergeDot = gateMergeRow.locator('span').first()
    await expect(gateMergeDot).toHaveClass(/ring-2/)
    // The rejected review row is NOT current, so it must not carry the ring
    // too — ring and fill are independent, not both derived from "is this
    // the failing stage".
    await expect(gateReviewDot).not.toHaveClass(/ring-2/)
  })
})
