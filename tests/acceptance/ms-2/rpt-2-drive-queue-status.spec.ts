/**
 * ms-2 sealed acceptance slice — RPT-2 (#21): Reports rail item + picker +
 * first report end-to-end (drive-queue-status).
 *
 * Contract: tests/acceptance/ms-2/contract.md
 * Mocks:    tests/acceptance/ms-2/mocks/reports-picker.html  (cold load)
 *           tests/acceptance/ms-2/mocks/reports-grid.html    (after Run report)
 *
 * Authored by an INDEPENDENT test-author session from the contract + the two
 * mocks above alone — no implementation exists in this repo yet (confirmed
 * by grep: no `report` reference anywhere in src/api/client.ts or
 * src/api/generated.ts, matching contract.md's own "What this contract is
 * for" framing). Every assertion below cites the contract clause it encodes.
 *
 * Scope: ONLY #21's own black-box surface — the rail entry, the six-tab
 * picker shell, the choice/text parameter dispatch, and the
 * drive-queue-status grid's column-kind rendering (text/int/enum/timestamp/
 * duration/list). Explicitly OUT of this slice (left for their own issues'
 * test-authors, per contract.md's own issue table):
 *   - Export CSV (§5, disabled/enabled + `?format=csv`) — RPT-5, #24.
 *   - row_identity Links on issue-activity/completed/decisions — RPT-4, #23.
 *   - The `decisions` options-column rendering — RPT-3, #22.
 *   - Chart rendering / Degrade fallback — RPT-6, #25.
 *   - `money`-kind formatting (only exercised by `completed`) — #22.
 * This slice DOES assert that drive-queue-status's own Issue column renders
 * as plain text with NO row-nav Link (§7c/§7.1) — that is #21's own report's
 * rendering, not #23's feature; #23 only ships the Link behaviour for the
 * three reports that declare `row_identity`, which drive-queue-status does
 * not.
 *
 * Seeding (#1818): tests/acceptance/ms-2/fixtures/reports-ms2.json, read by
 * playwright.acceptance.config.ts to boot a real `coord web --fixture`
 * process. See that file's own `_comment` for why its `report_catalogue`
 * deliberately OVERRIDES the real `coord.reports.catalogue()` (pins
 * contract §3b's exact tab order and exercises both branches of §4b's
 * choice/text dispatch rule against this milestone's own report).
 *
 * Run (the declared web-playwright driver command):
 *   npm run test:acceptance -- ms-2
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

// ── Locator helpers ──────────────────────────────────────────────────────────

function reportsTablist(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Reports catalogue' })
}

function reportsGrid(page: Page): Locator {
  return page.getByTestId('reports-grid')
}

async function runDriveQueueStatus(page: Page): Promise<void> {
  await page.getByTestId('reports-run-button').click()
  await expect(reportsGrid(page)).toBeVisible()
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('ms-2 Reports panel — RPT-2 drive-queue-status (#21)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports')
  })

  /**
   * §1a/§1c/§1d/§1e — the Reports rail entry: `data-testid`
   * `rail-item-reports`, `status: 'ready'` (clickable, not dimmed like its
   * `Audit`/`Spend` neighbours), lives in the `Insight` group, and carries
   * `aria-current="page"` once its route is active.
   *
   * Pinned by both mocks (identical rail markup in each).
   */
  test('Reports rail entry is a ready, selected member of the Insight group', async ({ page }) => {
    const insightHeading = page.getByText('Insight', { exact: true })
    await expect(insightHeading).toBeVisible()

    const railItem = page.getByTestId('rail-item-reports')
    await expect(railItem).toBeVisible()
    await expect(railItem).toHaveAttribute('aria-current', 'page')
    // A 'soon' neighbour is inert and carries aria-disabled; Reports must not.
    await expect(railItem).not.toHaveAttribute('aria-disabled', 'true')

    // Sits in the Insight group, i.e. after the Insight heading and not
    // before it — §1d ("below the Insight heading, alongside Audit/Spend").
    // Position *within* the group (relative to Audit/Spend) is unpinned
    // (contract §7.3) so this only checks group membership via DOM order.
    const insightBox = await insightHeading.boundingBox()
    const railItemBox = await railItem.boundingBox()
    expect(insightBox).not.toBeNull()
    expect(railItemBox).not.toBeNull()
    expect(railItemBox!.y).toBeGreaterThan(insightBox!.y)
  })

  /**
   * §3a/§3b — a `role="tablist"` named `Reports catalogue`, `data-testid`
   * `reports-tablist`, containing exactly six tabs in the pinned order, each
   * with the pinned `data-testid`/text pair.
   */
  test('report picker lists exactly six tabs in the pinned order', async ({ page }) => {
    const tablist = reportsTablist(page)
    await expect(tablist).toBeVisible()
    await expect(tablist).toHaveAttribute('data-testid', 'reports-tablist')
    await expect(tablist.getByRole('tab')).toHaveCount(6)

    const expected = [
      ['drive-queue-status', 'Drive queue status'],
      ['issue-activity', 'Issue activity'],
      ['completed', 'Completed'],
      ['decisions', 'Decisions'],
      ['usage', 'Usage'],
      ['queue-outcomes', 'Queue outcomes'],
    ] as const

    const tabs = tablist.getByRole('tab')
    for (let i = 0; i < expected.length; i++) {
      const [key, text] = expected[i]
      const tab = tabs.nth(i)
      await expect(tab).toHaveAttribute('data-testid', `reports-tab-${key}`)
      await expect(tab).toHaveText(text)
    }
  })

  /**
   * §3c — `drive-queue-status` is `aria-selected="true"` on cold load; the
   * other five are `aria-selected="false"`. Pinned in `reports-picker.html`.
   */
  test('drive-queue-status tab is selected on cold load, the other five are not', async ({ page }) => {
    const tablist = reportsTablist(page)
    await expect(page.getByTestId('reports-tab-drive-queue-status')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    for (const key of ['issue-activity', 'completed', 'decisions', 'usage', 'queue-outcomes']) {
      await expect(tablist.getByTestId(`reports-tab-${key}`)).toHaveAttribute(
        'aria-selected',
        'false',
      )
    }
  })

  /**
   * §3c (second half) — "Activating another tab moves the selection and
   * swaps the description/params below it." §3d's description text is not
   * itself contractual, only its presence/position/data-testid — this test
   * only asserts the selection moves and the description element changes,
   * not any particular wording.
   */
  test('activating another tab moves the tablist selection', async ({ page }) => {
    const descriptionBefore = await page.getByTestId('reports-description').textContent()

    await page.getByTestId('reports-tab-issue-activity').click()

    await expect(page.getByTestId('reports-tab-issue-activity')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.getByTestId('reports-tab-drive-queue-status')).toHaveAttribute(
      'aria-selected',
      'false',
    )
    await expect(page.getByTestId('reports-description')).not.toHaveText(descriptionBefore ?? '')
  })

  /**
   * §3d — a one-line description paragraph, `data-testid`
   * `reports-description`, directly under the tablist (DOM order, not pixel
   * position — §3d only pins "directly under").
   */
  test('a description paragraph sits directly under the tablist', async ({ page }) => {
    const description = page.getByTestId('reports-description')
    await expect(description).toBeVisible()
    const text = await description.textContent()
    expect((text ?? '').trim().length).toBeGreaterThan(0)

    // "directly under" the tablist, in DOM order.
    const order = await page.evaluate(() => {
      const tablist = document.querySelector('[data-testid="reports-tablist"]')
      const desc = document.querySelector('[data-testid="reports-description"]')
      if (!tablist || !desc) return null
      return !!(tablist.compareDocumentPosition(desc) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(order).toBe(true)
  })

  /**
   * §4a/§4b/§4c — the parameter bar: accessible name `Report parameters`,
   * `data-testid` `reports-param-bar`; a `choice`-kind param (`Repo`) renders
   * as a `<select>`, a `text`-kind param (`Search`) renders as a text
   * `<input>`; a submit button reading exactly `Run report`.
   *
   * The exact parameter SET is not pinned by any ms-2 issue body (§4b) — this
   * fixture's catalogue (see fixtures/reports-ms2.json) deliberately gives
   * drive-queue-status one of each kind so both branches of the dispatch
   * rule are exercised, mirroring mocks/reports-picker.html's own shape.
   */
  test('parameter bar renders a choice param as a select and a text param as an input', async ({
    page,
  }) => {
    const bar = page.getByTestId('reports-param-bar')
    await expect(bar).toBeVisible()
    await expect(bar).toHaveAttribute('aria-label', 'Report parameters')

    const repoField = page.getByTestId('reports-param-repo')
    await expect(repoField).toBeVisible()
    expect(await repoField.evaluate((el) => el.tagName)).toBe('SELECT')
    // The seeded choices are "", "api", "coord-web" (fixtures/reports-ms2.json).
    await expect(repoField.locator('option[value="api"]')).toHaveCount(1)
    await expect(repoField.locator('option[value="coord-web"]')).toHaveCount(1)

    const searchField = page.getByTestId('reports-param-search')
    await expect(searchField).toBeVisible()
    expect(await searchField.evaluate((el) => el.tagName)).toBe('INPUT')
    await expect(searchField).not.toHaveAttribute('type', 'select')

    const runButton = page.getByTestId('reports-run-button')
    await expect(runButton).toHaveText('Run report')
  })

  /**
   * §2b — before any report has run this session, no count element renders
   * next to the `h1`. Also pins the `h1` text itself (§2a) and the
   * pre-run empty state the mock shows (`reports-picker.html`,
   * `data-testid="reports-empty-state"`) — the mock is part of the contract
   * per this suite's own authoring instructions, even though contract.md's
   * prose doesn't separately name this testid.
   */
  test('cold load shows the Reports header with no count and an empty-state placeholder', async ({
    page,
  }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Reports', exact: true })).toBeVisible()
    await expect(page.getByTestId('reports-header-count')).toHaveCount(0)

    const empty = page.getByTestId('reports-empty-state')
    await expect(empty).toBeVisible()
    await expect(empty).toHaveText('Run a report to see results.')
  })

  /**
   * §2c — after a report has run, a mono count element reads `N rows`
   * (`reports-header-count`) where N is the number of rendered rows — `3
   * rows` for this fixture's three seeded drive-queue-status rows.
   */
  test('running drive-queue-status shows a header count of 3 rows', async ({ page }) => {
    await runDriveQueueStatus(page)
    await expect(page.getByTestId('reports-header-count')).toHaveText('3 rows')
  })

  /**
   * §6a — the grid is a table, `data-testid` `reports-grid`, with one `<th>`
   * per `ColumnMeta` column (eight, per the seeded drive-queue-status
   * result) and one row per result (three).
   */
  test('grid renders one header per column and one row per result', async ({ page }) => {
    await runDriveQueueStatus(page)
    const grid = reportsGrid(page)
    await expect(grid.locator('th')).toHaveCount(8)
    await expect(grid.locator('tbody tr')).toHaveCount(3)
  })

  /**
   * §6b — column-kind -> cell rendering, port of `reports_cell_text`. This
   * fixture's drive-queue-status result exercises six of the seven pinned
   * kinds (money is `completed`-only, out of this slice's scope):
   *   text      -> plain text, left-aligned            (Issue, Title)
   *   int       -> mono, right-aligned                 (#, Tries)
   *   enum      -> a status "pill" (text content only  (State)
   *                asserted here — visual convention is out of scope)
   *   timestamp -> `YYYY-MM-DD HH:MM`, mono             (Updated)
   *   duration  -> compact human string, mono           (Age)
   *   list      -> comma-joined, em-dash when empty     (After)
   *
   * TODO(test-author): §6b pins the timestamp FORMAT (`YYYY-MM-DD HH:MM`)
   * but not a timezone-conversion rule, and this suite has no way to force
   * the browser process's local timezone from inside
   * tests/acceptance/ms-NN/** (playwright.acceptance.config.ts is outside a
   * test-author's writable surface). So the `updated` cells below are
   * asserted by FORMAT SHAPE (regex) only, never an exact clock reading.
   * Duration is elapsed time, not a wall-clock conversion, so it has no such
   * ambiguity and is asserted exactly.
   */
  test('grid formats each row correctly per its ColumnMeta.kind', async ({ page }) => {
    await runDriveQueueStatus(page)
    const rows = reportsGrid(page).locator('tbody tr')

    const row1 = rows.nth(0)
    await expect(row1).toContainText('1') // position (int)
    await expect(row1).toContainText('api#42') // issue (text)
    await expect(row1).toContainText('Fix the dashboard rendering') // title (text)
    await expect(row1).toContainText('running') // state (enum)
    await expect(row1).toContainText('3h 12m') // age (duration): 11520s
    await expect(row1).toContainText(/\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/) // updated (timestamp shape)
    await expect(row1).toContainText('—') // after (list, empty -> em dash)

    const row2 = rows.nth(1)
    await expect(row2).toContainText('api#40')
    await expect(row2).toContainText('blocked')
    await expect(row2).toContainText('1d 4h') // age (duration): 100800s

    const row3 = rows.nth(2)
    await expect(row3).toContainText('coord-web#9')
    await expect(row3).toContainText('waiting')
    await expect(row3).toContainText('api#42, api#40') // after (list, comma-joined)
  })

  /**
   * §7c/§7.1 — drive-queue-status declares NO `row_identity` (it is
   * conspicuously absent from #23's row_identity list, per contract §7.1 —
   * flagged there as possibly-an-oversight, but this contract renders the
   * literal, stated behaviour). Its Issue column therefore renders as plain
   * text: no `<a>`/Link, unlike `issue-activity`'s equivalent column
   * (`reports-row-nav.html`, #23's own slice — not tested here).
   */
  test('drive-queue-status Issue column has no row-nav link', async ({ page }) => {
    await runDriveQueueStatus(page)
    const grid = reportsGrid(page)
    const issueCell = grid.locator('tbody tr').nth(0).locator('td', { hasText: 'api#42' })
    await expect(issueCell).toBeVisible()
    await expect(issueCell.locator('a')).toHaveCount(0)
  })

  /**
   * §6c — clicking a sortable column header toggles client-side ascending/
   * descending sort; the sorted header carries `aria-sort` and a visible
   * glyph suffix. `reports-grid.html` pins the DEFAULT state (cold run) as
   * `#`/position ascending with `▲` — this test checks that baseline, then
   * exercises the click-to-toggle rule contract §6c states in prose.
   */
  test('the # column is sorted ascending by default, and clicking toggles the sort', async ({
    page,
  }) => {
    await runDriveQueueStatus(page)
    const positionHeader = page.getByTestId('reports-col-position')

    await expect(positionHeader).toHaveAttribute('aria-sort', 'ascending')
    await expect(positionHeader).toContainText('▲')

    // Baseline row order: position 1, 2, 3 (issue column as a stand-in key).
    const issueCells = reportsGrid(page).locator('tbody tr td:nth-child(2)')
    await expect(issueCells).toHaveText(['api#42', 'api#40', 'coord-web#9'])

    await positionHeader.click()

    await expect(positionHeader).toHaveAttribute('aria-sort', 'descending')
    await expect(positionHeader).toContainText('▼')
    await expect(issueCells).toHaveText(['coord-web#9', 'api#40', 'api#42'])
  })
})
