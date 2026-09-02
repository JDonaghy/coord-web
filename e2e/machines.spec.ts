/**
 * E2E acceptance net for the Machines panel (#67, M-4's exit gate;
 * re-wired for the real API by #76).
 *
 * #61/#62/#63/#64/#65/#66 shipped the panel in slices, each with its own
 * component-level vitest coverage (`src/components/__tests__/Machine*`) and,
 * for #65's charts specifically, its own black-box e2e file
 * (`machine-charts.spec.ts`). None of that proves the panel holds together
 * end to end: that a cold `/machines/:name` load renders every section's
 * degraded state *together* rather than in isolated unit fixtures, that a
 * roster change reaches the screen via the real SSE wire rather than a
 * manual refresh, or that a deep link survives a reload. That's this file's
 * job — it deliberately does not re-cover ground `machine-charts.spec.ts`
 * (metric gaps, the range selector) or the per-row severity/badge unit tests
 * already own; see each test's own comment for what's new here.
 *
 * #76 found the panel had been wired to seven `/api/machines/{name}/*`
 * routes and a `MachineState.severity` field that claude-coordinator never
 * shipped — the real surface is four fleet-*wide* endpoints (`/api/machines`,
 * `/api/machines/health`, `/api/machines/metrics`, `/api/machines/stats`),
 * verified against a real server's own `GET /openapi.json` (see the 'real
 * coord web --fixture process' describe block below). The degrade-
 * independence granularity below changed to match: `MachineDetail`'s six
 * sections now share four underlying routes (state+active-workers both read
 * `/api/machines`; job-history+work-stats both read `/api/machines/stats`;
 * health reads `/api/machines/health` alone; metrics reads `/api/machines/
 * metrics` alone) — see `mockMachineDetailRoutes`'s own doc comment.
 *
 * Two postures, both already established by this milestone's own prior
 * stories:
 *
 *  - Most of this file mocks `/api/machines*` via `page.route()` against the
 *    Vite dev server, same choice `machine-charts.spec.ts`'s header explains.
 *  - The 'real coord web --fixture process' describe block near the bottom
 *    is the exception: it boots the actual `coord` CLI on `$PATH` and proves
 *    two things a mock can't -- that the real `/api/machines` wire shape
 *    (`e2e/fixtures/machines-basic.json`) renders without crashing, and
 *    (via `GET /openapi.json`, the same technique #76 used to derive these
 *    types) that this repo's `MachineState` type still matches what a real
 *    server declares it serves.
 *
 * Runs at the default (wide-ish) `chromium` viewport only — both breakpoints
 * and both themes for this panel are `machines-responsive.spec.ts`'s job
 * (playwright.config.ts's `BREAKPOINT_PROJECT_FILES`).
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'
import { startFixtureServer, type FixtureServerHandle } from './fixtureServer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const MACHINES_FIXTURE_PATH = path.join(here, 'fixtures', 'machines-basic.json')

const NOW = Math.floor(Date.now() / 1000)

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

/** The shell's own global reads — every spec in this suite that boots the
 * app cold has to stub these regardless of which panel it's testing. */
async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json([])))
  await page.route('**/api/board', (route) =>
    route.fulfill(json({ round_number: 1, active: [], completed: [] })),
  )
  await page.route('**/api/sessions', (route) => route.fulfill(json([])))
}

interface MachineStateFixture {
  name: string
  host?: string
  state: string
  reason?: string
  latency_ms?: number | null
  agent_version?: string | null
  repos?: string[]
  worktree_bytes?: number | null
  assignments?: { active: unknown[] }
}

function machineState(overrides: MachineStateFixture) {
  return {
    host: '',
    reason: '',
    latency_ms: null,
    agent_version: null,
    repos: [],
    worktree_bytes: null,
    ...overrides,
  }
}

/** `/api/machines` (the roster) plus `/api/machines/health` (fleet-wide
 * `machine_health[]`/`fleet_checks`) plus `/api/machines/stats` (fleet-wide,
 * empty by default) -- the three routes `MachinesPanel` reads regardless of
 * which machine is drilled into. */
async function mockRoster(
  page: Page,
  machines: unknown[],
  machineHealth: unknown[] = [],
  fleetChecks: unknown[] = [],
): Promise<void> {
  await page.route('**/api/machines', (route) => route.fulfill(json(machines)))
  await page.route('**/api/machines/health', (route) =>
    route.fulfill(json({ schema: 1, refreshed_at: NOW, machine_health: machineHealth, fleet_checks: fleetChecks, truncated: false })),
  )
  await page.route('**/api/machines/stats', (route) => route.fulfill(json([])))
}

