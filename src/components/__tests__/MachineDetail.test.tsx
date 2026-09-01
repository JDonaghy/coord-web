/**
 * Component tests for `MachineDetail` — the `/machines/:name` detail panel
 * (#61, #63). Same shape as `SessionDetail.test.tsx`: `@/api/client` mocked,
 * rendered inside a `MemoryRouter` at the real param'd route so `useParams`/
 * `useNavigate` resolve.
 *
 * #61's half of this file is issue #61's per-section independence: state,
 * health, work-stats and metrics are separate endpoints that can (and,
 * until claude-coordinator#3027 lands, always do) 404 independently, and
 * each must render its own honest "unavailable" note rather than one
 * panel-wide failure or a false all-or-nothing zero. #63 adds two more
 * independent sections on the same footing (active workers, job history)
 * and covers the populated / idle / unreachable-machine states issue #63
 * calls out explicitly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import MachineDetail from '@/components/MachineDetail'
import { paths } from '@/routes/paths'
import type {
  MachineActiveWorker,
  MachineHealthRow,
  MachineJobHistoryEntry,
  MachineState,
  MachineWorkStats,
} from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchMachine: vi.fn(),
  fetchMachines: vi.fn(),
  fetchMachineHealth: vi.fn(),
  fetchMachineWorkStats: vi.fn(),
  fetchMachineMetrics: vi.fn(),
  fetchMachineWorkers: vi.fn(),
  fetchMachineJobs: vi.fn(),
}))

import {
  fetchMachine,
  fetchMachines,
  fetchMachineHealth,
  fetchMachineMetrics,
  fetchMachineWorkers,
  fetchMachineWorkStats,
  fetchMachineJobs,
} from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
})

function renderDetail(name = 'laptop') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[paths.machineItem(name)]}>
        <Routes>
          <Route path="/machines/:name" element={<MachineDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function makeMachine(overrides: Partial<MachineState> = {}): MachineState {
  return {
    name: 'laptop',
    host: 'laptop.tailnet.ts.net',
    reachable: true,
    last_seen: 1_700_000_000,
    active_assignments: 0,
    headless_workers: 0,
    severity: 'ok',
    agent_version: '1.2.3',
    is_local: false,
    quiet_hours_paused: false,
    hand_paused: false,
    release_cordoned: false,
    worktree_bytes: null,
    concurrency_limit: null,
    ...overrides,
  }
}

/** All non-state/roster endpoints unavailable — the common shape for tests
 * that only care about the State section. */
function mockRestUnavailable() {
  vi.mocked(fetchMachines).mockResolvedValue({ available: false })
  vi.mocked(fetchMachineHealth).mockResolvedValue({ available: false })
  vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
  vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })
  vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: false })
  vi.mocked(fetchMachineJobs).mockResolvedValue({ available: false })
}

