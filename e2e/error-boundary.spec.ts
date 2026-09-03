/**
 * E2E coverage for #87 — the shell survives a panel-level render crash
 * instead of the whole SPA blanking, which is what actually happened for
 * #76 (MachinesList) and #84 (AnswersPanel).
 *
 * The mock is at the transport (`page.route()`), returning a shape the
 * *real* `PipelineCard` component cannot render — never a stubbed
 * component. Mocking at the component level is exactly the mistake that let
 * #76 and #84 ship green: a fake that already agrees with the component's
 * assumptions can't catch the component disagreeing with the real API.
 *
 * `PipelineCard.tsx` does `view.stages.map(...)` with no guard (`stages` is
 * required-non-null in the generated wire type, but that's a compile-time
 * contract only — `apiFetch` does a bare `res.json()` cast, so nothing
 * validates it at runtime). Dropping `stages` from one row is enough to
 * throw during render the first time `Home` maps that row into a card — no
 * user interaction required, since `/` lands on `/pipeline` and an active
 * (`current_stage: "coding"`) row renders immediately, not behind a
 * collapsed section.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

/** Valid in every field the shell's own rail-badge/status-bar reads touch
 * (`current_stage`, `finished_at`, `available_gates`) — only `stages`, which
 * nothing outside `PipelineCard` reads, is missing. That's what keeps the
 * crash contained to the list panel instead of also taking out `ShellLayout`
 * itself (and with it, the top-level boundary instead of the list one). */
const BROKEN_PIPELINE_ROW = {
  assignment_id: 'crash-repro-1',
  issue_number: 9001,
  issue_title: 'Row missing its stages array',
  repo_name: 'test-repo',
  machine_name: 'test-machine',
  current_stage: 'coding',
  // `stages` deliberately omitted -- the malformed shape under test.
  available_gates: [],
  progress_pct: 50,
  review_findings_pending: false,
  review_verdict: null,
  review_findings_body: null,
  test_verdict: null,
}

async function mockApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([BROKEN_PIPELINE_ROW]),
    }),
  )
  await page.route('**/api/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}

const rail = (page: Page) => page.locator('[data-region="rail"]')
const list = (page: Page) => page.locator('[data-region="list"]')
const status = (page: Page) => page.getByLabel('Status')

test.describe('ErrorBoundary contains a panel crash (#87)', () => {
  test('a malformed /api/pipeline row crashes only the list panel -- rail and status bar survive', async ({
    page,
  }) => {
    await mockApi(page)
    await page.goto('/')

    // The list panel shows the boundary's fallback, not the crashed card.
    const alert = list(page).getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('The list panel hit an error')

    // Rail and status bar are siblings of the crashed boundary in the shell
    // grid, not descendants -- #76's actual regression was that they went
    // down with the panel too. Both must still be visible AND operable.
    await expect(rail(page)).toBeVisible()
    await expect(rail(page).getByRole('button', { name: /Sessions/ })).toBeEnabled()
    await expect(status(page)).toBeVisible()
  })

  test('navigating away from the crashed route recovers real content -- the fallback does not latch', async ({
    page,
  }) => {
    await mockApi(page)
    await page.goto('/')

    await expect(list(page).getByRole('alert')).toBeVisible()

    // Sessions has nothing wrong with its data (mocked to `[]` above) -- a
    // real route's real content, not another crash.
    await rail(page).getByRole('button', { name: /Sessions/ }).click()

    await expect(list(page).getByRole('heading', { name: 'Sessions' })).toBeVisible()
    await expect(list(page).getByRole('alert')).toHaveCount(0)
    // The rail survived the whole round trip, unaffected throughout.
    await expect(rail(page)).toBeVisible()
  })

  test('Retry re-attempts the same panel from its own fallback', async ({ page }) => {
    await mockApi(page)
    await page.goto('/')

    const alert = list(page).getByRole('alert')
    await expect(alert).toBeVisible()

    // The underlying data is still broken, so Retry throws again -- the
    // point of this assertion is that the boundary's own control still
    // works (doesn't crash *itself*, doesn't take the rail with it a second
    // time), not that the panel magically heals.
    await alert.getByRole('button', { name: 'Retry' }).click()

    await expect(list(page).getByRole('alert')).toBeVisible()
    await expect(rail(page)).toBeVisible()
  })
})
