/**
 * E2E acceptance net for #107 — `BoardDetail` swapped onto
 * `GET /api/issue/{repo}/{number}` (claude-coordinator#3194).
 *
 * Covers exactly the acceptance bar #107 spells out:
 *  - a never-dispatched issue (`format-converter#2`, the issue's own live
 *    example) renders its full body, and its GitHub link resolves to the
 *    real `owner/repo` slug, not the coord repo name
 *  - the name≠slug case (`claude-coordinator` is `JDonaghy/code-coordinator`)
 *    links correctly
 *  - an issue number the store has never synced renders an honest empty
 *    state, not a crash or a blank pane
 *
 * `e2e/board.spec.ts` keeps the tree/filter surface (#101) and the
 * no-regression dispatched-issue-body case; this file is the one dedicated
 * to the endpoint swap itself.
 */
import { test, expect, type Page } from '@playwright/test'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json([])))
  await page.route('**/api/sessions', (route) => route.fulfill(json([])))
  await page.route('**/api/drive-queue', (route) =>
    route.fulfill(
      json({
        entries: [],
        summary: { level: 'ok', pending: 0, running: 0, waiting: 0, blocked: 0, eligible: 0, held: 0, fleet_held: 0 },
        titles: {},
      }),
    ),
  )
}

const rail = (page: Page) => page.locator('[data-region="rail"]')
const statusBar = (page: Page) => page.getByLabel('Status')

async function expectShellAlive(page: Page): Promise<void> {
  await expect(rail(page)).toBeVisible()
  await expect(statusBar(page)).toBeVisible()
  await expect(page.getByText(/panel hit an error/)).toHaveCount(0)
}

test.describe('BoardDetail — GET /api/issue/{repo}/{number} (#107)', () => {
  test('a never-dispatched issue renders its full body and the correct GitHub link', async ({ page }) => {
    await mockShellApi(page)
    await page.route('**/api/issue/format-converter/2', (route) =>
      route.fulfill(
        json({
          repo_name: 'format-converter',
          number: 2,
          title: 'Cloudflare Pages scaffold: static, no-Access, strict no-egress CSP',
          body:
            '## What\n\nStatic Cloudflare Pages scaffold, no Access, strict no-egress CSP.\n\n' +
            '- no third-party requests\n',
          state: 'open',
          labels: ['area:infra'],
          milestone_number: null,
          milestone_title: null,
          html_url: 'https://github.com/JDonaghy/format-converter/issues/2',
        }),
      ),
    )
    await page.goto('/board/format-converter/2')

    // The full body renders — never the old "hasn't been dispatched" gap.
    await expect(page.getByRole('heading', { name: 'What' })).toBeVisible()
    await expect(page.getByText('no third-party requests')).toBeVisible()
    await expect(page.getByTestId('board-detail-not-found')).toHaveCount(0)

    // Every link out to GitHub is the endpoint's own html_url, not a
    // composed `github.com/<repo>/issues/<n>` guess.
    const links = page.getByRole('link', { name: /github\.com\/JDonaghy\/format-converter\/issues\/2/ })
    await expect(links.first()).toHaveAttribute(
      'href',
      'https://github.com/JDonaghy/format-converter/issues/2',
    )
    await expectShellAlive(page)
  })

  test('the name≠slug case — claude-coordinator is JDonaghy/code-coordinator', async ({ page }) => {
    await mockShellApi(page)
    await page.route('**/api/issue/claude-coordinator/3194', (route) =>
      route.fulfill(
        json({
          repo_name: 'claude-coordinator',
          number: 3194,
          title: 'GET /api/issue/{repo}/{number} — one issue, dispatched or not',
          body: '## What\n\nAdd the endpoint.\n',
          state: 'closed',
          labels: [],
          milestone_number: null,
          milestone_title: null,
          html_url: 'https://github.com/JDonaghy/code-coordinator/issues/3194',
        }),
      ),
    )
    await page.goto('/board/claude-coordinator/3194')

    await expect(page.getByTestId('board-detail-title')).toContainText('GET /api/issue')
    await expect(page.getByTestId('board-detail-github-state')).toContainText('closed')
    const link = page.getByRole('link', { name: /github\.com\/JDonaghy\/code-coordinator\/issues\/3194/ })
    await expect(link.first()).toHaveAttribute(
      'href',
      'https://github.com/JDonaghy/code-coordinator/issues/3194',
    )
    await expectShellAlive(page)
  })

  test('an issue number the store has never synced renders an honest empty state', async ({ page }) => {
    await mockShellApi(page)
    await page.route('**/api/issue/format-converter/9999', (route) =>
      route.fulfill(json({ error: "unknown issue 'format-converter#9999'" }, 404)),
    )
    await page.goto('/board/format-converter/9999')

    await expect(page.getByTestId('board-detail-not-found')).toBeVisible()
    await expect(page.getByTestId('board-detail-title')).toHaveCount(0)
    await expectShellAlive(page)
  })
})