describe('MachineDetail', () => {
  it('renders an unavailable note per section when every endpoint 404s (#61)', async () => {
    vi.mocked(fetchMachine).mockResolvedValue({ available: false })
    mockRestUnavailable()

    renderDetail()

    // One per section (state, active workers, job history, health, work
    // stats, metrics) -- never a single panel-wide failure that would hide
    // which parts are actually missing. The roster fetch (`fetchMachines`)
    // has no section of its own -- it's only ever a silent drift input.
    const notes = await screen.findAllByText(/unavailable — this coord server doesn't serve it yet/)
    expect(notes).toHaveLength(6)
  })

  it('renders each section independently when only some endpoints are available', async () => {
    const machine = makeMachine({ name: 'laptop' })
    const health: MachineHealthRow[] = [
      { check: 'disk', status: 'ok', detail: null, checked_at: 1_700_000_000 },
    ]
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachines).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: true, data: health })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineJobs).mockResolvedValue({ available: false })

    renderDetail()

    expect(await screen.findByText('online')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Health')).getByText('disk')).toBeInTheDocument()
    // The four unavailable sections (active workers, job history, work
    // stats, metrics) still say so, distinctly, while state and health
    // render their real data.
    const notes = await screen.findAllByText(/unavailable — this coord server doesn't serve it yet/)
    expect(notes).toHaveLength(4)
  })

  it('renders real work stats and metrics when available', async () => {
    vi.mocked(fetchMachine).mockResolvedValue({ available: false })
    mockRestUnavailable()
    const workStats: MachineWorkStats = {
      machine: 'laptop',
      window_seconds: 86400,
      assignments_completed: 4,
      assignments_failed: 1,
      cost_usd: 2.5,
    }
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: true, data: workStats })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({
      available: true,
      data: [{ metric: 'load1', unit: null, points: [{ t: 1, value: 0.5 }] }],
    })

    renderDetail()

    expect(await screen.findByText('4 completed · 1 failed')).toBeInTheDocument()
    expect(await screen.findByText('load1')).toBeInTheDocument()
    expect(screen.getByText('1 points')).toBeInTheDocument()
  })

  // ── #63: identity, active workers, job history ──────────────────────────

  it('renders a populated machine: identity, version drift, active workers and a distinct failure in job history', async () => {
    const local = makeMachine({ name: 'desktop', is_local: true, agent_version: '2.0.0' })
    const machine = makeMachine({
      name: 'laptop',
      is_local: false,
      agent_version: '1.9.0', // drifts from `local`'s 2.0.0
      headless_workers: 2,
      concurrency_limit: 6,
      worktree_bytes: 1_500_000_000, // ~1.4 GB
      severity: 'ok',
    })
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [local, machine] })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })

    const workers: MachineActiveWorker[] = [
      { id: 'wk-1', issue: 42, type: 'work', repo: 'coord-web', started_at: 1_700_000_000 },
      { id: 'wk-2', issue: null, type: 'review', repo: null, started_at: 1_700_000_500 },
    ]
    vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: true, data: workers })

    const jobs: MachineJobHistoryEntry[] = [
      { id: 'job-1', issue: 10, repo: 'coord-web', status: 'done', finished_at: 1_699_999_000 },
      { id: 'job-2', issue: 11, repo: 'coord-web', status: 'failed', finished_at: 1_699_998_000 },
    ]
    vi.mocked(fetchMachineJobs).mockResolvedValue({ available: true, data: jobs })

    renderDetail('laptop')

    // Identity: remote badge (never "this machine" for a non-local roster
    // entry).
    expect(await screen.findByText('remote')).toBeInTheDocument()

    // Version drift: flagged against the roster's `is_local` entry, not
    // some hardcoded reference.
    const versionEl = await screen.findByTestId('agent-version')
    expect(versionEl).toHaveTextContent('1.9.0')
    expect(versionEl).toHaveTextContent('drift')
    expect(versionEl).toHaveClass('text-destructive')

    // Worktree disk footprint, human-formatted.
    expect(screen.getByTestId('worktree-footprint')).toHaveTextContent('1.4 GB')

    // Active workers: id/issue/type/repo/age rows, plus count / ceiling.
    const activeSection = screen.getByLabelText('Active workers')
    expect(within(activeSection).getByText('wk-1')).toBeInTheDocument()
    expect(within(activeSection).getByText('work')).toBeInTheDocument()
    expect(within(activeSection).getByText('CW#42')).toBeInTheDocument()
    expect(within(activeSection).getByTestId('worker-ceiling')).toHaveTextContent('2 / 6')

    // Job history: both rows present, and the failed one is visually
    // distinct (its own testid + destructive-toned classes), the done one
    // is not.
    const failedRow = screen.getByTestId('job-row-failed')
    expect(within(failedRow).getByText('failed')).toBeInTheDocument()
    expect(failedRow).toHaveClass('bg-fail-wash')
    expect(within(failedRow).getByText('failed')).toHaveClass('text-fail')
    expect(screen.getByTestId('job-row')).toHaveTextContent('done')
  })

  it('renders an idle machine: reachable, no active workers, ceiling still shown', async () => {
    const machine = makeMachine({
      name: 'idle-box',
      is_local: true,
      headless_workers: 0,
      concurrency_limit: 4,
    })
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [machine] })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: true, data: [] })
    vi.mocked(fetchMachineJobs).mockResolvedValue({ available: true, data: [] })

    renderDetail('idle-box')

    expect(await screen.findByText('this machine')).toBeInTheDocument()
    expect(await screen.findByText('No active workers.')).toBeInTheDocument()
    expect(screen.getByTestId('worker-ceiling')).toHaveTextContent('0 / 4')
    expect(screen.getByText('No job history.')).toBeInTheDocument()
    // Never flagged for drift against itself.
    expect(screen.queryByText(/drift/)).not.toBeInTheDocument()
  })

  it('renders an unreachable machine: offline, unknown severity, last-contact age, no live worker data assumed', async () => {
    const machine = makeMachine({
      name: 'ghost',
      reachable: false,
      severity: 'unknown',
      last_seen: 1_700_000_000,
      headless_workers: 0,
    })
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [machine] })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineJobs).mockResolvedValue({ available: false })

    renderDetail('ghost')

    expect(await screen.findByText('offline')).toBeInTheDocument()
    // 'unknown' severity must never read as the healthy ('ok') badge -- the
    // same honesty rule #62 pins for the list rows.
    expect(screen.getByTestId('severity-badge')).toHaveTextContent('unknown')
    expect(screen.getByText(/last contact/)).toBeInTheDocument()
    // Active workers / job history / health / work stats / metrics all 404
    // independently -- each still gets its own honest note, never a blank
    // section.
    const notes = await screen.findAllByText(/unavailable — this coord server doesn't serve it yet/)
    expect(notes.length).toBeGreaterThanOrEqual(5)
  })
})