/**
 * Mocks the four real Machines API routes with independent availability —
 * `MachineDetail`'s six sections read from only four underlying routes
 * post-#76 (see this file's header): state+active-workers both come off
 * `/api/machines` (filtered/joined client-side to one machine, `fetchMachine`/
 * `fetchMachineWorkers`, `src/api/client.ts`), job-history+work-stats both
 * come off `/api/machines/stats` (`fetchMachineJobs`/`fetchMachineWorkStats`),
 * health off `/api/machines/health` alone, metrics off `/api/machines/metrics`
 * alone. Pass `undefined` for a route to 404 it — `apiFetchOptional`'s
 * honest "this coord server doesn't serve this route" outcome.
 */
async function mockMachineDetailRoutes(
  page: Page,
  fixtures: {
    machines?: unknown[]
    health?: { machine_health: unknown[]; fleet_checks: unknown[] }
    stats?: unknown[]
    metrics?: { machines: Record<string, unknown[]> }
  },
): Promise<void> {
  if (fixtures.machines !== undefined) {
    await page.route('**/api/machines', (route) => route.fulfill(json(fixtures.machines)))
  } else {
    await page.route('**/api/machines', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  }
  if (fixtures.health !== undefined) {
    await page.route('**/api/machines/health', (route) =>
      route.fulfill(json({ schema: 1, refreshed_at: NOW, truncated: false, ...fixtures.health })),
    )
  } else {
    await page.route('**/api/machines/health', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  }
  if (fixtures.stats !== undefined) {
    await page.route('**/api/machines/stats', (route) => route.fulfill(json(fixtures.stats)))
  } else {
    await page.route('**/api/machines/stats', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  }
  if (fixtures.metrics !== undefined) {
    await page.route('**/api/machines/metrics', (route) =>
      route.fulfill(json({ schema: 1, generated_at: NOW, since: null, resolution: null, ...fixtures.metrics })),
    )
  } else {
    await page.route('**/api/machines/metrics', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
  }
}

const detail = (page: Page) => page.locator('[data-region="detail"]')

// ── Degraded states (#67, re-scoped by #76) ─────────────────────────────────

test.describe('Machines panel — degraded states (#67, #76)', () => {
  test('a coord server that predates the Machines API renders the honest unavailable panel, not an empty roster', async ({
    page,
  }) => {
    await mockShellApi(page)
    // Every real Machines route 404s -- the whole-panel version-skew case,
    // distinct from "loaded, zero machines" (#61's own honesty rule).
    await page.route('**/api/machines', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/machines/health', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/machines/stats', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))

    await page.goto('/machines')

    const unavailable = page.getByTestId('machines-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText("doesn't serve the machines API yet")
    // Never confusable with "0 known" -- the empty-roster state has its own
    // distinct copy ("No machines"), asserted absent here.
    await expect(page.getByText('No machines')).toHaveCount(0)
  })

  test('an unreachable machine renders in the roster with unknown severity, and its detail page shows every underlying route degrading independently', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(
      page,
      [
        machineState({ name: 'laptop', state: 'online' }),
        machineState({ name: 'oldbox', state: 'unreachable', reason: 'connection refused' }),
      ],
      [{ machine: 'laptop', state: 'online', reason: '', severity: 'ok', stale: false, checked_at: NOW, results: [] }],
      // 'oldbox' has no machine_health row at all -- resolves to an
      // explicit 'unknown' severity (`fetchMachineHealth`'s "never
      // reported" synthesis, `src/api/client.ts`), never a fabricated 'ok'.
    )
    // Every per-machine route for 'oldbox' unavailable at the detail level.
    await mockMachineDetailRoutes(page, {})

    await page.goto('/machines')

    const row = page.getByTestId('machine-row-oldbox')
    await expect(row).toBeVisible()
    await expect(row).toContainText('unreachable')
    await expect(row.getByTestId('severity-badge')).toHaveText('unknown')

    await row.click()
    await expect(page).toHaveURL(/\/machines\/oldbox$/)

    // Every one of MachineDetail's six independent sections reads its own
    // honest "unavailable" note -- never a crash, never a blank section that
    // could be mistaken for "this machine has none of this."
    for (const label of [
      'Machine state',
      'Active workers',
      'Job history',
      'Health checks',
      'Work stats',
      'Metrics',
    ]) {
      await expect(detail(page).getByText(`${label} unavailable`)).toBeVisible()
    }
  })

  test('the roster route alone degrading takes state and active workers down together, while health/stats/metrics stay independent', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'laptop', state: 'online' })])
    await mockMachineDetailRoutes(page, {
      // machines: undefined -> 404s, taking down both State and Active
      // workers (both read `/api/machines`, #76's mapping).
      health: { machine_health: [{ machine: 'laptop', state: 'online', reason: '', severity: 'ok', stale: false, checked_at: NOW, results: [] }], fleet_checks: [] },
      stats: [{ name: 'laptop', capacity: { active: 0, max: 4 }, counts: { completed: 2, failed: 0 }, job_history: [] }],
      metrics: { machines: {} },
    })

    await page.goto('/machines/laptop')

    await expect(detail(page).getByText('Machine state unavailable')).toBeVisible()
    await expect(detail(page).getByText('Active workers unavailable')).toBeVisible()
    // The other three routes are up -- their sections render real content,
    // not an unavailable note.
    await expect(page.getByTestId('health-never-polled')).toBeVisible()
    await expect(detail(page).getByText('2 completed · 0 failed')).toBeVisible()
    await expect(detail(page).getByText('No job history.')).toBeVisible()
  })

  test('a stale health snapshot, a real metric gap and an empty job/worker history all render together on one machine', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'laptop', state: 'online' })])
    await mockMachineDetailRoutes(page, {
      machines: [machineState({ name: 'laptop', state: 'online', worktree_bytes: 1_000_000 })],
      health: {
        machine_health: [
          {
            machine: 'laptop',
            state: 'online',
            reason: '',
            severity: 'warn',
            stale: true,
            checked_at: NOW - 3 * 3600,
            results: [
              { key: 'disk', check_id: 'disk', scope: 'machine', title: 'Disk', label: 'disk', severity: 'warn', headroom: '86% used (22G free)', detail: 'low headroom' },
            ],
          },
        ],
        fleet_checks: [],
      },
      stats: [{ name: 'laptop', capacity: { active: 0, max: 4 }, counts: { completed: 0, failed: 0 }, job_history: [] }],
      metrics: {
        machines: {
          laptop: [
            { timestamp: NOW - 600, status: 'ok', cpu_percent: 12, mem_percent: 30, mem_used_mb: 100, mem_total_mb: 300, reason: '' },
            { timestamp: NOW - 300, status: 'unknown', cpu_percent: null, mem_percent: null, mem_used_mb: null, mem_total_mb: null, reason: 'timeout' }, // a failed/timed-out poll -- an honest gap, never interpolated
            { timestamp: NOW, status: 'ok', cpu_percent: 20, mem_percent: 32, mem_used_mb: 110, mem_total_mb: 300, reason: '' },
          ],
        },
      },
    })

    await page.goto('/machines/laptop')

    // Stale health: rows still render, plus a banner naming the age -- never
    // silently as if the reading were current (#64's honesty rule).
    const staleBanner = page.getByTestId('health-stale-banner')
    await expect(staleBanner).toBeVisible()
    await expect(staleBanner).toContainText('Stale')
    await expect(page.getByTestId('health-row-disk')).toBeVisible()

    // The gap sample gets its own visible marker on the real chart, exactly
    // like machine-charts.spec.ts's own gap assertion -- proven here
    // alongside the rest of the page, not in isolation.
    await expect(page.getByTestId('machine-chart-cpu').locator('circle')).toHaveCount(1)

    // Never-history sections read their own explicit zero, not a blank area.
    await expect(page.getByText('No active workers.')).toBeVisible()
    await expect(page.getByText('No job history.')).toBeVisible()
    await expect(page.getByText('0 completed · 0 failed')).toBeVisible()
  })

  test('a machine with absolutely no history yet reads as "no signal", never as healthy', async ({ page }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'fresh', state: 'online' })])
    await mockMachineDetailRoutes(page, {
      machines: [machineState({ name: 'fresh', state: 'online' })],
      health: { machine_health: [], fleet_checks: [] },
      stats: [],
      metrics: { machines: {} },
    })

    await page.goto('/machines/fresh')

    await expect(page.getByTestId('health-never-polled')).toHaveText(
      'No health data reported for this machine (old agent, or never polled).',
    )
    await expect(page.getByText('No active workers.')).toBeVisible()
    await expect(page.getByText('No job history.')).toBeVisible()
    // Every chart family reads its own "hasn't reported yet" line rather
    // than an empty-but-present chart that could misread as a flat zero.
    await expect(page.getByTestId('machine-chart-cpu-degraded')).toBeVisible()
    await expect(page.getByTestId('machine-chart-memory-degraded')).toBeVisible()
  })
})

