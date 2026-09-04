/**
 * E2E acceptance net for the Milestones panel (#91, over
 * claude-coordinator#3072).
 *
 * Runs as the `wide` and `narrow` Playwright *projects* (see
 * `playwright.config.ts`'s `BREAKPOINT_PROJECT_FILES`), so a regression
 * pinned to one breakpoint shows up as its own failing line rather than
 * being folded into one generic run — the posture `machines-responsive.
 * spec.ts` and `theme.spec.ts` already establish. The theme block at the
 * bottom exercises both themes at whichever breakpoint the project is
 * running, which is why there is no separate light/dark project.
 *
 * Every response body below is shaped like a **real** one: the field names,
 * the envelope, the two distinct 404s (a handled JSON `{"error": …}` vs. an
 * unrouted `text/plain` "Not Found") were all captured by curling a live
 * `coord web` on `code-coordinator==0.5.368` while building this panel, not
 * inferred from the issue text. That distinction is the whole lesson of
 * coord-web#76: a panel wired to an imagined API passes every mock-based
 * test it has.
 *
 * The degraded states are not an appendix here — issue #91 makes them part
 * of the deliverable, and the "endpoint simply absent" case is the
 * *realistic* one for weeks after this merges, because coord-web
 * auto-deploys on its own timer decoupled from any coord rollout. Each of
 * them additionally asserts the shell around the panel (rail, status bar)
 * is still alive, which is #87's fix restated: a panel's bad day must never
 * blank the SPA.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

const ROSTER = {
  milestones: [
    {
      repo_name: 'coord-web',
      milestone_number: 4,
      title: 'Machines panel',
      state: 'open',
      tracking_issue: 68,
      open_issues: 2,
      closed_issues: 6,
      oracle: true,
      has_work_order: true,
      work_order_total: 7,
      work_order_done: 4,
      ready_frontier: 1,
      in_flight: 2,
      blocked: 0,
      needs_you: [],
    },
    {
      repo_name: 'vimcode',
      milestone_number: 9,
      title: 'Editor chrome',
      state: 'open',
      tracking_issue: null,
      open_issues: 3,
      closed_issues: 0,
      oracle: false,
      has_work_order: false,
      work_order_total: 0,
      work_order_done: 0,
      ready_frontier: 0,
      in_flight: 0,
      blocked: 0,
      needs_you: [],
    },
  ],
  warnings: [],
}

const DETAIL = {
  repo_name: 'coord-web',
  milestone_number: 4,
  title: 'Machines panel',
  state: 'open',
  tracking_issue: 68,
  open_issues: 2,
  closed_issues: 6,
  oracle: true,
  has_work_order: true,
  entries: [
    {
      issue_number: 66,
      title: 'Fleet summary header',
      state: 'closed',
      position: 1,
      after: [],
      group: 'A',
      gates: {
        assignment_id: 'work-66',
        status: 'merged',
        branch: 'issue-66',
        machine_name: 'dellserver',
        test_state: 'passed',
        smoke_test: 'pass',
        review_state: 'done',
        review_verdict: 'approve',
      },
    },
    {
      issue_number: 61,
      title: 'Machines API client, types, route and rail entry',
      state: 'open',
      position: 2,
      after: [66],
      group: 'B',
      gates: null,
    },
  ],
  gate_a: {
    state: 'approved',
    ok: true,
    contract_sha: 'abcdef1234567',
    reason: null,
    verdict: 'approved',
    actor: 'john',
    recorded_at: 1_700_000_000,
    approved_contract_sha: 'abcdef1234567',
    href: '/api/gate-a/coord-web/68',
  },
  warnings: [],
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

/** The shell's own global reads — every spec that boots the app cold has to
 * stub these regardless of which panel it is testing. */
async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json([])))
  await page.route('**/api/board', (route) =>
    route.fulfill(json({ round_number: 1, active: [], completed: [] })),
  )
  await page.route('**/api/sessions', (route) => route.fulfill(json([])))
}

async function mockMilestones(
  page: Page,
  opts: {
    list?: { status?: number; body?: unknown; contentType?: string }
    detail?: { status?: number; body?: unknown; contentType?: string }
  } = {},
): Promise<void> {
  const list = opts.list ?? { body: ROSTER }
  const detail = opts.detail ?? { body: DETAIL }
  // Detail first: Playwright matches the most recently registered route, and
  // `**/api/milestones*` would otherwise swallow `/api/milestones/x/4`.
  await page.route('**/api/milestones', (route) =>
    route.fulfill({
      status: list.status ?? 200,
      contentType: list.contentType ?? 'application/json',
      body: typeof list.body === 'string' ? list.body : JSON.stringify(list.body ?? ROSTER),
    }),
  )
  await page.route('**/api/milestones/*/*', (route) =>
    route.fulfill({
      status: detail.status ?? 200,
      contentType: detail.contentType ?? 'application/json',
      body: typeof detail.body === 'string' ? detail.body : JSON.stringify(detail.body ?? DETAIL),
    }),
  )
}

const rail = (page: Page) => page.locator('[data-region="rail"]')
const statusBar = (page: Page) => page.getByLabel('Status')

