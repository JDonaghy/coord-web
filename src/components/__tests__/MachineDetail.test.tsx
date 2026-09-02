/**
 * Component tests for `MachineDetail` — the `/machines/:name` detail panel
 * (#61, #63, re-wired by #76). Same shape as `SessionDetail.test.tsx`:
 * `@/api/client` mocked, rendered inside a `MemoryRouter` at the real
 * param'd route so `useParams`/`useNavigate` resolve.
 *
 * #61's half of this file is issue #61's per-section independence: state,
 * health, work-stats and metrics come from independent pieces of derived
 * data that can (and, for a server old enough to predate #76's real routes,
 * do) 404 independently, and each must render its own honest "unavailable"
 * note rather than one panel-wide failure or a false all-or-nothing zero.
 * #63 adds two more independent sections on the same footing (active
 * workers, job history).
 *
 * #76 dropped the locality badge ("this machine"/"remote") and
 * agent-version drift highlighting this file used to cover -- both needed
 * `MachineState.is_local`, which never existed on a real roster -- and the
 * active-workers "N / ceiling" denominator, which needed a per-machine
 * `concurrency_limit` that also never existed. Severity now comes from the
 * Health section's own query (`fetchMachineHealth`), not a field on the
 * roster row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import MachineDetail from '@/components/MachineDetail'
import { paths } from '@/routes/paths'
import type {
  MachineActiveWorker,
  MachineHealthSnapshot,
  MachineJobHistoryEntry,
  MachineState,
  MachineWorkStats,
} from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchMachine: vi.fn(),
  fetchMachineHealth: vi.fn(),
  fetchMachineWorkStats: vi.fn(),
  fetchMachineMetrics: vi.fn(),
  fetchMachineWorkers: vi.fn(),
  fetchMachineJobs: vi.fn(),
}))

import {
  fetchMachine,
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
    state: 'online',
    reason: '',
    latency_ms: 12,
    agent_version: '1.2.3',
    repos: ['coord-web'],
    worktree_bytes: null,
    ...overrides,
  }
}

/** All non-state endpoints unavailable — the common shape for tests that
 * only care about the State section. */