// ── Live updates (#67) ──────────────────────────────────────────────────────

/** Same hand-rolled fake `EventSource` technique `realtime.spec.ts` uses --
 * see that file's header for why Playwright has no built-in for this
 * transport. Duplicated rather than imported: each e2e file in this suite
 * is self-contained per its own convention (no shared test-only module
 * beyond `fixtureServer.ts`, which exists for a different purpose). */
async function installFakeEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeEventSource {
      url: string
      closed = false
      onopen: ((ev: unknown) => void) | null = null
      onerror: ((ev: unknown) => void) | null = null
      private listeners: Record<string, Array<(ev: { data: string }) => void>> = {}
      constructor(url: string) {
        this.url = url
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).__sse.instances.push(this)
      }
      addEventListener(type: string, cb: (ev: { data: string }) => void): void {
        ;(this.listeners[type] ??= []).push(cb)
      }
      close(): void {
        this.closed = true
      }
      emitOpen(): void {
        this.onopen?.({})
      }
      emitMessage(type: string, data: unknown): void {
        for (const cb of this.listeners[type] ?? []) cb({ data: JSON.stringify(data) })
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__sse = { instances: [] as FakeEventSource[] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).EventSource = FakeEventSource
  })
}

async function emitOnOnlyOpenInstance(
  page: Page,
  action: 'open' | { message: [string, unknown] },
): Promise<void> {
  await page.waitForFunction(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sse = (window as any).__sse
    return sse.instances.filter((i: { closed: boolean }) => !i.closed).length === 1
  })
  await page.evaluate((act) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sse = (window as any).__sse
    const open = sse.instances.filter((i: { closed: boolean }) => !i.closed)
    const inst = open[open.length - 1]
    if (act === 'open') inst.emitOpen()
    else inst.emitMessage(act.message[0], act.message[1])
  }, action)
}

