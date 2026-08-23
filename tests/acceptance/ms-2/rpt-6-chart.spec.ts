/**
 * ms-2 sealed acceptance slice — RPT-6 (#25): chart rendering for
 * chart-declaring reports, `ChartPlan`'s three-outcome contract
 * (None/Render/Degrade) ported from `tui/src/app/reports.rs`.
 *
 * Contract: tests/acceptance/ms-2/contract.md §8 (§8a-§8e).
 * Mocks:    tests/acceptance/ms-2/mocks/reports-chart.html          (Render)
 *           tests/acceptance/ms-2/mocks/reports-chart-degraded.html (Degrade)
 *           (the third outcome, None, is exactly what reports-grid.html /
 *           reports-row-nav.html / reports-decisions.html already show — no
 *           chart region at all — contract.md §0/§8e.)
 *
 * Authored by an INDEPENDENT test-author session from the contract + mocks
 * alone, with one exception explained below: `tui/src/app/reports.rs`
 * (specifically `reports_chart_plan`) is read directly, because #25's own
 * issue text names that file, verbatim, as the thing to port ("Port
 * `ChartPlan`'s three-outcome contract ... from tui/src/app/reports.rs") —
 * it is reference material the port targets, not the coord-web worker's own
 * implementation of this issue (which does not exist yet — confirmed by
 * grep: no `chart`/`Chart` reference anywhere in
 * src/components/ReportsPanel.tsx beyond its own "out of scope, #25" note,
 * and no charting library in package.json).
 *
 * Seeding (#1818): tests/acceptance/ms-2/fixtures/reports-ms2.json (shared
 * across the whole ms-2 milestone), extended by this slice with a `chart`
 * key on two existing `report_results` entries. `FixtureServer.report_result`
 * (coord/dashboard/fixture.py) keys purely off `report_id`, ignoring
 * whatever params a client actually sent — so a single report can only ever
 * demonstrate ONE of Render/Degrade in this shared fixture, never both
 * simultaneously. That forces a choice of which report demonstrates which
 * outcome:
 *
 *   - `queue-outcomes` gets the RENDER chart — it is the one report both
 *     contract mocks (reports-chart.html / reports-chart-degraded.html)
 *     illustrate, so giving it the Render shape (`kind: 'bar'`, one series
 *     reading the `count` column, `x: 'outcome'`) matches
 *     mocks/reports-chart.html byte-for-byte against rows #22 already
 *     seeded (completed 128 / held 9 / blocked 4 / abandoned 2).
 *   - `usage` gets the DEGRADE chart. It has no contract mock and no
 *     chart-related assertion anywhere in #21-#24's already-merged slices
 *     (#22's own test for it only checks header count / column labels,
 *     untouched by adding a `chart` key), so it was free to repurpose here.
 *     Its trigger is `kind: "scatter"` — deliberately NOT the degraded
 *     mock's own illustrative reason text ("fewer than two non-zero
 *     outcomes": contract §8d's own mock-header comment explicitly
 *     disclaims that wording as non-contractual, pinning only the
 *     STRUCTURE) but a condition read directly out of
 *     `reports_chart_plan`'s "open-vocabulary fallback, same rule as
 *     ColumnMeta.kind" branch: a chart `kind` this build doesn't recognise
 *     (only `"bar"`/`"line"`/`"sparkline"` are understood) degrades
 *     unconditionally — independent of row count, series count, or the
 *     quadraui#584 multi-series-bar feature flag this repo has no
 *     equivalent of. That makes it the one Degrade branch robust enough to
 *     assert against without assuming how a not-yet-chosen charting library
 *     would count "non-zero categories" for itself.
 *
 * TODO(test-author): contract.md doesn't pin an exact chart-mark DOM shape
 * (§7.7/"Not in scope": "exact chart geometry" is explicitly out of scope,
 * since RPT-6 defers the charting-library choice to itself) — so §8b's
 * "same status colours the grid's own badges already use" is verified
 * dynamically (reading each badge's own live computed colour off the grid
 * and checking it re-appears somewhere in the chart region), never by
 * hardcoding a hex value or a per-bar `data-testid` the contract never pins.
 *
 * Run (the declared web-playwright driver command):
 *   npm run test:acceptance -- ms-2
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

// ── Locator / helper functions ──────────────────────────────────────────────

function reportsGrid(page: Page): Locator {
  return page.getByTestId('reports-grid')
}

async function runReport(page: Page, tabKey: string): Promise<void> {
  await page.getByTestId(`reports-tab-${tabKey}`).click()
  await expect(page.getByTestId(`reports-tab-${tabKey}`)).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('reports-run-button').click()
  await expect(reportsGrid(page)).toBeVisible()
}

/**
 * Every meaningful colour (`color`, `backgroundColor`, `fill`, `stroke`)
 * used anywhere within `locator`'s own subtree, as browser-resolved
 * computed values (so a Tailwind class, a CSS custom property, or a literal
 * inline style all normalize the same way). Fully-transparent/`none` values
 * are dropped — they carry no semantic colour and would otherwise pollute
 * every element's set with the same noise.
 */
async function subtreeColors(locator: Locator): Promise<Set<string>> {
  const colors: string[] = await locator.evaluate((root) => {
    const found: string[] = []
    const isMeaningless = (v: string | null | undefined) =>
      !v || v === 'none' || v === 'transparent' || v === 'rgba(0, 0, 0, 0)'
    const visit = (el: Element) => {
      const cs = getComputedStyle(el)
      for (const prop of ['color', 'backgroundColor', 'fill', 'stroke'] as const) {
        const v = (cs as unknown as Record<string, string>)[prop]
        if (!isMeaningless(v)) found.push(v)
      }
      for (const child of Array.from(el.children)) visit(child)
    }
    visit(root)
    return found
  })
  return new Set(colors)
}

