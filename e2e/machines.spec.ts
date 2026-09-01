/**
 * E2E acceptance net for the Machines panel (#67, M-4's exit gate).
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
 * Two postures, both already established by this milestone's own prior
 * stories:
 *
 *  - Most of this file mocks `/api/machines*` via `page.route()` against the
 *    Vite dev server, same choice `machine-charts.spec.ts`'s header explains:
 *    the *per-machine* routes `src/api/client.ts` calls
 *    (`/api/machines/{name}`, `/health`, `/work-stats`, `/workers`, `/jobs`)
 *    are claude-coordinator#3027, still open — no published `coord` server
 *    implements them, so there is nothing real to boot against for that
 *    surface, and mocking is what makes every degraded-state combination
 *    below deterministic rather than dependent on which `code-coordinator`
 *    version happens to be on `$PATH`.
 *  - The 'real coord web --fixture process' describe block near the bottom
 *    is the exception, for the one piece of the Machines API that IS real
 *    and stable on every published server this repo has ever run against:
 *    plain `GET /api/machines` (the roster list). Booting the actual process
 *    there catches the wire shape itself drifting — `live-update-fixture.
 *    spec.ts`'s whole reason to exist, applied to this panel — without
 *    betting on claude-coordinator#3027 or #3026's newer fixture keys having
 *    landed on whatever version CI's unpinned `pip install
 *    code-coordinator[server]` resolves to; see `e2e/fixtures/
 *    machines-basic.json`'s own comment for why it only leans on the older,
 *    long-stable `machines` fixture key.
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
  host?: string | null
  reachable: boolean
  last_seen?: number | null
  active_assignments?: number
  headless_workers?: number
  severity: 'ok' | 'warn' | 'crit' | 'unknown'
  agent_version?: string | null
  is_local?: boolean
  quiet_hours_paused?: boolean
  hand_paused?: boolean
  release_cordoned?: boolean
  worktree_bytes?: number | null
  concurrency_limit?: number | null
}

function machineState(overrides: MachineStateFixture) {
  return {
    host: null,
    last_seen: NOW,
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

/** `/api/machines` (the roster) plus `/api/fleet/health` -- the two routes
 * `MachinesPanel` reads regardless of which machine is drilled into. */
async function mockRoster(page: Page, machines: unknown[], fleetChecks: unknown[] = []): Promise<void> {
  await page.route('**/api/machines', (route) => route.fulfill(json(machines)))
  await page.route('**/api/fleet/health', (route) => route.fulfill(json(fleetChecks)))
}

/** Every per-name `MachineDetail` route 404s -- `apiFetchOptional`'s honest
 * "this coord server doesn't serve this route" outcome, `src/api/client.ts`. */
