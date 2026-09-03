/**
 * E2E coverage for the Queue panel's expandable rows (#82).
 *
 * `DriveQueuePanel.test.tsx` already proves the expand/collapse mechanics
 * against a mocked `@/api/client` (aria-expanded/aria-controls wiring,
 * expansion surviving a reordered/renumbered re-render, disabled-action
 * guards inside the expanded region). What that unit-level suite can't
 * prove is the same behaviour driven by a REAL browser against a REAL
 * `coord web --fixture` process -- same posture `queue-exit-gate.spec.ts`
 * established for the rest of this panel, and the repo's stated acceptance
 * bar for user-visible behaviour (`npm test` vs. `npm run test:e2e` in this
 * repo's own README/CLAUDE.md).
 *
 * Run: npm run test:e2e (requires `coord` on $PATH, see fixtureServer.ts)
 */
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixtureServer, type FixtureServerHandle } from './fixtureServer'

// Reuses the exit gate's own fixture -- its header comment explains why each
// seeded row exists; nothing here needs a fixture of its own.
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'drive-queue-basic.json',
)

test.describe('Queue panel row expand/collapse (#82)', () => {
  let server: FixtureServerHandle

  test.beforeAll(async () => {
    server = await startFixtureServer(FIXTURE_PATH)
  })

  test.afterAll(async () => {
    await server?.stop()
  })

  test('a row collapses to three columns at rest and expands to reveal the rest, independently per row', async ({
    page,
  }) => {
    await page.goto(`${server.baseUrl}/queue`)

    // At rest: the grid header is exactly the three visible columns plus the
    // disclosure control's (visually hidden but accessible) name -- no
    // Machine or Tries column at all.
    const table = page.getByRole('table')
    await expect(table).toBeVisible()
    const headers = await table.getByRole('columnheader').allTextContents()
    expect(headers).toEqual(['Expand', 'Issue', 'Title', 'State'])

    // #9201 (repo-beta, blocked, with a last_reason) starts collapsed --
    // its Reason text and Unblock button are not on screen at rest. The
    // expanded `<dl>` is always mounted (only its `<tr hidden>` ancestor
    // toggles), so a text locator still finds the node -- assert on
    // visibility rather than presence for it; the Unblock button, by
    // contrast, is a role query, which Playwright (like `getByRole`
    // elsewhere in this repo's Vitest suite) already excludes from a
    // `hidden` subtree.
    await expect(page.getByText('checks_failed', { exact: false })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Unblock RB#9201' })).toHaveCount(0)

    const disclosure = page.getByRole('button', { name: 'Expand details for RB#9201' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')

    await disclosure.click()

    // Expanded: the disclosure's own name/state flips, and the fields that
    // moved out of the grid -- Reason (age-stamped in full) and the Unblock
    // action -- are now visible.
    await expect(page.getByRole('button', { name: 'Collapse details for RB#9201' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(page.getByText('checks_failed', { exact: false })).toBeVisible()
    const unblockBtn = page.getByRole('button', { name: 'Unblock RB#9201' })
    await expect(unblockBtn).toBeVisible()
    await expect(unblockBtn).toBeEnabled()

    // A second row's disclosure is independent -- expanding #9101 doesn't
    // collapse #9201, and both detail regions are visible at once.
    await page.getByLabel('Repo', { exact: true }).selectOption('repo-alpha')
    const otherDisclosure = page.getByRole('button', { name: 'Expand details for RA#9101' })
    await otherDisclosure.click()
    await expect(page.getByRole('button', { name: 'Move RA#9101 up' })).toBeVisible()

    // Collapsing #9101 again hides its detail region without affecting the
    // grid otherwise.
    await page.getByRole('button', { name: 'Collapse details for RA#9101' }).click()
    await expect(page.getByRole('button', { name: 'Move RA#9101 up' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Expand details for RA#9101' })).toBeVisible()
  })
})
