/**
 * Component tests for the Milestones panel and its detail view (#91).
 *
 * Mocks `@/api/client`'s two fetchers, same posture `GateAPanel.test.tsx` and
 * `MachinesPanel.test.tsx` use. `e2e/milestones.spec.ts` covers the same
 * surface end to end at both breakpoints and in both themes, against real
 * route mocking; this file is the fast, always-run half.
 *
 * Every degraded state issue #91 names is asserted here, because all three of
 * this repo's white-screen incidents (#76, #84, #85) were degraded states
 * nobody had ever rendered: an absent endpoint, a 404, a shape mismatch, a
 * milestone with no work order, and an empty roster.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import MilestonesPanel from '@/components/MilestonesPanel'
import MilestoneDetailPanel from '@/components/MilestoneDetail'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { ErrorBoundary } from '@/shell/ErrorBoundary'
import type { MilestoneDetail, MilestoneSummaryWire } from '@/api/client'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, fetchMilestones: vi.fn(), fetchMilestoneDetail: vi.fn() }
})

import { fetchMilestoneDetail, fetchMilestones } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
})

function summary(overrides: Partial<MilestoneSummaryWire> = {}): MilestoneSummaryWire {
  return {
    repo_name: 'coord-web',
    milestone_number: 4,
    title: 'Machines panel',
    state: 'open',
    tracking_issue: 68,
    open_issues: 2,
    closed_issues: 6,
    oracle: true,
    has_work_order: true,
    work_order_total: 7,
    work_order_done: 4,
    ready_frontier: 1,
    in_flight: 2,
    blocked: 0,
    needs_you: [],
    ...overrides,
  }
}

function detail(overrides: Partial<MilestoneDetail> = {}): MilestoneDetail {
  return {
    repo_name: 'coord-web',
    milestone_number: 4,
    title: 'Machines panel',
    state: 'open',
    tracking_issue: 68,
    open_issues: 2,
    closed_issues: 6,
    oracle: true,
    has_work_order: true,
    entries: [
      {
        issue_number: 61,
        title: 'Machines API client, types, route and rail entry',
        state: 'closed',
        position: 1,
        after: [],
        group: 'A',
        gates: {
          assignment_id: 'work-61',
          status: 'merged',
          branch: 'issue-61',
          machine_name: 'dellserver',
          test_state: 'passed',
          smoke_test: 'pass',
          review_state: 'done',
          review_verdict: 'approve',
        },
      },
      {
        issue_number: 62,
        title: 'Machines list: reachability, severity, version drift',
        state: 'open',
        position: 2,
        after: [61],
        group: 'B',
        gates: null,
      },
    ],
    gate_a: {
      state: 'approved',
      ok: true,
      contract_sha: 'abcdef1234567',
      reason: null,
      verdict: 'approved',
      actor: 'john',
      recorded_at: 1_700_000_000,
      approved_contract_sha: 'abcdef1234567',
      href: '/api/gate-a/coord-web/68',
    },
    warnings: [],
    ...overrides,
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={['/milestones']}>
          <MilestonesPanel />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

function renderDetail(path = '/milestones/coord-web/4') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/milestones/:repo/:number" element={<MilestoneDetailPanel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MilestonesPanel — roster', () => {
  it('renders both progress scopes for a milestone, as different numbers', async () => {
    vi.mocked(fetchMilestones).mockResolvedValue({
      ok: true,
      data: { milestones: [summary()], warnings: [] },
    })
    renderPanel()
    expect(await screen.findByText('Machines panel')).toBeInTheDocument()
    expect(screen.getByTestId('issue-progress')).toHaveTextContent('6/8 issues closed')
    expect(screen.getByTestId('work-order-progress')).toHaveTextContent('work order 4/7')
  })

  it('badges an oracle-opted milestone and says so only where true', async () => {
    vi.mocked(fetchMilestones).mockResolvedValue({
      ok: true,
      data: {
        milestones: [summary(), summary({ repo_name: 'vimcode', milestone_number: 9, oracle: false })],
        warnings: [],
      },
    })
    renderPanel()
    expect(await screen.findAllByText('Machines panel')).toHaveLength(2)
    expect(screen.getAllByTestId('oracle-badge')).toHaveLength(1)
  })

  it('says "no work order" instead of showing 0/0 as if it were progress', async () => {
    vi.mocked(fetchMilestones).mockResolvedValue({
      ok: true,
      data: {
        milestones: [summary({ has_work_order: false, work_order_total: 0, work_order_done: 0 })],
        warnings: [],
      },
    })
    renderPanel()
    expect(await screen.findByTestId('no-work-order')).toBeInTheDocument()
    expect(screen.queryByTestId('work-order-progress')).not.toBeInTheDocument()
  })

  it('shows a partial roster WITH its warnings, not instead of them', async () => {
    vi.mocked(fetchMilestones).mockResolvedValue({
      ok: true,
      data: {
        milestones: [summary()],
        warnings: ['could not list milestones for JDonaghy/vimcode: gh: rate limited'],
      },
    })
    renderPanel()
    expect(await screen.findByTestId('milestone-warnings')).toHaveTextContent(/rate limited/)
    expect(screen.getByText('Machines panel')).toBeInTheDocument()
  })

  it('renders an explanatory empty state when the endpoint is absent', async () => {
    // The realistic case for weeks after this merges: coord-web deploys on
    // its own timer, ahead of the coord rollout that carries #3072.
    vi.mocked(fetchMilestones).mockResolvedValue({ ok: false, kind: 'absent' })
    renderPanel()
    const note = await screen.findByTestId('milestones-unavailable')
    expect(note).toHaveTextContent(/doesn't serve \/api\/milestones yet/)
  })

  it('distinguishes a handled 404 from an absent endpoint', async () => {
    vi.mocked(fetchMilestones).mockResolvedValue({
      ok: false,
      kind: 'not-found',
      error: "unknown repo 'nope'",
    })
    renderPanel()
    expect(await screen.findByTestId('milestones-unavailable')).toHaveTextContent(/unknown repo/)
  })

  it('renders a shape mismatch as a legible message, never a blank panel (#85)', async () => {
    vi.mocked(fetchMilestones).mockResolvedValue({
      ok: false,
      kind: 'invalid',
      error: 'GET /api/milestones → response.milestones: expected an array',
    })
    renderPanel()
    expect(await screen.findByTestId('milestones-unavailable')).toHaveTextContent(
      /response\.milestones: expected an array/,
    )
  })

  it('renders a real empty roster differently from an absent endpoint', async () => {
    vi.mocked(fetchMilestones).mockResolvedValue({ ok: true, data: { milestones: [], warnings: [] } })
    renderPanel()
    expect(await screen.findByTestId('milestones-empty')).toHaveTextContent('No milestones')
    expect(screen.queryByTestId('milestones-unavailable')).not.toBeInTheDocument()
  })
})

describe('a throw inside the panel cannot blank the SPA (#87)', () => {
  it('is caught by the same ErrorBoundary ShellLayout wraps the list slot in', async () => {
    // Mocked at the *fetcher*, deliberately bypassing `parseMilestoneList`,
    // so this exercises the last line of defence rather than the first: even
    // if validation is ever removed or a future field is read unguarded, the
    // blast radius is this panel, not the whole app. `ShellLayout` wraps the
    // real list slot in this exact component with `label="list"`.
    vi.mocked(fetchMilestones).mockResolvedValue({
      ok: true,
      data: { milestones: null as unknown as MilestoneSummaryWire[], warnings: [] },
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <MemoryRouter initialEntries={['/milestones']}>
            <ErrorBoundary label="list" resetKey="/milestones">
              <MilestonesPanel />
            </ErrorBoundary>
            <p>the rest of the shell</p>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('The list panel hit an error')
    // Everything outside the boundary is untouched — that is the whole point.
    expect(screen.getByText('the rest of the shell')).toBeInTheDocument()
  })
})

describe('MilestoneDetailPanel — the work order', () => {
  it('renders entries in the order received, never re-sorted', async () => {
    const out_of_numeric_order = detail({
      entries: [
        { ...detail().entries[1], issue_number: 62, position: 1 },
        { ...detail().entries[0], issue_number: 61, position: 2 },
      ],
    })
    vi.mocked(fetchMilestoneDetail).mockResolvedValue({ ok: true, data: out_of_numeric_order })
    renderDetail()
    await screen.findByTestId('work-order-entry-62')
    const rendered = screen.getAllByTestId(/^work-order-entry-/).map((el) => el.dataset.testid)
    expect(rendered).toEqual(['work-order-entry-62', 'work-order-entry-61'])
  })

  it('shows each entry’s gate columns, and marks an undispatched one as such', async () => {
    vi.mocked(fetchMilestoneDetail).mockResolvedValue({ ok: true, data: detail() })
    renderDetail()
    const first = await screen.findByTestId('work-order-entry-61')
    expect(first).toHaveTextContent('merged')
    expect(first).toHaveTextContent('passed')
    expect(first).toHaveTextContent('approve')
    const second = screen.getByTestId('work-order-entry-62')
    expect(second).toHaveTextContent('never dispatched')
  })

  it('links across to the Gate-A packet rather than re-rendering the contract', async () => {
    vi.mocked(fetchMilestoneDetail).mockResolvedValue({ ok: true, data: detail() })
    renderDetail()
    const link = await screen.findByTestId('gate-a-link')
    expect(link).toHaveAttribute('href', '/gate-a/coord-web/68')
    expect(screen.getByTestId('gate-a-sha')).toHaveTextContent('abcdef1')
  })

  it('makes a stale sign-off unmissable — an alert, not just a badge', async () => {
    vi.mocked(fetchMilestoneDetail).mockResolvedValue({
      ok: true,
      data: detail({
        gate_a: { ...detail().gate_a!, state: 'stale', approved_contract_sha: 'older99abc' },
      }),
    })
    renderDetail()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/stale/i)
    expect(alert).toHaveTextContent('older99')
    expect(alert).toHaveTextContent('abcdef1')
  })

  it('says a non-oracle repo has no Gate A — a fact, not an error', async () => {
    vi.mocked(fetchMilestoneDetail).mockResolvedValue({
      ok: true,
      data: detail({ oracle: false, gate_a: null }),
    })
    renderDetail()
    expect(await screen.findByTestId('gate-a-none')).toHaveTextContent(/not opted into the oracle loop/)
  })

  it('explains a milestone with no work order instead of showing an empty list', async () => {
    vi.mocked(fetchMilestoneDetail).mockResolvedValue({
      ok: true,
      data: detail({ entries: [], has_work_order: false, tracking_issue: null, gate_a: null }),
    })
    renderDetail()
    expect(await screen.findByTestId('work-order-empty')).toHaveTextContent(/No tracking epic/)
  })

  it('renders an absent endpoint as an explanation, not a white screen', async () => {
    vi.mocked(fetchMilestoneDetail).mockResolvedValue({ ok: false, kind: 'absent' })
    renderDetail()
    expect(await screen.findByTestId('milestone-detail-unavailable')).toHaveTextContent(
      /doesn't serve \/api\/milestones yet/,
    )
  })

  it('rejects a non-numeric milestone segment without ever calling the API', async () => {
    renderDetail('/milestones/coord-web/not-a-number')
    expect(await screen.findByTestId('milestone-detail-unavailable')).toHaveTextContent(
      /not a milestone number/,
    )
    expect(fetchMilestoneDetail).not.toHaveBeenCalled()
  })
})