test.describe('ms-2 Reports panel — RPT-6 chart rendering (#25)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports')
  })

  // ── §8a/§8c — Render outcome (queue-outcomes) ─────────────────────────────

  test('a chart-declaring report renders a chart region above the grid (§8a)', async ({ page }) => {
    await runReport(page, 'queue-outcomes')

    const chart = page.getByTestId('reports-chart')
    await expect(chart).toBeVisible()
    await expect(chart).toHaveAttribute('role', 'img')

    // Never in place of the grid, never below it.
    const grid = reportsGrid(page)
    await expect(grid).toBeVisible()
    const chartBox = await chart.boundingBox()
    const gridBox = await grid.boundingBox()
    expect(chartBox).not.toBeNull()
    expect(gridBox).not.toBeNull()
    expect(chartBox!.y).toBeLessThan(gridBox!.y)
  })

  test('the chart region carries a full-text aria-label summarizing every category and value (§8a)', async ({
    page,
  }) => {
    await runReport(page, 'queue-outcomes')

    const ariaLabel = (await page.getByTestId('reports-chart').getAttribute('aria-label')) ?? ''
    expect(ariaLabel.length).toBeGreaterThan(0)
    // One accessible summary standing in for a hand-drawn chart with no
    // native table semantics — every category name and its exact numeric
    // value must be present, case-insensitively (contract doesn't pin
    // capitalization), so a screen-reader user gets the whole picture from
    // this one string.
    for (const [category, value] of [
      ['completed', 128],
      ['held', 9],
      ['blocked', 4],
      ['abandoned', 2],
    ] as const) {
      const re = new RegExp(`${category}[^0-9]*${value}\\b`, 'i')
      expect(ariaLabel, `aria-label should mention ${category} ${value}: "${ariaLabel}"`).toMatch(re)
    }
  })

  test('every mark carries a direct, visible value label — never colour alone (§8c)', async ({ page }) => {
    await runReport(page, 'queue-outcomes')

    const chartText = (await page.getByTestId('reports-chart').textContent()) ?? ''
    for (const value of ['128', '9', '4', '2']) {
      expect(chartText, `chart region should visibly show the value ${value}`).toMatch(
        new RegExp(`\\b${value}\\b`),
      )
    }
  })

  test("each category's mark colour is reused from the grid's own status badge for the identical value, never a fresh hue (§8b)", async ({
    page,
  }) => {
    await runReport(page, 'queue-outcomes')

    const grid = reportsGrid(page)
    const chart = page.getByTestId('reports-chart')
    const chartColors = await subtreeColors(chart)
    expect(chartColors.size).toBeGreaterThan(0)

    for (const outcome of ['completed', 'held', 'blocked', 'abandoned']) {
      const row = grid.locator('tbody tr').filter({ hasText: outcome })
      await expect(row).toHaveCount(1)
      // The Outcome column is first (§8b pins these values to the SAME enum
      // badges §6b already renders for `State`/`Outcome` columns).
      const badgeCell = row.locator('td').first()
      const badgeColors = await subtreeColors(badgeCell)
      expect(badgeColors.size, `grid badge for "${outcome}" should resolve to at least one colour`).toBeGreaterThan(
        0,
      )

      const reused = [...badgeColors].some((c) => chartColors.has(c))
      expect(
        reused,
        `chart should reuse one of the grid's own "${outcome}" badge colours (${[...badgeColors].join(', ')}); chart colours were (${[...chartColors].join(', ')})`,
      ).toBe(true)
    }
  })

  // ── §8d — Degrade outcome (usage, unsupported chart kind) ────────────────

  test('an unrenderable chart degrades to a one-line reason, and the grid still renders in full — ChartPlan::Degrade (§8d)', async ({
    page,
  }) => {
    await runReport(page, 'usage')

    const degraded = page.getByTestId('reports-chart-degraded')
    await expect(degraded).toBeVisible()
    await expect(degraded).toHaveAttribute('role', 'status')

    const reason = degraded.getByTestId('reports-chart-degraded-reason')
    await expect(reason).toBeVisible()
    const reasonText = ((await reason.textContent()) ?? '').trim()
    expect(reasonText.length).toBeGreaterThan(0)
    // A "one-line reason" (§8d's own wording) — no embedded newline.
    expect(reasonText).not.toMatch(/\n/)

    // Never a half-drawn chart alongside the degrade notice.
    await expect(page.getByTestId('reports-chart')).toHaveCount(0)

    // The grid renders in full, completely unaffected — same shape #22's
    // own already-merged slice already pins for `usage` (2 rows, 5 columns:
    // Repo/Legs/Tok In/Tok Out/Total $), untouched by adding a `chart` key.
    const grid = reportsGrid(page)
    await expect(grid).toBeVisible()
    await expect(grid.locator('tbody tr')).toHaveCount(2)
    await expect(grid.locator('th')).toHaveCount(5)
  })

  // ── §8e — None outcome (control: no chart declared at all) ───────────────

  test('a report with no chart declaration renders neither a chart nor a degrade notice — ChartPlan::None (§8e)', async ({
    page,
  }) => {
    await runReport(page, 'drive-queue-status')

    await expect(page.getByTestId('reports-chart')).toHaveCount(0)
    await expect(page.getByTestId('reports-chart-degraded')).toHaveCount(0)
    await expect(reportsGrid(page)).toBeVisible()
  })
})
