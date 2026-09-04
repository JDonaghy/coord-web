/**
 * E2E coverage for #90 — the Gate-A review panel at
 * `/gate-a/:repo/:trackingIssue` (claude-coordinator#3066 slice 2/2, backend
 * claude-coordinator#3069).
 *
 * Mocks `GET /api/gate-a/{repo}/{tracking_issue}` via `page.route()`, same
 * posture `stage-chip-verdict.spec.ts`/`answers.spec.ts` use rather than
 * booting a live `coord web --fixture` process — this route isn't wired into
 * `coord/dashboard/fixture.py` (it hits live GitHub Contents API server-side,
 * out of scope for a deterministic local fixture), so `fetchGateA`'s real
 * response shape is what's asserted against here, not the fixture's.
 *
 * Covers the issue's own acceptance bar: the stale state is unmissable, a
 * `## Amendment` section is surfaced rather than buried, and the width
 * control actually changes the rendered mock frame's width — 390px in
 * particular, since that's the exact width ms-4's own regression was only
 * visible at.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

const REPO = 'coord-portal'
const TRACKING_ISSUE = 4

const MOCK_HTML =
  '<html><head><style>:root{--bg:#fff}[data-theme="dark"]{--bg:#000}body{background:var(--bg)}</style></head><body><h1>Home mock</h1></body></html>'

function basePacket(overrides: Record<string, unknown> = {}) {
  return {
    repo_name: REPO,
    milestone_number: 4,
    milestone_title: 'ms-4',
    tracking_issue: TRACKING_ISSUE,
    tracking_issue_title: 'ms-4 tracking issue',
    state: 'approved',
    ok: true,
    stale: false,
    contract_sha: 'abc123def456abc123def456abc123def456789',
    reason: null,
    approval: null,
    contract_markdown: '# ms-4 contract\n\n## Scope\n\nDo the thing.\n',
    mocks: [{ name: 'home.html', title: 'Home', html: MOCK_HTML }],
    mocks_note: '',
    ...overrides,
  }
}

async function mockGateA(page: Page, packet: Record<string, unknown>): Promise<void> {
  await page.route(`**/api/gate-a/${REPO}/${TRACKING_ISSUE}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(packet) }),
  )
}

test.describe('Gate-A review panel (#90)', () => {
  test('a stale gate shows an unmissable banner; a fresh one shows none', async ({ page }) => {
    await mockGateA(page, basePacket({ state: 'stale', stale: true }))
    await page.goto(`/gate-a/${REPO}/${TRACKING_ISSUE}`)

    const banner = page.getByTestId('gate-a-stale-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/stale/i)
  })

  test('a fresh, approved gate renders no stale banner', async ({ page }) => {
    await mockGateA(page, basePacket({ state: 'approved', stale: false }))
    await page.goto(`/gate-a/${REPO}/${TRACKING_ISSUE}`)

    await expect(page.getByTestId('gate-a-state-badge')).toContainText(/approved/i)
    await expect(page.getByTestId('gate-a-stale-banner')).toHaveCount(0)
  })

  test('an Amendment section gets a quick-nav callout instead of sitting buried in the contract', async ({
    page,
  }) => {
    await mockGateA(
      page,
      basePacket({
        contract_markdown:
          '# ms-4\n\n## Scope\n\n' +
          'filler. '.repeat(200) +
          '\n\n## Amendment 1: header reflow at 390px\n\nFixed the header.\n',
      }),
    )
    await page.goto(`/gate-a/${REPO}/${TRACKING_ISSUE}`)

    const nav = page.getByTestId('gate-a-amendment-nav')
    await expect(nav).toBeVisible()
    await expect(nav).toContainText('Amendment 1: header reflow at 390px')

    // Clicking the quick-nav entry scrolls the actual rendered heading into view.
    const heading = page.getByRole('heading', { name: /Amendment 1: header reflow at 390px/ })
    await expect(heading).not.toBeInViewport()
    await page.getByTestId('gate-a-amendment-link-Amendment 1: header reflow at 390px').click()
    await expect(heading).toBeInViewport()
  })

  test('the width control resizes the mock frame to exactly 390px, the width the ms-4 regression needed', async ({
    page,
  }) => {
    await mockGateA(page, basePacket())
    await page.goto(`/gate-a/${REPO}/${TRACKING_ISSUE}`)

    const frame = page.getByTestId('gate-a-mock-frame-home.html')
    await expect(frame).toBeVisible()

    await page.getByTestId('gate-a-width-phone').click()
    await expect(frame).toHaveCSS('width', '390px')

    await page.getByTestId('gate-a-width-tablet').click()
    await expect(frame).toHaveCSS('width', '768px')
  })

  test('the theme control sets data-theme on the mock frame itself, independent of the app chrome', async ({
    page,
  }) => {
    await mockGateA(page, basePacket())
    await page.goto(`/gate-a/${REPO}/${TRACKING_ISSUE}`)

    const frame = page.frameLocator('[data-testid="gate-a-mock-frame-home.html"]')
    await expect(frame.locator('h1')).toHaveText('Home mock')

    await page.getByTestId('gate-a-theme-light').click()
    await expect(page.frameLocator('[data-testid="gate-a-mock-frame-home.html"]').locator('html')).toHaveAttribute(
      'data-theme',
      'light',
    )

    await page.getByTestId('gate-a-theme-dark').click()
    await expect(page.frameLocator('[data-testid="gate-a-mock-frame-home.html"]').locator('html')).toHaveAttribute(
      'data-theme',
      'dark',
    )
  })

  test('a 404 (no milestone) renders the server-given reason, not a generic failure', async ({ page }) => {
    await page.route(`**/api/gate-a/${REPO}/9999`, (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: `${REPO}#9999 has no milestone — Gate A is a milestone-level gate`,
        }),
      }),
    )
    await page.goto(`/gate-a/${REPO}/9999`)

    await expect(page.getByTestId('gate-a-fetch-error')).toContainText(/has no milestone/)
  })

  test('prints the coord gate-a CLI commands rather than offering a submit control', async ({ page }) => {
    await mockGateA(page, basePacket())
    await page.goto(`/gate-a/${REPO}/${TRACKING_ISSUE}`)

    await expect(page.getByTestId('gate-a-approved-command')).toHaveText(
      `coord gate-a ${REPO} ${TRACKING_ISSUE} --approved`,
    )
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(0)
  })
})