function mockRestUnavailable() {
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
    // which parts are actually missing.
    const notes = await screen.findAllByText(/unavailable — this coord server doesn't serve it yet/)
    expect(notes).toHaveLength(6)
  })

  it('renders each section independently when only some endpoints are available', async () => {
    const machine = makeMachine({ name: 'laptop' })
    const health: MachineHealthSnapshot = {
      severity: 'ok',
      stale: false,
      checked_at: 1_700_000_000,
      results: [
        { key: 'disk', check_id: 'disk', scope: 'machine', title: 'Disk', label: 'disk', severity: 'ok', headroom: '86% used (22G free)' },
      ],
    }
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
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
      assignments_completed: 4,
      assignments_failed: 1,
    }
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: true, data: workStats })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({
      available: true,
      data: [
        {
          metric: 'cpu_pct',
          unit: '%',
          points: [
            { t: 1_000, value: 40 },
            { t: 2_000, value: 55 },
          ],
        },
      ],
    })

    renderDetail()

    expect(await screen.findByText('4 completed · 1 failed')).toBeInTheDocument()
    // The recognised `cpu_pct` series renders a real chart (#65) -- its
    // always-visible value readout defaults to the latest known sample.
    expect(await screen.findByTestId('machine-chart-cpu-value')).toHaveTextContent('55%')
    // A metric this machine never reported (`mem_pct`) degrades with its
    // own honest one-line reason, distinct from the CPU chart above it.
    expect(screen.getByTestId('machine-chart-memory-degraded')).toHaveTextContent(
      "This machine hasn't reported Memory yet.",
    )
  })

  // ── #63: identity, active workers, job history ──────────────────────────

  it('renders a populated machine: state, host, latency, active workers and a distinct failure in job history', async () => {
    const machine = makeMachine({
      name: 'laptop',
      host: 'laptop.tailnet.ts.net',
      latency_ms: 42,
      worktree_bytes: 1_500_000_000, // ~1.4 GB
      agent_version: '1.9.0',
    })
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachineHealth).mockResolvedValue({
      available: true,
      data: { severity: 'ok', stale: false, checked_at: 1, results: [] },
    })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })

    const workers: MachineActiveWorker[] = [
      { assignment_id: 'wk-1', status: 'running', spec: { issue_number: 42, issue_title: 'Fix', repo_name: 'coord-web' } },
      { assignment_id: 'wk-2', status: 'pending' },
    ]
    vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: true, data: workers })

    const jobs: MachineJobHistoryEntry[] = [
      { assignment_id: 'job-1', repo_name: 'coord-web', issue_number: 10, issue_title: 'Fix', type: 'work', status: 'done', dispatched_at: 1, finished_at: 1_699_999_000 },
      { assignment_id: 'job-2', repo_name: 'coord-web', issue_number: 11, issue_title: 'Break', type: 'work', status: 'failed', dispatched_at: 1, finished_at: 1_699_998_000 },
    ]
    vi.mocked(fetchMachineJobs).mockResolvedValue({ available: true, data: jobs })

    renderDetail('laptop')

    expect(await screen.findByText('online')).toBeInTheDocument()
    expect(screen.getByText('laptop.tailnet.ts.net')).toBeInTheDocument()
    expect(screen.getByText('42 ms')).toBeInTheDocument()

    const versionEl = await screen.findByTestId('agent-version')
    expect(versionEl).toHaveTextContent('1.9.0')

    // Worktree disk footprint, human-formatted.
    expect(screen.getByTestId('worktree-footprint')).toHaveTextContent('1.4 GB')

    // Active workers: assignment_id/issue/status rows, plus count. No age
    // column -- the real schema carries no dispatch timestamp per row
    // (#76), unlike the pre-#76 invented `started_at`.
    const activeSection = screen.getByLabelText('Active workers')
    expect(within(activeSection).getByText('wk-1')).toBeInTheDocument()
    expect(within(activeSection).getByText('running')).toBeInTheDocument()
    expect(within(activeSection).getByText('CW#42')).toBeInTheDocument()
    expect(within(activeSection).getByTestId('worker-ceiling')).toHaveTextContent('2')

    // Job history: both rows present, and the failed one is visually
    // distinct (its own testid + destructive-toned classes), the done one
    // is not.
    const failedRow = screen.getByTestId('job-row-failed')
    expect(within(failedRow).getByText('failed')).toBeInTheDocument()
    expect(failedRow).toHaveClass('bg-fail-wash')
    expect(within(failedRow).getByText('failed')).toHaveClass('text-fail')
    expect(screen.getByTestId('job-row')).toHaveTextContent('done')
  })

  it('renders an idle machine: no active workers, count still shown as zero', async () => {
    const machine = makeMachine({ name: 'idle-box' })
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: true, data: [] })
    vi.mocked(fetchMachineJobs).mockResolvedValue({ available: true, data: [] })

    renderDetail('idle-box')

    expect(await screen.findByText('No active workers.')).toBeInTheDocument()
    expect(screen.getByTestId('worker-ceiling')).toHaveTextContent('0')
    expect(screen.getByText('No job history.')).toBeInTheDocument()
  })

  it('renders an unreachable machine: its state text, unknown severity, no live worker data assumed', async () => {
    const machine = makeMachine({ name: 'ghost', state: 'unreachable', reason: 'connection refused' })
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachineHealth).mockResolvedValue({
      available: true,
      data: { severity: 'unknown', stale: false, checked_at: null, results: [] },
    })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkers).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineJobs).mockResolvedValue({ available: false })

    renderDetail('ghost')

    expect(await screen.findByText('unreachable')).toBeInTheDocument()
    expect(screen.getByText('connection refused')).toBeInTheDocument()
    // 'unknown' severity must never read as the healthy ('ok') badge -- the
    // same honesty rule #62 pins for the list rows.
    expect(screen.getByTestId('severity-badge')).toHaveTextContent('unknown')
    // Active workers / job history / work stats / metrics all 404
    // independently -- each still gets its own honest note, never a blank
    // section.
    const notes = await screen.findAllByText(/unavailable — this coord server doesn't serve it yet/)
    expect(notes.length).toBeGreaterThanOrEqual(4)
  })
})
