/**
 * ms-2 sealed acceptance slice — RPT-4 (#23): row navigation via
 * `row_identity` on the three catalogue reports that declare it
 * (`issue-activity`, `completed`, `decisions`, per contract.md §7a — #23's
 * own literal list). Depends on #22 (RPT-3), which is what first lights up
 * these three reports in this suite's shared fixture.
 *
 * Contract: tests/acceptance/ms-2/contract.md §7
 * Mocks:    tests/acceptance/ms-2/mocks/reports-row-nav.html  (issue-activity)
 *           tests/acceptance/ms-2/mocks/reports-completed.html (completed)
 *           tests/acceptance/ms-2/mocks/reports-decisions.html (decisions)
 *           tests/acceptance/ms-2/mocks/reports-grid.html (drive-queue-status
 *           — the non-row_identity control case, §7c/§7.1)
 *
 * Authored by an INDEPENDENT test-author session from the contract + mocks
 * alone, per #23's own citation: "same pattern + open-in-new-tab affordance
 * DriveQueuePanel's Issue column already uses (#9)" — this slice models its
 * locators after that ALREADY-SHIPPED pattern (src/components/
 * DriveQueuePanel.tsx: a react-router `<Link>` to `paths.pipelineItem(repo,
 * issue)` plus a sibling `<a target="_blank" aria-label="Open <key> in a new
 * tab" title="Open in new tab">`) rather than the mock's own CSS class names
 * (`.primary-link`/`.ext-link`), which are the static-HTML mock's own
 * placeholder styling — §7b's own text pins the *structure* (a link plus a
 * secondary open-in-new-tab affordance with that exact aria-label/title
 * shape), not a CSS class, and "Not in scope" explicitly excludes anything
 * visual beyond what §8 separately pins for charts.
 *
 * Href assertions use a small local `pipelineItemHref` helper that
 * reproduces `paths.pipelineItem`'s own documented behaviour
 * (`src/routes/paths.ts`: ``/pipeline/${encodeURIComponent(repo)}/
 * ${encodeURIComponent(String(issue))}``) rather than importing the app
 * module directly — no other slice in this sealed suite imports `@/...`
 * into a spec file (Playwright's own tsconfig-paths wiring for this run
 * config is unproven), and the two-segment shape is simple enough to
 * reproduce exactly without that risk.
 *
 * Seeding (#1818): tests/acceptance/ms-2/fixtures/reports-ms2.json, extended
 * by this slice with a `repo` field on every issue-activity/completed/
 * decisions row (previously `row_identity: {repo_column: "repo", ...}`
 * pointed at a column that didn't exist at all — #22's own fixture comment
 * flagged this as deliberately left for this slice to resolve). For
 * issue-activity/decisions the `issue` field itself was also cleaned up
 * from a combined `"api#42"`-shaped string to a bare `"42"`, producing a
 * clean `/pipeline/api/42`-shaped href exactly matching reports-row-nav.
 * html's/reports-decisions.html's own pins — safe because no #21/#22
 * assertion reads that cell's content. `completed`'s `issue` value is
 * DELIBERATELY left as the original combined string (`"api#51"`) because
 * #22's own money-column test depends on that exact column's default
 * ascending-sort order (`rows.nth(0)`/`nth(1)`/`nth(2)`); this slice's own
 * `completed` test computes its expected href from that same unchanged
 * value rather than asserting a "clean" number it cannot actually produce
 * without regressing #22 — see the fixture's own header comment for the
 * full reasoning.
 *
 * Explicitly OUT of this slice (left for other issues' test-authors):
 *   - Everything about picker/grid/params/export/chart rendering — RPT-2/3/
 *     5/6 (#21/#22/#24/#25), already covered by their own slices.
 *   - `usage`/`queue-outcomes` are not tested here for row_identity at all:
 *     contract §7a states neither declares it (aggregate reports with no
 *     single owning issue per row), and neither has an Issue-shaped column
 *     to begin with.
 *
 * Run (the declared web-playwright driver command):
 *   npm run test:acceptance -- ms-2
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

// ── Locator / href helpers ───────────────────────────────────────────────────

/** Reproduces `paths.pipelineItem(repo, issue)` (src/routes/paths.ts) —
 * `/pipeline/<repo>/<issue>`, each segment `encodeURIComponent`-ed. */
function pipelineItemHref(repo: string, issue: string | number): string {
  return `/pipeline/${encodeURIComponent(repo)}/${encodeURIComponent(String(issue))}`
}

function reportsGrid(page: Page): Locator {
  return page.getByTestId('reports-grid')
}

async function runReport(page: Page, tabKey: string): Promise<void> {
  await page.getByTestId(`reports-tab-${tabKey}`).click()
  await expect(page.getByTestId(`reports-tab-${tabKey}`)).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('reports-run-button').click()
  await expect(reportsGrid(page)).toBeVisible()
}

/** Finds the one grid row containing `stableText` (a column OTHER than the
 * identifying cell — e.g. `activity`/`title`/`decision` — so this helper is
 * agnostic to whatever order the grid's default sort puts rows in). */
async function rowContaining(page: Page, stableText: string): Promise<Locator> {
  const row = reportsGrid(page).locator('tbody tr').filter({ hasText: stableText })
  await expect(row).toHaveCount(1)
  return row
}

