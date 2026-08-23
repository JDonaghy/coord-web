/**
 * ms-2 sealed acceptance slice — RPT-5 (#24): CSV export for reports.
 *
 * Contract: tests/acceptance/ms-2/contract.md §5 (a/b/c).
 * Mocks:    tests/acceptance/ms-2/mocks/reports-picker.html (cold load — disabled)
 *           tests/acceptance/ms-2/mocks/reports-grid.html   (after Run report — enabled)
 *
 * Authored by an INDEPENDENT test-author session from the contract + the two
 * mocks above alone. Depends on #21 (RPT-2) per the milestone's own work
 * order — this slice reuses #21's already-seeded `drive-queue-status`
 * fixture entry (fixtures/reports-ms2.json) rather than adding a new one;
 * exactly one fixture file is allowed per ms-NN directory (#1818) and it is
 * already shared/extended by every prior ms-2 slice.
 *
 * Scope: ONLY #24's own black-box surface — the Export CSV control's
 * disabled-with-tooltip posture before any report has run this session
 * (§5a), its swap to a real `<a download>` navigation once a report has run
 * (§5b), and the "no client-side CSV generation" structural guarantee (§5c).
 * Explicitly OUT of this slice (left for their own issues' test-authors):
 *   - Everything else about the rail/picker/param-bar/grid — RPT-2, #21.
 *   - The five additional reports' own grid rendering — RPT-3, #22.
 *   - row_identity Links — RPT-4, #23.
 *   - Chart rendering / Degrade fallback — RPT-6, #25.
 *
 * TODO(test-author): contract.md §5a/§5b's prose says "before/after a report
 * has run this SESSION" (not "this report"), which reads like the enabled
 * state could be a session-wide flag that survives switching to a
 * not-yet-run tab, rather than being scoped to the currently-displayed
 * report. Neither mock shows that transition (each mock is a single static
 * screen) and no ms-2 issue body describes it either way, so this slice
 * deliberately does NOT assert what happens to Export CSV when switching
 * tabs after running one report but before running another — only the two
 * states each mock actually pins (cold load, and after running the
 * currently-selected report) are tested here.
 *
 * Run (the declared web-playwright driver command):
 *   npm run test:acceptance -- ms-2
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

function exportAction(page: Page): Locator {
  return page.getByTestId('reports-export-action')
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('ms-2 Reports panel — RPT-5 export CSV (#24)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports')
  })

  /**
   * §5a — before any report has run this session: a DISABLED control with
   * the exact accessible name `Export CSV`, `data-testid`
   * `reports-export-action`, and a `title`/tooltip explaining why. Pinned in
   * `reports-picker.html` (cold load, drive-queue-status selected but not
   * yet run).
   */
  test('Export CSV is disabled with an explanatory tooltip before any report has run', async ({
    page,
  }) => {
    const action = exportAction(page)
    await expect(action).toBeVisible()
    await expect(action).toBeDisabled()

    // Accessible name is "Export CSV" — via getByRole to prove it's exposed
    // to the accessibility tree, not just present as a data-testid.
    await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toHaveAttribute(
      'data-testid',
      'reports-export-action',
    )

    const title = await action.getAttribute('title')
    expect(title).toBeTruthy()
    expect((title ?? '').length).toBeGreaterThan(0)

    // §5a says "explaining why" — this contract's own wording is "Run a
    // report to enable CSV export", not pinned as the exact literal string
    // by #24 itself (only the disabled-with-tooltip posture is), but this
    // mock IS part of the contract per this suite's authoring instructions.
    expect(title).toBe('Run a report to enable CSV export')
  })

  /**
   * §5b — after a report has run this session: a real `<a>` element with
   * the `download` attribute, the SAME accessible name and `data-testid` as
   * the disabled control it replaces, whose `href` carries `format=csv` in
   * the query string. Pinned in `reports-grid.html` (after Run report on
   * drive-queue-status, the fixture's seeded three-row result — same
   * seeding #21's own slice already exercises end-to-end).
   */
  test('running a report swaps Export CSV to an enabled download link carrying format=csv', async ({
    page,
  }) => {
    await page.getByTestId('reports-run-button').click()
    await expect(page.getByTestId('reports-grid')).toBeVisible()

    const action = exportAction(page)
    await expect(action).toBeVisible()

    // Same data-testid, same accessible name, but now a link, not a button.
    expect(await action.evaluate((el) => el.tagName)).toBe('A')
    await expect(page.getByRole('link', { name: 'Export CSV', exact: true })).toHaveAttribute(
      'data-testid',
      'reports-export-action',
    )

    // No longer disabled.
    const disabledAttr = await action.getAttribute('disabled')
    expect(disabledAttr).toBeNull()

    const href = await action.getAttribute('href')
    expect(href).toBeTruthy()
    // §5b's ONE pinned wire detail: `format=csv` in the query string. The
    // base path itself (`/api/reports/<key>`) is this contract's own
    // inferred placeholder (§7.5), not confirmed against
    // code-coordinator#2492's real route, so this assertion deliberately
    // does not pin anything beyond the querystring parameter.
    const url = new URL(href!, 'http://localhost')
    expect(url.searchParams.get('format')).toBe('csv')
  })

  /**
   * §5c — no client-side CSV generation: the export is a navigation/
   * download of a server-rendered file, never a blob built in the browser.
   * Black-box proxy for that rule: the enabled control is a genuine `<a
   * download href="...">` pointing at a normal same-origin path, never a
   * `blob:`/`data:` URI (the tell-tale sign of a browser-side
   * `Blob`/`URL.createObjectURL` construction).
   */
  test('the enabled Export CSV link is a plain download href, never a client-built blob/data URI', async ({
    page,
  }) => {
    await page.getByTestId('reports-run-button').click()
    await expect(page.getByTestId('reports-grid')).toBeVisible()

    const action = exportAction(page)

    // `download` attribute present (empty value is fine — browser derives
    // the filename from the server's Content-Disposition header per #24's
    // own description; a NON-null getAttribute confirms presence either way).
    const downloadAttr = await action.getAttribute('download')
    expect(downloadAttr).not.toBeNull()

    const href = await action.getAttribute('href')
    expect(href).toBeTruthy()
    expect(href!.startsWith('blob:')).toBe(false)
    expect(href!.startsWith('data:')).toBe(false)
  })
})
