/**
 * E2E coverage for #65 (M-4) — the Machines panel's CPU/memory time-series
 * charts (`MachineCharts.tsx`), re-wired onto the real API by #76.
 *
 * #65 originally shipped five charts (CPU, memory, worktree footprint,
 * active workers, completed/failed throughput) against the pre-#76 invented
 * `/api/machines/{name}/metrics` route, which never existed on any coord
 * server. #76 found the real `GET /api/machines/metrics` reports a fixed
 * per-timestamp sample with only CPU/memory fields
 * (`MachineMetricsSample`, `src/api/generated.ts`) — the other three chart
 * sections had no real data source and are gone (`MachineCharts.tsx`'s own
 * doc comment); this file's coverage shrinks to match.
 *
 * The real Machines API is four fleet-*wide* routes (`/api/machines`,
 * `/api/machines/health`, `/api/machines/metrics`, `/api/machines/stats`) —
 * still not registered against a real fixture-server board in this repo's
 * e2e harness (`e2e/machines.spec.ts`'s "real coord web --fixture process"
 * describe block covers the one route that is, `/api/machines`), so this
 * file mocks all four via `page.route()` against the Vite dev server, same
 * posture `deep-link.spec.ts`/`theme.spec.ts`/`answers.spec.ts` take for
 * routes their own story added ahead of (or independent of) fixture-server
 * support.
 *
 * Runs at both breakpoints as distinct Playwright projects ('wide' /
 * 'narrow', see `playwright.config.ts`) — #65's issue text is explicit that
 * "these charts must be readable and touchable at ~390px, not merely
 * not-broken", so both is a named requirement here, not an afterthought.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

const NOW = Math.floor(Date.now() / 1000)

const MACHINE_STATE = {
  name: 'laptop',
  host: 'laptop.tailnet.ts.net',
  state: 'online',
  reason: '',
  latency_ms: 9,
  agent_version: '1.2.3',
  repos: ['coord-web'],
  worktree_bytes: 2_147_483_648, // exactly 2 GiB
}

async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  await page.route('**/api/board', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ round_number: 1, active: [], completed: [] }),
    }),
  )
  await page.route('**/api/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
}

function json(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockMachineApi(page: Page, samples: unknown[]): Promise<void> {
  await page.route('**/api/machines/metrics', (route) =>
    route.fulfill(json({ schema: 1, generated_at: NOW, since: null, resolution: null, machines: { laptop: samples } })),
  )
  await page.route('**/api/machines/health', (route) =>
    route.fulfill(
      json({
        schema: 1,
        refreshed_at: NOW,
        truncated: false,
        machine_health: [{ machine: 'laptop', state: 'online', reason: '', severity: 'ok', stale: false, checked_at: NOW - 30, results: [] }],
        fleet_checks: [],
      }),
    ),
  )
  await page.route('**/api/machines/stats', (route) =>
    route.fulfill(json([{ name: 'laptop', capacity: { active: 1, max: 4 }, counts: { completed: 5, failed: 1 }, job_history: [] }])),
  )
  await page.route('**/api/machines', (route) => route.fulfill(json([MACHINE_STATE])))
}

test.describe('Machine charts (#65, #76)', () => {
  test('renders real CPU/memory charts with a visible gap marker', async ({ page }) => {
    await mockShellApi(page)
    await mockMachineApi(page, [
      { timestamp: NOW - 900, status: 'ok', cpu_percent: 12, mem_percent: 61, mem_used_mb: 600, mem_total_mb: 1000, reason: '' },
      { timestamp: NOW - 600, status: 'ok', cpu_percent: 18, mem_percent: 63, mem_used_mb: 620, mem_total_mb: 1000, reason: '' },
      // An explicit failed/timed-out poll -- a gap on both series at once.
      { timestamp: NOW - 300, status: 'unknown', cpu_percent: null, mem_percent: null, mem_used_mb: null, mem_total_mb: null, reason: 'timeout' },
      { timestamp: NOW, status: 'ok', cpu_percent: 44, mem_percent: 67, mem_used_mb: 660, mem_total_mb: 1000, reason: '' },
    ])

    // Cold load straight into the machine detail route -- no Home visit
    // first, same "deep link" posture `deep-link.spec.ts` established.
    await page.goto('/machines/laptop')

    const cpuChart = page.getByTestId('machine-chart-cpu')
    await expect(cpuChart).toBeVisible()
    // A real time axis + value scale: the y-axis min/max labels and the
    // x-axis start tick are visibly present, not just in the aria-label.
    await expect(cpuChart.getByText('44%')).toBeVisible() // y-max label
    // The always-visible value readout defaults to the latest known sample.
    await expect(page.getByTestId('machine-chart-cpu-value')).toContainText('44%')
    // The gap sample (t = NOW - 300) gets its own visible marker -- never
    // silently absent, never interpolated across.
    await expect(cpuChart.locator('circle')).toHaveCount(1)
    // Two known-value runs either side of the gap -> two polylines.
    await expect(cpuChart.locator('polyline')).toHaveCount(2)

    await expect(page.getByTestId('machine-chart-memory')).toBeVisible()
    await expect(page.getByTestId('machine-chart-memory-value')).toContainText('67%')
    // Same gap, same honest marker, on the independent memory series.
    await expect(page.getByTestId('machine-chart-memory').locator('circle')).toHaveCount(1)
  })

  test('a machine with no metrics at all degrades both charts, never a false empty axis', async ({ page }) => {
    await mockShellApi(page)
    await mockMachineApi(page, [])

    await page.goto('/machines/laptop')

    await expect(page.getByTestId('machine-chart-cpu-degraded')).toHaveText(
      "This machine hasn't reported CPU yet.",
    )
    await expect(page.getByTestId('machine-chart-memory-degraded')).toHaveText(
      "This machine hasn't reported Memory yet.",
    )
  })

  test('the range selector narrows the retained window, and switching back to "All" restores the chart', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockMachineApi(page, [
      { timestamp: NOW - 5 * 3600, status: 'ok', cpu_percent: 33, mem_percent: 40, mem_used_mb: 400, mem_total_mb: 1000, reason: '' }, // 5h old -- outside "30m"/"1h"
    ])

    await page.goto('/machines/laptop')
    await expect(page.getByTestId('machine-chart-cpu')).toBeVisible()

    const thirtyMin = page.getByTestId('machine-chart-range-30m')
    await expect(thirtyMin).toBeVisible() // touchable at 390px too
    await thirtyMin.click()
    await expect(thirtyMin).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('machine-chart-cpu-degraded')).toHaveText('No CPU samples in the last 30m.')

    await page.getByTestId('machine-chart-range-all').click()
    await expect(page.getByTestId('machine-chart-cpu')).toBeVisible()
    await expect(page.getByTestId('machine-chart-cpu-degraded')).toHaveCount(0)
  })
})