/**
 * §7b — asserts a row's identifying cell is a real navigable Link plus the
 * DriveQueuePanel-pattern open-in-new-tab affordance: exactly two `<a>`
 * elements, the first carrying the mono issue key as its text and `href`
 * pointing at `paths.pipelineItem(repo, issue)`, the second `target="_blank"`
 * with `aria-label="Open <key> in a new tab"` and `title="Open in new tab"`,
 * same href as the first.
 */
async function expectIdentityLink(row: Locator, key: string, href: string): Promise<void> {
  const links = row.locator('a')
  await expect(links).toHaveCount(2)

  const primary = links.nth(0)
  await expect(primary).toHaveText(key)
  await expect(primary).toHaveAttribute('href', href)

  const secondary = links.nth(1)
  await expect(secondary).toHaveAttribute('target', '_blank')
  await expect(secondary).toHaveAttribute('href', href)
  await expect(secondary).toHaveAttribute('aria-label', `Open ${key} in a new tab`)
  await expect(secondary).toHaveAttribute('title', 'Open in new tab')
}

/** §7c — the non-identity control shape: the cell holding `key` is plain
 * text, no `<a>` anywhere in that row. */
async function expectNoIdentityLink(row: Locator, key: string): Promise<void> {
  await expect(row).toContainText(key)
  await expect(row.locator('a')).toHaveCount(0)
}

test.describe('ms-2 Reports panel — RPT-4 row navigation via row_identity (#23)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports')
  })

  /**
   * §7a/§7b — `issue-activity` declares row_identity; every row's Issue
   * cell becomes a Link + open-in-new-tab affordance to
   * `paths.pipelineItem(repo, issue)`. Checked for all three seeded rows,
   * not just one, to guard against an implementation that only special-
   * cases the first grid row (e.g. by hardcoding index 0 rather than
   * genuinely reading `row_identity` per row).
   */
  test('issue-activity: every row Issue cell is a Link + open-in-new-tab affordance', async ({
    page,
  }) => {
    await runReport(page, 'issue-activity')

    for (const [stableText, repo, issue] of [
      ['review requested', 'api', '42'],
      ['gate fired', 'api', '40'],
      ['merged', 'coord-web', '9'],
    ] as const) {
      const row = await rowContaining(page, stableText)
      await expectIdentityLink(row, `${repo}#${issue}`, pipelineItemHref(repo, issue))
    }
  })

  /**
   * §7a/§7b — `decisions` also declares row_identity (contract §0/§7a; note
   * this is a fixture override — §7.8 flags that the real `coord/
   * reports.py` doesn't declare it there today). Located by the stable
   * `decision` column text, same robust-to-sort-order pattern #22's own
   * options-column test already established for this report.
   */
  test('decisions: every row Issue cell is a Link + open-in-new-tab affordance', async ({
    page,
  }) => {
    await runReport(page, 'decisions')

    for (const [stableText, repo, issue] of [
      ['Gate fired, awaiting release', 'api', '40'],
      ['Repeated smoke failure', 'api', '33'],
    ] as const) {
      const row = await rowContaining(page, stableText)
      await expectIdentityLink(row, `${repo}#${issue}`, pipelineItemHref(repo, issue))
    }
  })

  /**
   * §7a/§7b — `completed` declares row_identity too, and is the report
   * that also exercises the `money`-kind `Total $` column (#22's own
   * scope) — this test only concerns the identity cell, on all three
   * seeded rows including the zero-cost one, to confirm row_identity and
   * the money-kind em-dash rule coexist on the same row without either
   * breaking the other.
   *
   * The expected href here is deliberately NOT the "clean"
   * `/pipeline/<repo>/<bare-issue>` shape the other two reports get — see
   * this file's own header comment and fixtures/reports-ms2.json's: this
   * report's `issue` column value is pinned to the unchanged, combined
   * `"api#51"`-shaped string (#22's default-sort dependency), so a
   * spec-compliant `paths.pipelineItem(row.repo, row.issue)` call
   * necessarily embeds that whole string as the URL's issue segment.
   */
  test('completed: every row Issue cell is a Link + open-in-new-tab affordance', async ({
    page,
  }) => {
    await runReport(page, 'completed')

    for (const [stableText, repo, issue] of [
      ['Emergency revert --bare back to --setting-sources user', 'api', 'api#51'],
      ['Web pipeline card shows a stale failed badge', 'coord-web', 'coord-web#19'],
      ['Issue hyperlink e2e exit gate', 'coord-web', 'coord-web#9'],
    ] as const) {
      const row = await rowContaining(page, stableText)
      await expectIdentityLink(row, issue, pipelineItemHref(repo, issue))
    }
  })

  /**
   * §7c/§7.1 — the control case: `drive-queue-status` does NOT declare
   * row_identity (contract §7a/§7.1 flags this omission as possibly an
   * oversight, but pins the literal stated behaviour), so its Issue column
   * stays plain text — no `<a>` at all. #21's own slice
   * (rpt-2-drive-queue-status.spec.ts) already covers this; repeated here,
   * scoped to #23's own manifest, because §7c is this issue's contract
   * clause to own, not #21's.
   */
  test('drive-queue-status (no row_identity): Issue column has no Link', async ({ page }) => {
    await runReport(page, 'drive-queue-status')
    const row = await rowContaining(page, 'Fix the dashboard rendering')
    await expectNoIdentityLink(row, 'api#42')
  })
})