async function mock404AllMachineRoutes(page: Page, name: string): Promise<void> {
  const escaped = encodeURIComponent(name)
  for (const suffix of ['', '/health', '/work-stats', '/workers', '/jobs', '/metrics']) {
    await page.route(`**/api/machines/${escaped}${suffix}`, (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    )
  }
}

interface MachineDetailFixtures {
  state?: unknown
  health?: unknown
  workStats?: unknown
  workers?: unknown[]
  jobs?: unknown[]
  metrics?: unknown[]
}

/** Mocks every `MachineDetail` route for one machine name, independently --
 * pass `undefined` for a section to leave its 404 route unset by the caller
 * (see `mock404AllMachineRoutes`, used ahead of this for the "some sections
 * degrade, others don't" tests). */
async function mockMachineDetail(page: Page, name: string, fixtures: MachineDetailFixtures): Promise<void> {
  const escaped = encodeURIComponent(name)
  if (fixtures.state !== undefined) {
    await page.route(`**/api/machines/${escaped}`, (route) => route.fulfill(json(fixtures.state)))
  }
  if (fixtures.health !== undefined) {
    await page.route(`**/api/machines/${escaped}/health`, (route) => route.fulfill(json(fixtures.health)))
  }
  if (fixtures.workStats !== undefined) {
    await page.route(`**/api/machines/${escaped}/work-stats`, (route) => route.fulfill(json(fixtures.workStats)))
  }
  if (fixtures.workers !== undefined) {
    await page.route(`**/api/machines/${escaped}/workers`, (route) => route.fulfill(json(fixtures.workers)))
  }
  if (fixtures.jobs !== undefined) {
    await page.route(`**/api/machines/${escaped}/jobs`, (route) => route.fulfill(json(fixtures.jobs)))
  }
  if (fixtures.metrics !== undefined) {
    await page.route(`**/api/machines/${escaped}/metrics`, (route) => route.fulfill(json(fixtures.metrics)))
  }
}

const detail = (page: Page) => page.locator('[data-region="detail"]')

// ── Degraded states (#67) ───────────────────────────────────────────────────

test.describe('Machines panel — degraded states (#67)', () => {
  test('a coord server that predates the Machines API renders the honest unavailable panel, not an empty roster', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(page, [])
    // Override the roster route with a 404 -- the whole-panel version-skew
    // case, distinct from "loaded, zero machines" (#61's own honesty rule).
    await page.route('**/api/machines', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    )

    await page.goto('/machines')

    const unavailable = page.getByTestId('machines-unavailable')
    await expect(unavailable).toBeVisible()
    await expect(unavailable).toContainText("doesn't serve the machines API yet")
    // Never confusable with "0 known" -- the empty-roster state has its own
    // distinct copy ("No machines"), asserted absent here.
    await expect(page.getByText('No machines')).toHaveCount(0)
  })

  test('an unreachable, version-drifted machine renders in the roster, and its detail page shows every section degrading independently (the auto-deploy-skew case, claude-coordinator#3027)', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(page, [
      machineState({ name: 'laptop', severity: 'ok', is_local: true, agent_version: '1.4.0' }),
      machineState({
        name: 'oldbox',
        reachable: false,
        severity: 'unknown',
        agent_version: '1.2.0', // drifted against laptop's 1.4.0
        quiet_hours_paused: true,
      }),
    ])
    await mock404AllMachineRoutes(page, 'oldbox')

    await page.goto('/machines')

    const row = page.getByTestId('machine-row-oldbox')
    await expect(row).toBeVisible()
    await expect(row.getByText('offline')).toBeVisible()
    await expect(row.getByTestId('severity-badge')).toHaveText('unknown')
    await expect(row.getByTestId('badge-quiet-hours')).toBeVisible()
    await expect(row.getByTestId('agent-version')).toHaveText('1.2.0')

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

  test('a stale health snapshot, a real metric gap and an empty job/worker history all render together on one machine', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'laptop', severity: 'warn', is_local: true })])
    await mockMachineDetail(page, 'laptop', {
      state: machineState({ name: 'laptop', severity: 'warn', is_local: true, worktree_bytes: 1_000_000 }),
      health: {
        severity: 'warn',
        stale: true,
        checked_at: NOW - 3 * 3600,
        results: [
          { key: 'disk', label: 'disk', severity: 'warn', headroom: '86% used (22G free)', detail: 'low headroom' },
        ],
      },
      workStats: { machine: 'laptop', window_seconds: 21_600, assignments_completed: 0, assignments_failed: 0, cost_usd: null },
      workers: [],
      jobs: [],
      metrics: [
        {
          metric: 'cpu_pct',
          unit: '%',
          points: [
            { t: NOW - 600, value: 12 },
            { t: NOW - 300, value: null }, // a failed/timed-out poll -- an honest gap, never interpolated
            { t: NOW, value: 20 },
          ],
        },
      ],
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
    await mockRoster(page, [machineState({ name: 'fresh', severity: 'unknown', is_local: true })])
    await mockMachineDetail(page, 'fresh', {
      state: machineState({ name: 'fresh', severity: 'unknown', is_local: true }),
      health: { severity: 'unknown', stale: false, checked_at: null, results: [] },
      workStats: { machine: 'fresh', window_seconds: 21_600, assignments_completed: 0, assignments_failed: 0, cost_usd: null },
      workers: [],
      jobs: [],
      metrics: [],
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
    await expect(page.getByTestId('machine-chart-workers-degraded')).toBeVisible()
    await expect(page.getByTestId('machine-chart-throughput-degraded')).toBeVisible()
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
    const roster = {
      machines: [machineState({ name: 'laptop', severity: 'ok', is_local: true, reachable: false })],
    }
    await installFakeEventSource(page)
    await mockShellApi(page)
    await page.route('**/api/machines', (route) => route.fulfill(json(roster.machines)))
    await page.route('**/api/fleet/health', (route) => route.fulfill(json([])))

    await page.goto('/machines')
    await expect(page.getByTestId('machine-row-laptop').getByText('offline')).toBeVisible()

    await emitOnOnlyOpenInstance(page, 'open')

    // The server-side fact changes (as if the agent just reconnected) and a
    // scripted `machine_connected` announces it -- `src/realtime/events.ts`
    // maps this event type to the `['machines']` query key.
    roster.machines = [machineState({ name: 'laptop', severity: 'ok', is_local: true, reachable: true })]
    await emitOnOnlyOpenInstance(page, { message: ['machine_connected', { machine: 'laptop' }] })

    await expect(page.getByTestId('machine-row-laptop').getByText('online')).toBeVisible({ timeout: 5_000 })
  })
})