/** The shell survived whatever the panel was just handed. Asserted in every
 * degraded-state test below, not only the happy path (#87). */
async function expectShellAlive(page: Page): Promise<void> {
  await expect(rail(page)).toBeVisible()
  await expect(statusBar(page)).toBeVisible()
  // The list/detail ErrorBoundary fallbacks say this; a degraded state is a
  // *rendered* state, never a caught crash.
  await expect(page.getByText(/panel hit an error/)).toHaveCount(0)
}

test.describe('Milestones roster', () => {
  test('the rail entry is live and navigates — no longer a SOON placeholder', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/pipeline')

    const entry = rail(page).getByRole('button', { name: /Milestones/ })
    await expect(entry).toBeEnabled()
    await entry.click()

    await expect(page).toHaveURL(/\/milestones$/)
    await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible()
    // The old placeholder copy must be gone, not merely covered up.
    await expect(page.getByText(/coming soon/i)).toHaveCount(0)
  })

  test('shows repo, number, title, both progress scopes and the oracle badge', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/milestones')

    const row = page.getByTestId('milestone-row-coord-web-4')
    await expect(row).toBeVisible()
    await expect(row).toContainText('CW ms-4')
    await expect(row).toContainText('Machines panel')
    await expect(row.getByTestId('issue-progress')).toHaveText('6/8 issues closed')
    await expect(row.getByTestId('work-order-progress')).toHaveText('work order 4/7')
    await expect(row.getByTestId('oracle-badge')).toBeVisible()

    // The non-oracle repo's row carries no badge and says so about its work
    // order rather than showing a meaningless 0/0.
    const other = page.getByTestId('milestone-row-vimcode-9')
    await expect(other.getByTestId('oracle-badge')).toHaveCount(0)
    await expect(other.getByTestId('no-work-order')).toBeVisible()
    await expectShellAlive(page)
  })

  test('a repo with no milestones contributes nothing, and an empty roster explains itself', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockMilestones(page, { list: { body: { milestones: [], warnings: [] } } })
    await page.goto('/milestones')

    await expect(page.getByTestId('milestones-empty')).toContainText('No milestones')
    // Distinct from the "endpoint absent" state below — an operator must be
    // able to tell "nothing filed yet" from "this server can't answer".
    await expect(page.getByTestId('milestones-unavailable')).toHaveCount(0)
    await expectShellAlive(page)
  })

  test('a partial roster shows its warnings AND the repos that did load', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page, {
      list: {
        body: {
          milestones: ROSTER.milestones.slice(0, 1),
          warnings: ['could not list milestones for JDonaghy/vimcode: gh: rate limited'],
        },
      },
    })
    await page.goto('/milestones')

    await expect(page.getByTestId('milestone-warnings')).toContainText('rate limited')
    await expect(page.getByTestId('milestone-row-coord-web-4')).toBeVisible()
    await expectShellAlive(page)
  })
})

test.describe('Milestones — degraded states', () => {
  test('an endpoint that simply is not there yet explains itself, never a white screen', async ({
    page,
  }) => {
    // A coord server predating claude-coordinator#3072 answers Starlette's
    // default text/plain 404 for an unrouted path — captured verbatim from a
    // real server, which is why this is not `{"error": …}`.
    await mockShellApi(page)
    await mockMilestones(page, { list: { status: 404, body: 'Not Found', contentType: 'text/plain' } })
    await page.goto('/milestones')

    await expect(page.getByTestId('milestones-unavailable')).toContainText(
      /doesn't serve \/api\/milestones yet/,
    )
    await expectShellAlive(page)
  })

  test('a handled 404 shows the server’s own message, not the absent-endpoint copy', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockMilestones(page, { list: { status: 404, body: { error: "unknown repo 'nope'" } } })
    await page.goto('/milestones')

    const note = page.getByTestId('milestones-unavailable')
    await expect(note).toContainText("unknown repo 'nope'")
    await expect(note).not.toContainText("doesn't serve /api/milestones yet")
    await expectShellAlive(page)
  })

  test('a response that is not the declared shape is reported, not cast into a crash (#85)', async ({
    page,
  }) => {
    // #84's exact bug: a bare array where the envelope belongs.
    await mockShellApi(page)
    await mockMilestones(page, { list: { body: [ROSTER.milestones[0]] } })
    await page.goto('/milestones')

    await expect(page.getByTestId('milestones-unavailable')).toContainText(
      'response: expected an object',
    )
    await expectShellAlive(page)
  })

  test('a milestone with no work order says why, and still shows everything else', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockMilestones(page, {
      detail: {
        body: {
          ...DETAIL,
          entries: [],
          has_work_order: false,
          tracking_issue: null,
          gate_a: null,
        },
      },
    })
    await page.goto('/milestones/coord-web/4')

    await expect(page.getByTestId('work-order-empty')).toContainText('No work order')
    await expect(page.getByTestId('gate-a-none')).toBeVisible()
    // The milestone's own header is still there — a missing work order is
    // not a missing milestone.
    await expect(page.getByRole('heading', { name: 'Machines panel' })).toBeVisible()
    await expectShellAlive(page)
  })

  test('an unknown milestone 404s legibly on the detail route', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page, {
      detail: {
        status: 404,
        body: { error: 'could not fetch milestone 9999 in coord-web: gh: Not Found (HTTP 404)' },
      },
    })
    await page.goto('/milestones/coord-web/9999')

    await expect(page.getByTestId('milestone-detail-unavailable')).toContainText(
      'could not fetch milestone 9999',
    )
    await expectShellAlive(page)
  })
})