test.describe('Machines panel — live updates (#67)', () => {
  test('a machine_connected event refreshes the roster with no manual refresh (SSE-driven, not polling)', async ({
    page,
  }) => {
    const roster = { machines: [machineState({ name: 'laptop', state: 'unreachable' })] }
    await installFakeEventSource(page)
    await mockShellApi(page)
    await page.route('**/api/machines', (route) => route.fulfill(json(roster.machines)))
    await page.route('**/api/machines/health', (route) =>
      route.fulfill(json({ schema: 1, refreshed_at: NOW, machine_health: [], fleet_checks: [], truncated: false })),
    )
    await page.route('**/api/machines/stats', (route) => route.fulfill(json([])))

    await page.goto('/machines')
    await expect(page.getByTestId('machine-row-laptop')).toContainText('unreachable')

    await emitOnOnlyOpenInstance(page, 'open')

    // The server-side fact changes (as if the agent just reconnected) and a
    // scripted `machine_connected` announces it -- `src/realtime/events.ts`
    // maps this event type to the `['machines']` query key.
    roster.machines = [machineState({ name: 'laptop', state: 'online' })]
    await emitOnOnlyOpenInstance(page, { message: ['machine_connected', { machine: 'laptop' }] })

    await expect(page.getByTestId('machine-row-laptop')).toContainText('online', { timeout: 5_000 })
  })
})

// ── Deep links (#67) ─────────────────────────────────────────────────────────

test.describe('Machines panel — deep links (#67)', () => {
  test('goto /machines cold restores the roster, without visiting Home first', async ({ page }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'laptop', state: 'online' })])

    await page.goto('/machines')

    await expect(page.getByRole('heading', { name: 'Machines' })).toBeVisible()
    await expect(page.getByTestId('machine-row-laptop')).toBeVisible()
  })

  test('goto /machines/:name cold restores that machine\'s detail, and a reload keeps it there', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'laptop', state: 'online' })])
    await mockMachineDetailRoutes(page, {
      machines: [machineState({ name: 'laptop', state: 'online', agent_version: '1.4.0' })],
      health: { machine_health: [], fleet_checks: [] },
      stats: [{ name: 'laptop', capacity: { active: 0, max: 4 }, counts: { completed: 3, failed: 0 }, job_history: [] }],
      metrics: { machines: {} },
    })

    await page.goto('/machines/laptop')

    await expect(detail(page).getByText('agent 1.4.0')).toBeVisible()

    await page.reload()

    await expect(page).toHaveURL(/\/machines\/laptop$/)
    await expect(detail(page).getByText('agent 1.4.0')).toBeVisible()
  })
})

// ── Real coord web --fixture process (#67, re-verified for #76) ────────────