// ── Deep links (#67) ─────────────────────────────────────────────────────────

test.describe('Machines panel — deep links (#67)', () => {
  test('goto /machines cold restores the roster, without visiting Home first', async ({ page }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'laptop', severity: 'ok', is_local: true })])

    await page.goto('/machines')

    await expect(page.getByRole('heading', { name: 'Machines' })).toBeVisible()
    await expect(page.getByTestId('machine-row-laptop')).toBeVisible()
  })

  test('goto /machines/:name cold restores that machine\'s detail, and a reload keeps it there', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockRoster(page, [machineState({ name: 'laptop', severity: 'ok', is_local: true })])
    await mockMachineDetail(page, 'laptop', {
      state: machineState({ name: 'laptop', severity: 'ok', is_local: true, agent_version: '1.4.0' }),
      health: { severity: 'ok', stale: false, checked_at: NOW, results: [] },
      workStats: { machine: 'laptop', window_seconds: 21_600, assignments_completed: 3, assignments_failed: 0, cost_usd: null },
      workers: [],
      jobs: [],
      metrics: [],
    })

    await page.goto('/machines/laptop')

    await expect(detail(page).getByText('agent 1.4.0')).toBeVisible()

    await page.reload()

    await expect(page).toHaveURL(/\/machines\/laptop$/)
    await expect(detail(page).getByText('agent 1.4.0')).toBeVisible()
  })
})

// ── Real coord web --fixture process (#67) ─────────────────────────────────

test.describe('Machines panel against a real coord web --fixture process (#67)', () => {
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

    // Seeded fixture (e2e/fixtures/machines-basic.json): one local/online
    // machine, one remote/unreachable one -- proves the real dist bundle
    // parses the real `/api/machines` response, not a hand-authored guess
    // at its shape.
    const laptop = page.getByTestId('machine-row-laptop')
    await expect(laptop).toBeVisible()
    await expect(laptop.getByText('online')).toBeVisible()
    const dellserver = page.getByTestId('machine-row-dellserver')
    await expect(dellserver).toBeVisible()
    await expect(dellserver.getByText('offline')).toBeVisible()
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

  test('goto /machines/:name cold against the real process degrades every per-machine section, rather than crashing (claude-coordinator#3027 is not registered on any published coord server yet)', async ({
    page,
  }) => {
    // NOT the `apiFetchOptional`/`UnavailableNote` "unavailable — this coord
    // server doesn't serve it yet" copy the mocked test above exercises via
    // an explicit 404 -- that codepath assumes an unregistered API route
    // answers 404. In reality, `coord/dashboard/server.py`'s SPA catch-all
    // (`_spa_catch_all`, registered whenever a built `dist/` is served, e.g.
    // via `--dist`) matches *any* unmatched GET, `/api/...` included, and
    // returns 200 `index.html` -- there is no distinction for API-shaped
    // paths. `apiFetchOptional`'s `res.json()` on that HTML body throws, so
    // every one of these six sections lands on `MachineDetail`'s generic
    // `catch`-shaped "Failed to load ..." branch instead of the honest
    // per-route note. Asserted here as the actual, current behavior of every
    // published `coord` server against this bundle -- not the nicer message
    // the client's own doc comments assume -- so a future fix to either side
    // (a real 404 from the server, or a client-side check to tell "not
    // JSON" apart from "a real error") has a red test to turn green rather
    // than this silently regressing further.
    await page.goto(`${server.baseUrl}/machines/laptop`)

    for (const label of [
      'Failed to load machine state',
      'Failed to load active workers',
      'Failed to load job history',
      'Failed to load health checks',
      'Failed to load work stats',
      'Failed to load metrics',
    ]) {
      await expect(detail(page).getByText(label)).toBeVisible()
    }
  })
})