test.describe('Milestone detail — the work order', () => {
  test('deep-links, and survives a reload at that URL', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/milestones/coord-web/4')

    await expect(page.getByRole('heading', { name: 'Machines panel' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Machines panel' })).toBeVisible()
  })

  test('renders the work order in the endpoint’s order, not sorted by issue number', async ({
    page,
  }) => {
    // The fixture is deliberately out of numeric order (66 then 61): the
    // `## Work order` sequence is the only ordering signal the response
    // carries, and re-sorting client-side would silently destroy it.
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/milestones/coord-web/4')

    const rows = page.getByTestId(/^work-order-entry-/)
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Fleet summary header')
    await expect(rows.nth(1)).toContainText('Machines API client')
  })

  test('each row carries its issue number, state and gate columns', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/milestones/coord-web/4')

    const merged = page.getByTestId('work-order-entry-66')
    await expect(merged).toContainText('CW#66')
    await expect(merged.getByTestId('entry-state')).toHaveText('closed')
    await expect(merged.getByTestId('gate-test')).toContainText('passed')
    await expect(merged.getByTestId('gate-review')).toContainText('approve')

    // Never dispatched is its own fact — the four columns stay, empty.
    const pending = page.getByTestId('work-order-entry-61')
    await expect(pending.getByTestId('entry-never-dispatched')).toBeVisible()
    await expect(pending.getByTestId('gate-test')).toContainText('—')
  })

  test('links across to the Gate-A packet instead of re-rendering the contract', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/milestones/coord-web/4')

    await expect(page.getByTestId('gate-a-sha')).toContainText('abcdef1')
    await page.getByTestId('gate-a-link').click()
    await expect(page).toHaveURL('/gate-a/coord-web/68')
  })

  test('a stale sign-off is unmissable — an alert with both shas', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page, {
      detail: {
        body: {
          ...DETAIL,
          gate_a: { ...DETAIL.gate_a, state: 'stale', approved_contract_sha: '0ldsha9999' },
        },
      },
    })
    await page.goto('/milestones/coord-web/4')

    const alert = page.getByTestId('gate-a-stale')
    await expect(alert).toBeVisible()
    await expect(alert).toHaveAttribute('role', 'alert')
    await expect(alert).toContainText('0ldsha')
    await expect(alert).toContainText('abcdef1')
  })

  test('a roster row opens its own detail view', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/milestones')

    await page.getByTestId('milestone-row-coord-web-4').click()
    await expect(page).toHaveURL('/milestones/coord-web/4')
    await expect(page.getByTestId('work-order-entry-66')).toBeVisible()
  })
})

test.describe('Milestones in both themes', () => {
  const themeToggle = (page: Page) =>
    page.getByRole('button', { name: /Switch to (dark|light) theme/ })

  test('the roster and the detail view render in dark and in light', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page)
    await page.goto('/milestones')

    // Two passes: once in the theme the app starts in, once in the other.
    for (let pass = 0; pass < 2; pass += 1) {
      // The roster first, in whatever theme is current. A filled progress
      // bar is the element most likely to vanish into its own background
      // when only one theme was ever looked at.
      await expect(page.getByTestId('milestone-row-coord-web-4')).toBeVisible()
      await expect(page.getByTestId('progress-fill').first()).toBeVisible()

      // ...then the detail view, reached the way a human reaches it.
      await page.getByTestId('milestone-row-coord-web-4').click()
      await expect(page.getByTestId('work-order-entry-66')).toBeVisible()
      await expect(page.getByTestId('gate-a-state')).toBeVisible()

      // Toggle from the ROSTER, not from the detail view: on narrow the
      // detail replaces the list entirely, and the only theme control that
      // exists below 768px is `PanelHeader`'s `md:hidden` one, which lives
      // in the list panel's own header (see `PanelHeader.tsx`'s comment and
      // `theme.spec.ts`, which found the same asymmetry for the rail). From
      // 768px up the rail foot's control answers the same accessible name,
      // so this line works unchanged at both breakpoints.
      await page.getByRole('button', { name: 'Back' }).click()
      const before = await page.locator('html').getAttribute('data-theme')
      await themeToggle(page).click()
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '')
    }
  })

  test('the absent-endpoint empty state is readable in both themes', async ({ page }) => {
    await mockShellApi(page)
    await mockMilestones(page, { list: { status: 404, body: 'Not Found', contentType: 'text/plain' } })
    await page.goto('/milestones')

    await expect(page.getByTestId('milestones-unavailable')).toBeVisible()
    await themeToggle(page).click()
    await expect(page.getByTestId('milestones-unavailable')).toBeVisible()
    await expectShellAlive(page)
  })
})
