/**
 * Breakpoint + theme coverage for the Machines panel (#67, M-4's exit gate).
 *
 * `machines.spec.ts` covers this panel's functional surface (degraded
 * states, live updates, deep links) at a single default viewport; this file
 * is the other half of #67's named acceptance bar -- "both breakpoints" and
 * "both themes" -- applied specifically to this panel, the same way
 * `deep-link.spec.ts`/`theme.spec.ts` already proved it for Pipeline/
 * Sessions and `machine-charts.spec.ts` already proved it for the charts
 * sub-section (#65). Nothing here re-covers that charts ground.
 *
 * Runs as the 'wide' / 'narrow' Playwright projects (playwright.config.ts's
 * `BREAKPOINT_PROJECT_FILES`), not a single project's `test.use({viewport})`
 * override -- a regression pinned to one breakpoint shows up as its own
 * failing project/line rather than folding into a generic run, matching
 * every other file already using that convention.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json([])))
  await page.route('**/api/board', (route) =>
    route.fulfill(json({ round_number: 1, active: [], completed: [] })),
  )
  await page.route('**/api/sessions', (route) => route.fulfill(json([])))
}

function machineState(overrides: {
  name: string
  reachable: boolean
  severity: 'ok' | 'warn' | 'crit' | 'unknown'
  is_local?: boolean
}) {
  return {
    host: null,
    last_seen: Math.floor(Date.now() / 1000),
    active_assignments: 0,
    headless_workers: 0,
    agent_version: null,
    is_local: false,
    quiet_hours_paused: false,
    hand_paused: false,
    release_cordoned: false,
    worktree_bytes: null,
    concurrency_limit: null,
    ...overrides,
  }
}

const ROSTER = [
  machineState({ name: 'laptop', reachable: true, severity: 'ok', is_local: true }),
  machineState({ name: 'oldbox', reachable: false, severity: 'unknown' }),
]

async function mockMachines(page: Page): Promise<void> {
  await mockShellApi(page)
  await page.route('**/api/machines', (route) => route.fulfill(json(ROSTER)))
  await page.route('**/api/fleet/health', (route) => route.fulfill(json([])))
  // Every per-name MachineDetail route 404s -- irrelevant to this file's
  // concern (layout/theme, not data), so kept minimal and honest rather than
  // hand-waved with an empty 200.
  for (const name of ['laptop', 'oldbox']) {
    const escaped = encodeURIComponent(name)
    for (const suffix of ['', '/health', '/work-stats', '/workers', '/jobs', '/metrics']) {
      await page.route(`**/api/machines/${escaped}${suffix}`, (route) =>
        route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
      )
    }
  }
}

const detail = (page: Page) => page.locator('[data-region="detail"]')
const list = (page: Page) => page.locator('[data-region="list"]')

test.describe('Machines panel — both breakpoints (#67)', () => {
  test('wide shows the roster and a selected machine\'s detail side by side; narrow shows one at a time with Back returning to the roster', async ({
    page,
  }, testInfo) => {
    await mockMachines(page)
    await page.goto('/machines')

    await expect(list(page).getByTestId('machine-row-laptop')).toBeVisible()

    if (testInfo.project.name === 'wide') {
      // Cold-loading the list route still gives wide its detail column
      // (EmptyDetail) -- same "both panels present" contract deep-link.spec.ts
      // pins for Pipeline/Sessions.
      await expect(page.locator('[data-region="rail"]').getByRole('button', { name: /^Machines/ })).toHaveAttribute(
        'aria-current',
        'page',
      )
    } else {
      await expect(list(page)).toBeVisible()
    }

    await page.getByTestId('machine-row-laptop').click()
    await expect(page).toHaveURL(/\/machines\/laptop$/)

    if (testInfo.project.name === 'wide') {
      // Wide keeps the roster visible alongside the now-populated detail.
      await expect(list(page).getByTestId('machine-row-oldbox')).toBeVisible()
      await expect(detail(page).getByText('Machine state unavailable')).toBeVisible()
    } else {
      // Narrow's drill-in: the roster is gone, only the detail shows, and
      // Back returns to it -- the roster was never dropped, just not the
      // first thing rendered (same convention deep-link.spec.ts pins for
      // Pipeline's narrow drill-in).
      await expect(list(page)).toHaveCount(0)
      await expect(detail(page).getByText('Machine state unavailable')).toBeVisible()
      await page.getByLabel('Back').click()
      await expect(list(page).getByTestId('machine-row-laptop')).toBeVisible()
      await expect(detail(page)).toHaveCount(0)
    }
  })

  test('goto /machines/:name cold restores the detail directly at this breakpoint, without visiting the roster first', async ({
    page,
  }, testInfo) => {
    await mockMachines(page)
    await page.goto('/machines/oldbox')

    await expect(detail(page).getByText('Machine state unavailable')).toBeVisible()

    if (testInfo.project.name === 'wide') {
      await expect(list(page).getByTestId('machine-row-laptop')).toBeVisible()
    } else {
      await expect(list(page)).toHaveCount(0)
    }
  })
})

