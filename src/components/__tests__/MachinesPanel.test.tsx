/**
 * Component tests for `MachinesPanel` (#61, re-wired by #76) — mocking
 * convention matches `SessionsList`'s own coverage posture (no dedicated
 * test file for that one exists yet, so this mirrors `ReportsPanel.test.tsx`/
 * `DriveQueuePanel.test.tsx` instead): `@/api/client` mocked entirely
 * (except the pure `joinMachineSeverity` join, kept real via
 * `importOriginal`), wrapped in QueryClientProvider + MemoryRouter.
 *
 * The one thing this file exists to pin down is issue #61's explicit
 * acceptance bar, unchanged by #76's re-wire onto the real endpoints: a
 * `{available: false}` roster result must render an honest "unavailable"
 * state, distinct from both a loading spinner and a real empty roster --
 * never a crash, and never a silent "0 machines" that reads as a real (if
 * boring) answer instead of "this build can't ask yet."
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

import MachinesPanel from '@/components/MachinesPanel'
import { ThemeProvider } from '@/components/ui/theme-provider'
import type { MachineQueryResult, MachinesHealthResponse, MachineState } from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    fetchMachines: vi.fn(),
    fetchMachinesHealth: vi.fn(),
    fetchFleetCapacity: vi.fn(),
  }
})

import { fetchFleetCapacity, fetchMachines, fetchMachinesHealth } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
  // Unrelated to every test below except the dedicated #66 one -- default to
  // "no fleet-scope checks, no machine severities" so `FleetSummary`'s own
  // presence/absence and the roster's states remain what each test is
  // actually pinning.
  vi.mocked(fetchMachinesHealth).mockResolvedValue({
    available: true,
    data: { schema: 1, refreshed_at: null, machine_health: [], fleet_checks: [], truncated: false },
  })
  vi.mocked(fetchFleetCapacity).mockResolvedValue({ available: true, data: { used: 0, total: null } })
})

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/machines']}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <MachinesPanel />
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

function makeMachine(overrides: Partial<MachineState> = {}): MachineState {
  return {
    name: 'laptop',
    host: 'laptop.tailnet.ts.net',
    state: 'online',
    reason: '',
    latency_ms: 10,
    agent_version: '1.2.3',
    repos: [],
    worktree_bytes: null,
    ...overrides,
  }
}

describe('MachinesPanel', () => {
  it('renders an honest "unavailable" state on {available: false} -- never a crash or a fabricated empty roster', async () => {
    const result: MachineQueryResult<MachineState[]> = { available: false }
    vi.mocked(fetchMachines).mockResolvedValue(result)
    renderPanel()

    expect(await screen.findByText('Machines panel unavailable')).toBeInTheDocument()
    // Not the same DOM as a real empty roster (§ below) -- distinguishable
    // by more than just this string, since a future refactor could
    // accidentally reuse one message for both.
    expect(screen.queryByText('No machines')).not.toBeInTheDocument()
    expect(screen.queryByText(/known$/)).not.toBeInTheDocument()
  })

  it('renders the real empty-roster state distinctly once the API is actually available', async () => {
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [] })
    renderPanel()

    expect(await screen.findByText('No machines')).toBeInTheDocument()
    expect(screen.queryByText('Machines panel unavailable')).not.toBeInTheDocument()
  })

  it('renders the roster and navigates to a machine detail row on click', async () => {
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [makeMachine()] })
    const user = userEvent.setup()
    renderPanel()

    const row = await screen.findByTestId('machine-row-laptop')
    expect(row).toHaveTextContent('laptop')
    expect(row).toHaveTextContent('online')

    await user.click(row)
    // Navigation itself (not asserted on location here -- this render has no
    // route tree to land in) is covered end-to-end by
    // `ShellLayout.test.tsx`'s Machines rail-flip test; this just pins that
    // clicking a row doesn't throw.
  })

  it('renders whatever state string the roster reports, distinctly per row', async () => {
    vi.mocked(fetchMachines).mockResolvedValue({
      available: true,
      data: [makeMachine({ name: 'dellserver', state: 'unreachable' })],
    })
    renderPanel()

    const row = await screen.findByTestId('machine-row-dellserver')
    expect(row).toHaveTextContent('unreachable')
  })

  it('joins severity from /api/machines/health onto the roster by name (#76)', async () => {
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [makeMachine({ name: 'laptop' })] })
    const health: MachinesHealthResponse = {
      schema: 1,
      refreshed_at: 1,
      machine_health: [{ machine: 'laptop', state: 'online', reason: '', severity: 'crit', stale: false, checked_at: 1, results: [] }],
      fleet_checks: [],
      truncated: false,
    }
    vi.mocked(fetchMachinesHealth).mockResolvedValue({ available: true, data: health })
    renderPanel()

    const row = await screen.findByTestId('machine-row-laptop')
    expect(row.querySelector('[data-testid="severity-badge"]')).toHaveTextContent('crit')
  })

  it('renders the fleet summary once the roster loads, and not while empty/unavailable (#66)', async () => {
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [makeMachine()] })
    renderPanel()

    expect(await screen.findByTestId('fleet-summary')).toBeInTheDocument()
  })

  it('does not render a fleet summary over an empty or unavailable roster (#66)', async () => {
    vi.mocked(fetchMachines).mockResolvedValue({ available: true, data: [] })
    renderPanel()

    await screen.findByText('No machines')
    expect(screen.queryByTestId('fleet-summary')).not.toBeInTheDocument()
  })
})
