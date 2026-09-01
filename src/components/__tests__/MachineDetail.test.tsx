/**
 * Component tests for `MachineDetail` — the `/machines/:name` detail panel
 * (#61). Same shape as `SessionDetail.test.tsx`: `@/api/client` mocked,
 * rendered inside a `MemoryRouter` at the real param'd route so `useParams`/
 * `useNavigate` resolve.
 *
 * The point of this file is issue #61's per-section independence: state,
 * health, work-stats and metrics are four separate endpoints that can (and,
 * until claude-coordinator#3027 lands, always do) 404 independently, and
 * each must render its own honest "unavailable" note rather than one
 * panel-wide failure or a false all-or-nothing zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import MachineDetail from '@/components/MachineDetail'
import { paths } from '@/routes/paths'
import type { MachineHealthRow, MachineState, MachineWorkStats } from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchMachine: vi.fn(),
  fetchMachineHealth: vi.fn(),
  fetchMachineWorkStats: vi.fn(),
  fetchMachineMetrics: vi.fn(),
}))

import { fetchMachine, fetchMachineHealth, fetchMachineMetrics, fetchMachineWorkStats } from '@/api/client'

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

describe('MachineDetail', () => {
  it('renders an unavailable note per section when every endpoint 404s (#61)', async () => {
    vi.mocked(fetchMachine).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })

    renderDetail()

    const notes = await screen.findAllByText(/unavailable — this coord server doesn't serve it yet/)
    // One per section (state, health, work stats, metrics) -- never a single
    // panel-wide failure that would hide which parts are actually missing.
    expect(notes).toHaveLength(4)
  })

  it('renders each section independently when only some endpoints are available', async () => {
    const machine: MachineState = {
      name: 'laptop',
      host: 'laptop.tailnet.ts.net',
      reachable: true,
      last_seen: 1_700_000_000,
      active_assignments: 0,
      headless_workers: 1,
    }
    const health: MachineHealthRow[] = [
      { check: 'disk', status: 'ok', detail: null, checked_at: 1_700_000_000 },
    ]
    vi.mocked(fetchMachine).mockResolvedValue({ available: true, data: machine })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: true, data: health })
    vi.mocked(fetchMachineWorkStats).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineMetrics).mockResolvedValue({ available: false })

    renderDetail()

    expect(await screen.findByText('online')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Health')).getByText('disk')).toBeInTheDocument()
    // The two unavailable sections still say so, distinctly, while state and
    // health render their real data.
    const notes = await screen.findAllByText(/unavailable — this coord server doesn't serve it yet/)
    expect(notes).toHaveLength(2)
  })

  it('renders real work stats and metrics when available', async () => {
    vi.mocked(fetchMachine).mockResolvedValue({ available: false })
    vi.mocked(fetchMachineHealth).mockResolvedValue({ available: false })
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
})