test.describe('Machines panel against a real coord web --fixture process (#67, #76)', () => {
  test.describe.configure({ mode: 'serial' })
  let server: FixtureServerHandle

  test.beforeAll(async () => {
    server = await startFixtureServer(MACHINES_FIXTURE_PATH)
  })

  test.afterAll(async () => {
    await server?.stop()
  })

  test('the real GET /api/machines wire shape renders the roster, and a replayed machine_connected event triggers an unprompted refetch', async ({
    page,
  }) => {
    const machinesRequests: number[] = []
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/machines') machinesRequests.push(Date.now())
    })

    await page.goto(`${server.baseUrl}/machines`)

    // Seeded fixture (e2e/fixtures/machines-basic.json): one online machine
    // with an active assignment, one unreachable one -- proves the real
    // dist bundle parses the real `/api/machines` response (#76's corrected
    // field set), not the pre-#76 invented shape.
    const laptop = page.getByTestId('machine-row-laptop')
    await expect(laptop).toBeVisible()
    await expect(laptop).toContainText('online')
    const dellserver = page.getByTestId('machine-row-dellserver')
    await expect(dellserver).toBeVisible()
    await expect(dellserver).toContainText('unreachable')
    // Neither machine has a `machine_health` row (the fixture doesn't seed
    // one) -- both must read as 'unknown', never a fabricated 'ok' (#76's
    // honesty requirement, the direct regression test for the white-screen
    // bug: `SeverityBadge` must survive an absent severity, not crash).
    await expect(laptop.getByTestId('severity-badge')).toHaveText('unknown')
    await expect(dellserver.getByTestId('severity-badge')).toHaveText('unknown')

    const badge = page.getByRole('status', { name: /Connection:/ })
    await expect(badge).toHaveText('Live', { timeout: 10_000 })

    const requestsBeforeReplay = machinesRequests.length
    expect(requestsBeforeReplay).toBeGreaterThan(0)

    // The fixture's scripted `machine_connected` event, played over the REAL
    // /events stream (`e2e/fixtures/machines-basic.json`'s `events`) --
    // nothing here reloads the page or clicks a refresh control.
    const replay = await page.request.post(`${server.baseUrl}/api/fixture/events/replay`)
    expect(replay.ok()).toBe(true)

    await expect
      .poll(() => machinesRequests.length, { timeout: 5_000 })
      .toBeGreaterThan(requestsBeforeReplay)
  })

  test('goto /machines/:name cold against the real process degrades every per-machine section, rather than crashing', async ({
    page,
  }) => {
    // The real `/api/machines/health`, `/metrics`, `/stats` routes DO exist
    // on this server (#76) but report nothing for a machine the daemon has
    // no health/metrics/stats data for yet -- each section reads that as its
    // own honest "no signal" state (empty roster, "no data reported", chart
    // degrade), never a crash and never silently as healthy.
    await page.goto(`${server.baseUrl}/machines/laptop`)

    await expect(page.getByTestId('health-never-polled')).toBeVisible()
    await expect(page.getByText('No job history.')).toBeVisible()
    await expect(page.getByText('0 completed · 0 failed')).toBeVisible()
    await expect(page.getByTestId('machine-chart-cpu-degraded')).toBeVisible()
  })

  test("the real server's own OpenAPI schema still matches this repo's MachineState type (#76's root-cause regression guard)", async ({
    page,
  }) => {
    // #76 was found by exactly this technique: fetching a real server's own
    // `GET /openapi.json` and diffing it against what `src/api/generated.ts`
    // declares. Encoding that check as a test means a future server-side
    // field rename/addition/removal is caught here, structurally, rather
    // than needing a second bundle-disassembly investigation.
    const res = await page.request.get(`${server.baseUrl}/openapi.json`)
    expect(res.ok()).toBe(true)
    const spec = await res.json()

    const machinesGet = spec.paths['/api/machines'].get
    const ref = machinesGet.responses['200'].content['application/json'].schema.items.$ref as string
    const schemaName = ref.split('/').pop() as string
    const properties = Object.keys(spec.components.schemas[schemaName].properties).sort()

    // Exactly `MachineState`'s field set (`src/api/generated.ts`) -- in
    // particular, no `severity` (issue #76's actual crash) and none of the
    // other invented pre-#76 fields.
    expect(properties).toEqual(
      ['agent_version', 'assignments', 'host', 'latency_ms', 'name', 'reason', 'repos', 'state', 'worktree_bytes'].sort(),
    )

    // The four real Machines routes, and nothing per-machine -- the other
    // half of #76's finding (seven of eight called routes never existed).
    const machinePaths = Object.keys(spec.paths).filter((p: string) => p.startsWith('/api/machines'))
    expect(machinePaths.sort()).toEqual(
      ['/api/machines', '/api/machines/health', '/api/machines/metrics', '/api/machines/stats'].sort(),
    )
  })
})
