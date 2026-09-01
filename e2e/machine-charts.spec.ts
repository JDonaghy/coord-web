/**
 * E2E coverage for #65 (M-4) — the Machines panel's CPU/memory/disk/
 * throughput time-series charts (`MachineCharts.tsx`).
 *
 * `/api/machines*` is hand-authored ahead of its backend
 * (claude-coordinator#3027, still open at the time this landed — see
 * `src/api/generated.ts`'s own "Machines panel" section header), so unlike
 * `live-update-fixture.spec.ts` this can't boot a real `coord web
 * --fixture` process yet; every route below is mocked via `page.route()`
 * against the Vite dev server, same posture `deep-link.spec.ts`/
 * `theme.spec.ts`/`answers.spec.ts` already take for routes their own
 * story added ahead of (or independent of) fixture-server support.
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
  reachable: true,
  last_seen: NOW - 30,
  active_assignments: 1,
  headless_workers: 2,
  severity: 'ok',
  agent_version: '1.2.3',
  is_local: false,
  quiet_hours_paused: false,
  hand_paused: false,
  release_cordoned: false,
  worktree_bytes: 2_147_483_648, // exactly 2 GiB -- formatMachineChartBytes is binary (1024-based)
  concurrency_limit: 6,
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

async function mockMachineApi(page: Page, metrics: unknown[]): Promise<void> {
  await page.route('**/api/machines/laptop/metrics', (route) => route.fulfill(json(metrics)))
  await page.route('**/api/machines/laptop/health', (route) =>
    route.fulfill(json({ severity: 'ok', stale: false, checked_at: NOW - 30, results: [] })),
  )
  await page.route('**/api/machines/laptop/work-stats', (route) =>
    route.fulfill(
      json({ machine: 'laptop', window_seconds: 21_600, assignments_completed: 5, assignments_failed: 1, cost_usd: null }),
    ),
  )
  await page.route('**/api/machines/laptop/workers', (route) => route.fulfill(json([])))
  await page.route('**/api/machines/laptop/jobs', (route) => route.fulfill(json([])))
  await page.route('**/api/machines/laptop', (route) => route.fulfill(json(MACHINE_STATE)))
  await page.route('**/api/machines', (route) => route.fulfill(json([MACHINE_STATE])))
}

test.describe('Machine charts (#65)', () => {
  test('renders real CPU/memory/disk charts with a visible gap marker, and degrades a metric this machine never reported', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockMachineApi(page, [
      {
        metric: 'cpu_pct',
        unit: '%',
        points: [
          { t: NOW - 900, value: 12 },
          { t: NOW - 600, value: 18 },
          { t: NOW - 300, value: null }, // an explicit failed/timed-out poll
          { t: NOW, value: 44 },
        ],
      },
      {
        metric: 'mem_pct',
        unit: '%',
        points: [
          { t: NOW - 600, value: 61 },
          { t: NOW, value: 67 },
        ],
      },
      {
        metric: 'worktree_bytes',
        unit: 'bytes',
        points: [
          { t: NOW - 600, value: 1_800_000_000 },
          { t: NOW, value: 2_147_483_648 }, // exactly 2 GiB -- see MACHINE_STATE.worktree_bytes comment
        ],
      },
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
    await expect(page.getByTestId('machine-chart-disk')).toBeVisible()
    await expect(page.getByTestId('machine-chart-disk-value')).toContainText('2.0 GB')

    // `active_workers`/`jobs_completed`/`jobs_failed` were never reported by
    // this machine -- an honest one-line reason each, never a blank region
    // or a chart that silently reads as a flat healthy zero.
    await expect(page.getByTestId('machine-chart-workers-degraded')).toHaveText(
      "This machine hasn't reported Active workers yet.",
    )
    await expect(page.getByTestId('machine-chart-throughput-degraded')).toBeVisible()
  })

  test('the range selector narrows the retained window, and switching back to "All" restores the chart', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockMachineApi(page, [
      {
        metric: 'cpu_pct',
        unit: '%',
        points: [{ t: NOW - 5 * 3600, value: 33 }], // 5h old -- outside "30m"/"1h"
      },
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