// ── Theme (#67) ──────────────────────────────────────────────────────────────

/** Whichever theme toggle is actually in the accessibility tree at this
 * viewport -- the rail's (wide/medium) or `PanelHeader`'s (narrow). Same
 * dual-control convention `theme.spec.ts` documents for Pipeline; this test
 * exists to confirm it wasn't accidentally left wired to only one route. */
function themeToggle(page: Page) {
  return page.getByRole('button', { name: /Switch to (dark|light) theme/ })
}

function htmlTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'))
}

test.use({ colorScheme: 'dark' })

test.describe('Machines panel — both themes (#67)', () => {
  test('the theme toggle is reachable on the Machines panel and visibly changes the rendered surface', async ({
    page,
  }) => {
    await mockMachines(page)
    await page.goto('/machines')

    await expect.poll(() => htmlTheme(page)).toBe('dark')
    const toggle = themeToggle(page)
    await expect(toggle).toBeVisible()

    const surface = page.locator('body')
    const darkBg = await surface.evaluate((el) => getComputedStyle(el).backgroundColor)

    await toggle.click()
    await expect.poll(() => htmlTheme(page)).toBe('light')
    const lightBg = await surface.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(lightBg).not.toEqual(darkBg)

    // The roster and its severity badges stay legible/present across the
    // switch -- a theme regression here would otherwise only show up as a
    // vague "looks broken," never a failing assertion.
    await expect(page.getByTestId('machine-row-laptop').getByTestId('severity-badge')).toBeVisible()
    await expect(page.getByTestId('machine-row-oldbox').getByTestId('severity-badge')).toBeVisible()

    await toggle.click()
    await expect.poll(() => htmlTheme(page)).toBe('dark')
  })

  test('a selected machine\'s detail (including its honest unavailable notes) stays legible after switching to light theme from the roster', async ({
    page,
  }) => {
    // Toggles from `/machines` (the roster), not from the detail route
    // itself: at narrow, `MachineDetail`'s own header (`BackHeader`) carries
    // no theme control of its own -- `PanelHeader`'s narrow-only toggle
    // (the one `themeToggle()` finds) only ever renders in the *list* slot,
    // which narrow unmounts once a machine is drilled into. That's a real
    // gap (no reachable toggle on ANY detail route at narrow -- Pipeline's
    // and Sessions' detail headers have the same omission, not something
    // specific to Machines), but fixing `BackHeader`/`Detail.tsx`/
    // `SessionDetail.tsx` is out of this issue's scope (`e2e/*.spec.ts`
    // only) -- theme persists across navigation regardless of which screen
    // has a visible control for it, which is what this test actually needs.
    await mockMachines(page)
    await page.goto('/machines')
    await themeToggle(page).click()
    await expect.poll(() => htmlTheme(page)).toBe('light')

    await page.getByTestId('machine-row-laptop').click()
    await expect(page).toHaveURL(/\/machines\/laptop$/)

    await expect.poll(() => htmlTheme(page)).toBe('light')
    await expect(detail(page).getByText('Machine state unavailable')).toBeVisible()
    await expect(detail(page).getByText('Metrics unavailable')).toBeVisible()
  })
})
