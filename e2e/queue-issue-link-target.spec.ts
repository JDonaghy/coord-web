/**
 * E2E coverage for coord-web#108: the Queue panel's Issue link picks its
 * target from whether a real `/api/pipeline` row exists for that
 * `repo#issue`, not from the queue's own `state`.
 *
 * `DriveQueuePanel.test.tsx` and `driveQueue.test.ts` already prove the
 * target rule itself (`queueIssueLinkTarget`) and its wiring into the
 * rendered `href`s against a mocked `@/api/client`. What neither proves is
 * that a REAL `coord web --fixture` process's `/api/drive-queue` and
 * `/api/pipeline` handlers actually produce the shape that rule depends on --
 * same "real dist bundle, real server" posture `queue-exit-gate.spec.ts`
 * established for the rest of this panel.
 *
 * `e2e/fixtures/queue-issue-link-target.json`'s header explains the two
 * seeded rows: format-converter#2 (`blocked`, no board assignment -- no
 * pipeline row) and format-converter#3 (`running`, WITH a dispatched
 * assignment -- a real pipeline row).
 *
 * Run: npm run test:e2e (requires `coord` on $PATH, see fixtureServer.ts)
 */
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixtureServer, type FixtureServerHandle } from './fixtureServer'

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'queue-issue-link-target.json',
)

test.describe('Queue panel Issue link target (#108)', () => {
  let server: FixtureServerHandle

  test.beforeAll(async () => {
    server = await startFixtureServer(FIXTURE_PATH)
  })

  test.afterAll(async () => {
    await server?.stop()
  })

  test('a blocked/queued row with no pipeline row goes to the Board; a running row with one still goes to the pipeline view', async ({
    page,
  }) => {
    await page.goto(`${server.baseUrl}/queue`)

    // Both rows are visible under the "All repos" default scope.
    const blockedLink = page.getByRole('link', { name: 'FC#2', exact: true })
    const runningLink = page.getByRole('link', { name: 'FC#3', exact: true })
    await expect(blockedLink).toBeVisible()
    await expect(runningLink).toBeVisible()

    // #2 ('blocked', never dispatched -- no /api/pipeline row) -- the
    // guaranteed dead end this issue fixes: the link now points at the
    // Board entry, and its new-tab affordance agrees.
    await expect(blockedLink).toHaveAttribute('href', '/board/format-converter/2')
    await expect(page.getByRole('link', { name: 'Open FC#2 in a new tab' })).toHaveAttribute(
      'href',
      '/board/format-converter/2',
    )

    // #3 ('running', WITH a dispatched assignment -- a real pipeline row) --
    // unchanged from today: still the pipeline route.
    await expect(runningLink).toHaveAttribute('href', '/pipeline/format-converter/3')
    await expect(page.getByRole('link', { name: 'Open FC#3 in a new tab' })).toHaveAttribute(
      'href',
      '/pipeline/format-converter/3',
    )

    // Clicking #2's link actually lands on its Board entry, in-app, rather
    // than Detail's "not found in the pipeline" dead end.
    await blockedLink.click()
    await expect(page).toHaveURL(/\/board\/format-converter\/2$/)
    await expect(page.getByTestId('board-detail-repo')).toHaveText('format-converter')

    // Clicking #3's link lands on the real pipeline detail page.
    await page.goBack()
    await expect(page).toHaveURL(/\/queue$/)
    await runningLink.click()
    await expect(page).toHaveURL(/\/pipeline\/format-converter\/3$/)
    await expect(
      page.getByRole('heading', { name: 'YAML <-> JSON conversion engine with positioned error reporting' }),
    ).toBeVisible()
  })
})
