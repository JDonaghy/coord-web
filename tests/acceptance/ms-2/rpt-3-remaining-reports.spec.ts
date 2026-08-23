/**
 * ms-2 sealed acceptance slice — RPT-3 (#22): light up the remaining five
 * catalogue reports (issue-activity, completed, decisions, usage,
 * queue-outcomes) on top of RPT-2's (#21) picker/grid shell.
 *
 * Contract: tests/acceptance/ms-2/contract.md
 * Mocks:    tests/acceptance/ms-2/mocks/reports-row-nav.html  (issue-activity)
 *           tests/acceptance/ms-2/mocks/reports-completed.html (completed)
 *           tests/acceptance/ms-2/mocks/reports-decisions.html (decisions)
 *           (no mock exists for `usage` — see contract §0's inventory table
 *           and the TODO below; `queue-outcomes`' own mocks,
 *           reports-chart.html / reports-chart-degraded.html, are RPT-6's
 *           (#25) chart-rendering slice — this file only proves
 *           queue-outcomes' GRID, not its chart.)
 *
 * Authored by an INDEPENDENT test-author session from the contract + mocks
 * alone. Per #22's own framing ("near-zero new rendering code — the real
 * work is verifying decisions' options column... renders sanely instead of
 * falling through to raw JSON"), this slice's job is:
 *   1. Prove the five reports are genuinely wired into the picker + the
 *      SAME generic grid #21 already built (no per-report bespoke markup) —
 *      i.e. RPT-2's abstraction hasn't leaked.
 *   2. Deeply verify the one NEW column kind #21 never exercised:
 *      `money` (completed's `Total $`, including the zero -> em-dash rule).
 *   3. Deeply verify decisions' `options` column — #22's specifically named
 *      risk — renders each option's `label` + a recommended-star affordance
 *      + `command_or_action` in `title` only, and NEVER raw JSON.
 *
 * Explicitly OUT of this slice (left for their own issues' test-authors):
 *   - Export CSV (§5) — RPT-5, #24.
 *   - row_identity `<Link>`/open-in-new-tab affordance on the identifying
 *     column of issue-activity/completed/decisions (§7) — RPT-4, #23. #23
 *     "depends on #22", i.e. lands strictly after this slice, so this file
 *     deliberately asserts NOTHING about whether that cell is a `<Link>` or
 *     plain text — see fixtures/reports-ms2.json's own header comment for
 *     why the fixture's `issue` column is shaped to stay agnostic to this.
 *   - Chart rendering / Degrade fallback on queue-outcomes (§8) — RPT-6,
 *     #25. #25 "depends on #22" too; this file's queue-outcomes fixture row
 *     ships `chart: null` so no chart region is expected here either way.
 *
 * Seeding (#1818): tests/acceptance/ms-2/fixtures/reports-ms2.json (shared
 * across the whole ms-2 milestone), extended by this slice with
 * `report_results` for all five reports plus a `since`/"Time range" param
 * on issue-activity/completed's catalogue entries (matching
 * reports-row-nav.html / reports-completed.html). See that file's own
 * header comment for the full rationale, especially why the identifying
 * column across issue-activity/completed/decisions is a single `text`-kind
 * `"api#42"`-shaped string rather than split repo/issue columns.
 *
 * Run (the declared web-playwright driver command):
 *   npm run test:acceptance -- ms-2
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

// ── Locator helpers ──────────────────────────────────────────────────────────

function reportsGrid(page: Page): Locator {
  return page.getByTestId('reports-grid')
}

async function runReport(page: Page, tabKey: string): Promise<void> {
  await page.getByTestId(`reports-tab-${tabKey}`).click()
  await expect(page.getByTestId(`reports-tab-${tabKey}`)).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('reports-run-button').click()
  await expect(reportsGrid(page)).toBeVisible()
}

test.describe('ms-2 Reports panel — RPT-3 remaining reports (#22)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports')
  })

  /**
   * §3b/§4a-c (extended to the five new catalogue entries) — each of the
   * five reports #22 lights up is genuinely selectable and runnable: the
   * tab takes selection, `Run report` produces a grid, and the resulting
   * header count / column count match this slice's seeded fixture data.
   * This is the "same grid, new catalogue entry" claim #22's own issue body
   * makes — proven per-report rather than assumed from one example.
   *
   * `usage` has no contract mock (contract.md §0's inventory table lists
   * mocks for the other four but not `usage`), so this only proves it is
   * wired into the same generic grid, not any specific shape.
   * TODO(test-author): if a future contract amendment adds a `usage` mock,
   * tighten this case to match it the way the other four already do.
   */
  for (const [key, expectedCount, expectedColumns] of [
    ['issue-activity', '3 rows', ['Issue', 'Activity', 'Actor', 'Timestamp']],
    ['completed', '3 rows', ['Issue', 'Title', 'Started', 'Ended', 'Legs', 'Tok In', 'Tok Out', 'Total $']],
    ['decisions', '2 rows', ['Issue', 'Decision', 'Options', 'Timestamp']],
    ['usage', '2 rows', ['Repo', 'Legs', 'Tok In', 'Tok Out', 'Total $']],
    ['queue-outcomes', '4 rows', ['Outcome', 'Count', 'Share']],
  ] as const) {
    test(`running ${key} shows a header count of ${expectedCount} and the expected columns`, async ({
      page,
    }) => {
      await runReport(page, key)
      await expect(page.getByTestId('reports-header-count')).toHaveText(expectedCount)

      const grid = reportsGrid(page)
      await expect(grid.locator('th')).toHaveCount(expectedColumns.length)
      const headerTexts = await grid.locator('th').allTextContents()
      // Header cells may append a sort glyph (▲/▼) to whichever column is
      // currently sorted (§6c) — strip any trailing glyph before comparing
      // so this test doesn't accidentally pin which column sorts by
      // default for a report §6c never specifies one for.
      const normalized = headerTexts.map((t) => t.replace(/[▲▼]\s*$/, '').trim())
      expect(normalized).toEqual([...expectedColumns])
    })
  }

  /**
   * §6b (`money` kind) — `completed`'s `Total $` column: `$X.XXXX` (four
   * decimals), right-aligned mono, and a literal zero cost renders as a
   * plain em-dash (`—`), never `$0.0000` or a blank cell. Pinned in
   * `reports-completed.html`'s own third row. This is the one ColumnMeta
   * kind #21's own slice never exercised (only `completed` has a money
   * column), so #22 owns proving it end-to-end.
   */
  test("completed's money column renders $X.XXXX and a zero total as an em-dash", async ({ page }) => {
    await runReport(page, 'completed')
    const rows = reportsGrid(page).locator('tbody tr')

    await expect(rows.nth(0)).toContainText('$4.8210')
    await expect(rows.nth(1)).toContainText('$0.9310')

    // Third seeded row has cost_total: 0.0 -> em-dash, never "$0.0000".
    const lastRowText = await rows.nth(2).textContent()
    expect(lastRowText).toContain('—')
    expect(lastRowText).not.toContain('$0.0000')
    expect(lastRowText).not.toContain('$0')
  })

  /**
   * §6d — the decisions `options` column, #22's specifically named risk:
   * each cell is a list of `{label, command_or_action, recommended}`
   * dicts, and must never fall through to raw JSON / a stringified dict.
   * Pinned in `reports-decisions.html`:
   *   - visible text is the option's `label`;
   *   - `recommended: true` adds a trailing ★ glyph PLUS a visually-hidden
   *     `(recommended)` suffix (an `.sr-only` span);
   *   - `command_or_action` lives in the native `title` attribute only,
   *     never printed inline;
   *   - a non-recommended option gets neither the glyph nor the sr-only
   *     span.
   *
   * NOTE on cell lookup: `ReportsPanel.tsx` (already shipped by #21)
   * unconditionally applies an ascending sort on the FIRST `column_meta`
   * column (here, `issue`, `kind: text`) immediately after every `Run` —
   * so the DOM row order is NOT this fixture's declared array order.
   * `"api#33".localeCompare("api#40")` sorts `api#33` first, meaning
   * whichever of `reports-options-cell-1` / `-2` ends up first in the DOM
   * depends on that sort, not on which row this fixture happened to list
   * first. Rather than hardcode a cell-N -> row mapping (fragile, and wrong
   * once sorted), each row is located by its own stable `decision` text and
   * the options cell is read out of THAT row — this assertion holds
   * regardless of sort order.
   */
  test('decisions options column renders label + recommended star + sr-only text, command in title only', async ({
    page,
  }) => {
    await runReport(page, 'decisions')

    async function optionsCellForRow(rowText: string): Promise<Locator> {
      const row = reportsGrid(page).locator('tbody tr').filter({ hasText: rowText })
      await expect(row).toHaveCount(1)
      const cell = row.locator('[data-testid^="reports-options-cell-"]')
      await expect(cell).toHaveCount(1)
      return cell
    }

    // api#40's row: two options seeded, "Release gate" (recommended) and
    // "Extend hold" (not recommended).
    const gateCell = await optionsCellForRow('Gate fired, awaiting release')
    await expect(gateCell).toBeVisible()

    const options = gateCell.locator('li, [role="listitem"]')
    await expect(options).toHaveCount(2)

    const recommendedOption = options.filter({ hasText: 'Release gate' })
    await expect(recommendedOption).toHaveCount(1)
    await expect(recommendedOption).toContainText('★')
    // The sr-only "(recommended)" suffix must exist in the DOM for a
    // screen reader even though it may be visually clipped.
    await expect(recommendedOption.getByText('(recommended)')).toHaveCount(1)
    await expect(recommendedOption).toHaveAttribute('title', 'coord drive release --issue 40')

    const plainOption = options.filter({ hasText: 'Extend hold' })
    await expect(plainOption).toHaveCount(1)
    await expect(plainOption).not.toContainText('★')
    await expect(plainOption.getByText('(recommended)')).toHaveCount(0)
    await expect(plainOption).toHaveAttribute('title', 'coord drive hold --issue 40 --extend 1h')

    // api#33's row (three options, one recommended) — same shape, different
    // cardinality, to guard against a hard-coded "exactly two options"
    // assumption leaking into the rendering.
    const smokeCell = await optionsCellForRow('Repeated smoke failure')
    const smokeOptions = smokeCell.locator('li, [role="listitem"]')
    await expect(smokeOptions).toHaveCount(3)
    await expect(smokeOptions.filter({ hasText: 'Retry' })).toContainText('★')
    await expect(smokeOptions.filter({ hasText: 'Skip' })).not.toContainText('★')
    await expect(smokeOptions.filter({ hasText: 'Unblock manually' })).not.toContainText('★')

    // §6d's explicit negative assertion: no raw JSON / stringified dict in
    // either options cell, under any circumstances.
    for (const cell of [gateCell, smokeCell]) {
      const text = (await cell.textContent()) ?? ''
      expect(text).not.toMatch(/[{}[\]]/)
      expect(text).not.toContain('command_or_action')
      expect(text).not.toContain('"label"')
    }
  })

  /**
   * §4b — issue-activity's and completed's `since`/"Time range" choice
   * param, added on the contract's own 2026-08-20 amendment
   * (`reports-row-nav.html`, `reports-completed.html`): a `choice`-kind
   * param renders as a `<select>` here too, exercising the same dispatch
   * rule #21 already proved for drive-queue-status but now on a report
   * #22 itself lights up (RPT-2's abstraction shouldn't need a second
   * implementation of that rule).
   */
  test('issue-activity exposes a Time range select alongside Repo', async ({ page }) => {
    await page.getByTestId('reports-tab-issue-activity').click()
    const sinceField = page.getByTestId('reports-param-since')
    await expect(sinceField).toBeVisible()
    expect(await sinceField.evaluate((el) => el.tagName)).toBe('SELECT')
    await expect(sinceField.locator('option[value="24h"]')).toHaveCount(1)
    await expect(sinceField.locator('option[value="7d"]')).toHaveCount(1)
  })
})
