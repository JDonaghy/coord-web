/**
 * The Queue panel epic's closing exit-gate slice (#9 QW-5), mirroring
 * M-W1's own exit-gate-slice pattern (#1551 in claude-coordinator).
 *
 * QW-3 (#7) and QW-4 (#8) each already have unit-level coverage in
 * `DriveQueuePanel.test.tsx` -- a mocked `@/api/client`, no real server. What
 * neither of those (nor this epic's other slices) have proven yet is the
 * whole panel working end to end against a REAL `coord web --fixture`
 * process: the actual `/api/drive-queue` handler, the actual
 * `/api/drive-queue/action` handler, and the actual `/api/pipeline` handler
 * (for the Title cell's lookup and the issue link's landing page) all wired
 * together, the same "real dist bundle, real server, no page.route()
 * interception" posture `live-update-fixture.spec.ts` and
 * `available-gates-terminal.spec.ts` already established for their own
 * epics.
 *
 * One test, one long chain, deliberately -- this is the exit gate, not
 * another unit-style suite: load `/queue`, switch the repo-scope dropdown,
 * reorder a row, unblock a row, click an issue link and land on
 * `/pipeline/:repo/:issue`, confirm the open-in-new-tab affordance (#9 QW-5)
 * is present. `e2e/fixtures/drive-queue-basic.json`'s header comment
 * explains why each seeded row exists.
 *
 * #82 moved the Move/Unblock/Release buttons out of the collapsed row into
 * each row's per-row expanded region -- every action below now expands its
 * row's disclosure control first, exactly as a real operator would.
 *
 * Run: npm run test:e2e (requires `coord` on $PATH, see fixtureServer.ts)
 */
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixtureServer, type FixtureServerHandle } from './fixtureServer'

// #2005 split: vendored alongside fixtureServer.ts's FIXTURE_PATH -- see its
// comment for why this no longer climbs to a monorepo `tests/fixtures/`.
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'drive-queue-basic.json',
)

test.describe('Queue panel exit gate (#9 QW-5)', () => {
  let server: FixtureServerHandle

  test.beforeAll(async () => {
    server = await startFixtureServer(FIXTURE_PATH)
  })

  test.afterAll(async () => {
    await server?.stop()
  })

  test('repo dropdown, reorder, unblock, issue link + new-tab affordance all work against a real server', async ({
    page,
  }) => {
    await page.goto(`${server.baseUrl}/queue`)

    // Sanity: the real dist bundle booted against the real fixture data --
    // the summary block's counts come straight off the server's
    // `summarize_drive_queue` aggregate (two waiting, one blocked, across
    // both repos).
    const summary = page.getByLabel('Queue summary')
    await expect(summary).toBeVisible()
    await expect(summary.getByText('Blocked').locator('..').getByRole('definition')).toHaveText('1')

    // Repo-scope dropdown: "All repos" plus one option per repo the seeded
    // queue actually has an active row in. `exact: true` -- a fuzzy substring
    // match on "Repo" also catches every "RA#…" row action's
    // aria-label (e.g. "Move RA#9101 up"), not just this control.
    const repoSelect = page.getByLabel('Repo', { exact: true })
    const options = await repoSelect.locator('option').allTextContents()
    expect(options).toEqual(['All repos', 'repo-alpha', 'repo-beta'])

    // Switch scope to repo-alpha: only that repo's two rows are visible.
    await repoSelect.selectOption('repo-alpha')
    await expect(page.getByText('RA#9101')).toBeVisible()
    await expect(page.getByText('RA#9102')).toBeVisible()
    await expect(page.getByText('RB#9201')).toHaveCount(0)

    // Reorder: #9102 (position 1) moves up, swapping with #9101 (position 0).
    // The rendered swap is necessarily transient against this real server --
    // the fixture records the move but never actually reorders its seeded
    // rows (fixture's own header comment), so the invalidate-and-refetch
    // `handleMove` triggers right after the POST resolves reverts the
    // client's own optimistic swap back to the unchanged seeded order a
    // moment later. The durable, real-server proof here is the outgoing
    // request itself: clicking ▲ must fire the real
    // `POST /api/drive-queue/action` with the correct `move`/`to_position`
    // payload -- `DriveQueuePanel.test.tsx`'s mocked-`api/client` unit test
    // already covers the optimistic-swap rendering in isolation.
    const table = page.getByRole('table')
    await expect(table.getByRole('row').nth(1)).toContainText('RA#9101')

    // The Move button lives in #9102's expanded region (#82) -- open its
    // disclosure control first, same as a real operator would.
    await page.getByRole('button', { name: 'Expand details for RA#9102' }).click()
    const [moveRequest] = await Promise.all([
      page.waitForRequest(
        (req) => req.url().includes('/api/drive-queue/action') && req.method() === 'POST',
      ),
      page.getByRole('button', { name: 'Move RA#9102 up' }).click(),
    ])
    expect(moveRequest.postDataJSON()).toEqual({
      repo_name: 'repo-alpha',
      issue_number: 9102,
      action: 'move',
      to_position: 0,
    })

    // Unblock: switch to repo-beta, whose one row is seeded `blocked` --
    // Unblock is enabled there (unlike on a waiting row) and the click
    // reaches the real POST /api/drive-queue/action handler, which reports
    // success (recorded, not executed, in fixture mode).
    await repoSelect.selectOption('repo-beta')
    await page.getByRole('button', { name: 'Expand details for RB#9201' }).click()
    const unblockBtn = page.getByRole('button', { name: 'Unblock RB#9201' })
    await expect(unblockBtn).toBeEnabled()
    await unblockBtn.click()
    await expect(page.getByText('Unblocked')).toBeVisible()

    // Issue link + new-tab affordance (#9 QW-5): back to repo-alpha, whose
    // #9101 has a matching board assignment so the destination is a real
    // detail page, not Detail's own not-found state.
    await repoSelect.selectOption('repo-alpha')
    // `exact: true` -- otherwise this also matches the new-tab affordance's
    // own "Open RA#9101 in a new tab" accessible name.
    const issueLink = page.getByRole('link', { name: 'RA#9101', exact: true })
    await expect(issueLink).toHaveAttribute('href', '/pipeline/repo-alpha/9101')
    // No explicit target -- in-app SPA nav; ctrl/cmd-click still opens a new
    // tab for free via plain <Link> semantics.
    await expect(issueLink).not.toHaveAttribute('target')

    const newTabLink = page.getByRole('link', { name: 'Open RA#9101 in a new tab' })
    await expect(newTabLink).toBeVisible()
    await expect(newTabLink).toHaveAttribute('href', '/pipeline/repo-alpha/9101')
    await expect(newTabLink).toHaveAttribute('target', '_blank')

    await issueLink.click()
    await expect(page).toHaveURL(/\/pipeline\/repo-alpha\/9101$/)
    await expect(page.getByRole('heading', { name: 'Fix the flaky retry loop' })).toBeVisible()
  })
})
