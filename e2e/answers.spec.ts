/**
 * E2E coverage for #59 — the Answers screen: recording a client answer given
 * out of band against a `needs-input` submission's open question, over the
 * landed `POST /api/portal/answer` (claude-coordinator#2986/#2990).
 *
 * Mocks `/api/portal/needs-input` and `/api/portal/answer` via `page.route()`
 * against the Vite dev server, mirroring `stage-chip-verdict.spec.ts`'s
 * posture rather than booting a live `coord web --fixture` process
 * (`fixtureServer.ts`'s header) — the fixture server's own portal support is
 * server-side, out of this repo's scope, and every other spec here but
 * `live-update-fixture.spec.ts` already takes this mocked-route approach.
 *
 * Narrow viewport throughout (390×844): issue #59 is explicit that a phone,
 * one-handed, is the primary target, not a responsive afterthought — so this
 * drives the screen exactly the way that target would reach it (the bottom
 * nav tab, not a desktop rail click) and asserts on touch-sized controls.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

const OPEN_QUESTION =
  'Could you confirm the full legal name on the account, the billing address on file, ' +
  'and whether the replacement unit should ship to that same address or somewhere else?'

const NEEDS_INPUT_ITEM = {
  submission_id: 'sub-2001',
  question: OPEN_QUESTION,
  revision: 4,
  repo_name: 'coord-portal',
  issue_number: 159,
  title: null,
  opened_at: null,
}

async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
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
}

test.describe('Answers screen (#59)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('reachable one-handed from the bottom nav, shows the open question in full, blocks submit without provenance', async ({
    page,
  }) => {
    await mockShellApi(page)
    await page.route('**/api/portal/needs-input', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([NEEDS_INPUT_ITEM]),
      }),
    )

    await page.goto('/')
    // Phone bottom nav — a single tap, no desktop-only rail affordance.
    await page.getByRole('button', { name: /^Answers/ }).click()
    await expect(page).toHaveURL(/\/answers$/)

    const question = page.getByTestId('answer-question-sub-2001')
    await expect(question).toHaveText(OPEN_QUESTION)

    const submit = page.getByTestId('answer-submit-button-sub-2001')
    await expect(submit).toBeDisabled()

    // Text alone isn't enough -- source is mandatory provenance (#59).
    await page.getByTestId('answer-text-input-sub-2001').fill('They confirmed 123 Main St, unit 4B.')
    await expect(submit).toBeDisabled()

    await page.getByTestId('answer-source-select-sub-2001').selectOption('phone')
    await expect(submit).toBeEnabled()

    // The date is captured too, just not as a second submittable field (see
    // src/lib/portal.ts) -- it's visible read-only context before submit.
    await expect(page.getByTestId('answer-date-sub-2001')).toBeVisible()
  })

  test('records the answer paired to the listed revision and the submission leaves needs-input with no manual refresh', async ({
    page,
  }) => {
    await mockShellApi(page)

    // The post-submit refetch is held until the test says so. `AnswersPanel`
    // marks the card recorded and invalidates `['portal-needs-input']` in the
    // same tick (see its doc comment), so against an instantly-fulfilled mock
    // the "Answer recorded" note can be replaced by the refetched empty list
    // before any assertion sees it -- a race in the *mock*, not in the app,
    // and one that made this test fail ~2 runs in 3 locally. Gating the
    // second response makes the intermediate state deterministic without
    // weakening either assertion.
    let releaseRefetch: () => void = () => {}
    const refetchGate = new Promise<void>((resolve) => {
      releaseRefetch = resolve
    })
    let needsInputCalls = 0
    await page.route('**/api/portal/needs-input', async (route) => {
      needsInputCalls += 1
      if (needsInputCalls === 1) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([NEEDS_INPUT_ITEM]),
        })
      }
      await refetchGate
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.route('**/api/portal/answer', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entry: { submission_id: 'sub-2001', text: 'They confirmed 123 Main St.', source: 'phone', revision: 4 },
        }),
      }),
    )

    await page.goto('/answers')
    await expect(page.getByTestId('answer-card-sub-2001')).toBeVisible()

    await page.getByTestId('answer-text-input-sub-2001').fill('They confirmed 123 Main St.')
    await page.getByTestId('answer-source-select-sub-2001').selectOption('phone')

    const [postRequest] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/portal/answer') && req.method() === 'POST'),
      page.getByTestId('answer-submit-button-sub-2001').click(),
    ])
    expect(postRequest.postDataJSON()).toEqual({
      submission_id: 'sub-2001',
      text: 'They confirmed 123 Main St.',
      source: 'phone',
      revision: 4,
    })

    await expect(page.getByTestId('answer-recorded-sub-2001')).toBeVisible()
    // No manual second step: the card is gone once the post-submit refetch
    // lands (nothing below clicks a refresh control), and the screen falls
    // back to its empty state.
    releaseRefetch()
    await expect(page.getByTestId('answer-card-sub-2001')).not.toBeVisible()
    await expect(page.getByTestId('answers-empty-state')).toBeVisible()
  })

  test('a 409 (question moved on) shows a re-read prompt on that card, not a generic error', async ({ page }) => {
    await mockShellApi(page)
    await page.route('**/api/portal/needs-input', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([NEEDS_INPUT_ITEM]) }),
    )
    await page.route('**/api/portal/answer', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'revision is not the submission’s current open question' }),
      }),
    )

    await page.goto('/answers')
    await page.getByTestId('answer-text-input-sub-2001').fill('They confirmed 123 Main St.')
    await page.getByTestId('answer-source-select-sub-2001').selectOption('phone')
    await page.getByTestId('answer-submit-button-sub-2001').click()

    const banner = page.getByTestId('answer-stale-banner-sub-2001')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/re-read/i)
    // The card is still there for the operator to re-read and re-answer --
    // a 409 is not treated as "submission gone".
    await expect(page.getByTestId('answer-card-sub-2001')).toBeVisible()
  })
})
