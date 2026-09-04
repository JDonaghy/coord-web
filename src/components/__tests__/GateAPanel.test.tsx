/**
 * Component tests for GateAPanel — the `/gate-a/:repo/:trackingIssue` review
 * packet (#90). Mocks `@/api/client`'s `fetchGateA`, same posture
 * `SessionDetail.test.tsx` uses for `fetchSessions`.
 *
 * Playwright (`e2e/gate-a.spec.ts`) covers the same stale/not-stale and
 * width-control surface end to end, against real route mocking rather than a
 * mocked module — this file is the fast, always-run half of that coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import GateAPanel from '@/components/GateAPanel'
import { type GateAFetchResult, type GateAPacket } from '@/api/client'
import { paths } from '@/routes/paths'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, fetchGateA: vi.fn() }
})

import { fetchGateA } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
})

function makePacket(overrides: Partial<GateAPacket> = {}): GateAPacket {
  return {
    repo_name: 'coord-portal',
    milestone_number: 4,
    milestone_title: 'ms-4',
    tracking_issue: 200,
    tracking_issue_title: 'ms-4 tracking issue',
    state: 'approved',
    ok: true,
    stale: false,
    contract_sha: 'abcdef1234567890',
    reason: null,
    approval: null,
    contract_markdown: '# ms-4 contract\n\n## Scope\n\nDo the thing.\n',
    mocks: [],
    mocks_note: '',
    ...overrides,
  }
}

function renderPanel(repo = 'coord-portal', trackingIssue = 200) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[paths.gateA(repo, trackingIssue)]}>
        <Routes>
          <Route path="/gate-a/:repo/:trackingIssue" element={<GateAPanel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('GateAPanel', () => {
  it('shows the unmissable stale banner when the packet is stale', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({ state: 'stale', stale: true }),
    } satisfies GateAFetchResult)
    renderPanel()

    const banner = await screen.findByTestId('gate-a-stale-banner')
    expect(banner).toBeVisible()
    expect(banner).toHaveTextContent(/stale/i)
  })

  it('renders no stale banner when the gate is not stale', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({ state: 'approved', stale: false }),
    } satisfies GateAFetchResult)
    renderPanel()

    await screen.findByTestId('gate-a-state-badge')
    expect(screen.queryByTestId('gate-a-stale-banner')).not.toBeInTheDocument()
  })

  it('renders the verdict state and contract sha up front', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({ state: 'changes', contract_sha: 'deadbeefcafefeed1234' }),
    } satisfies GateAFetchResult)
    renderPanel()

    expect(await screen.findByTestId('gate-a-state-badge')).toHaveTextContent(/changes requested/i)
    expect(screen.getByText(/deadbeefcafe/)).toBeInTheDocument()
  })

  it('prints the exact coord gate-a commands, never a submit button (out of scope for this slice)', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({ repo_name: 'coord-portal', tracking_issue: 200 }),
    } satisfies GateAFetchResult)
    renderPanel()

    expect(await screen.findByTestId('gate-a-approved-command')).toHaveTextContent(
      'coord gate-a coord-portal 200 --approved',
    )
    expect(screen.getByTestId('gate-a-changes-command')).toHaveTextContent(
      'coord gate-a coord-portal 200 --changes --note "..."',
    )
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('surfaces a ## Amendment section in a quick-nav list rather than leaving it buried', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({
        contract_markdown: '# ms-4\n\n## Scope\n\nBody.\n\n## Amendment 1: header reflow at 390px\n\nFixed it.\n',
      }),
    } satisfies GateAFetchResult)
    renderPanel()

    const nav = await screen.findByTestId('gate-a-amendment-nav')
    expect(within(nav).getByText('Amendment 1: header reflow at 390px')).toBeInTheDocument()
  })

  it('renders no amendment nav for a contract with no amendments', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({ contract_markdown: '# ms-4\n\n## Scope\n\nBody.\n' }),
    } satisfies GateAFetchResult)
    renderPanel()

    await screen.findByTestId('gate-a-state-badge')
    expect(screen.queryByTestId('gate-a-amendment-nav')).not.toBeInTheDocument()
  })

  it('renders every mock in its own frame, each independently reachable by name', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({
        mocks: [
          { name: 'home.html', title: 'Home', html: '<html><body>home</body></html>' },
          { name: 'detail.html', title: 'Detail', html: '<html><body>detail</body></html>' },
        ],
      }),
    } satisfies GateAFetchResult)
    renderPanel()

    expect(await screen.findByTestId('gate-a-mock-home.html')).toBeInTheDocument()
    expect(screen.getByTestId('gate-a-mock-detail.html')).toBeInTheDocument()
    expect(screen.getByTestId('gate-a-mock-frame-home.html')).toBeInTheDocument()
  })

  it('shows the server mocks_note instead of an empty grid when there are no mocks', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({ mocks: [], mocks_note: 'not viewable from this driver' }),
    } satisfies GateAFetchResult)
    renderPanel()

    expect(await screen.findByTestId('gate-a-mocks-empty')).toHaveTextContent('not viewable from this driver')
  })

  it('the width control switches the mock iframe width, defaulting to full', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: true,
      data: makePacket({
        mocks: [{ name: 'home.html', title: 'Home', html: '<html><body>home</body></html>' }],
      }),
    } satisfies GateAFetchResult)
    renderPanel()

    const frame = await screen.findByTestId('gate-a-mock-frame-home.html')
    expect(frame).toHaveStyle({ width: '100%' })

    await user.click(screen.getByTestId('gate-a-width-phone'))
    expect(frame).toHaveStyle({ width: '390px' })

    await user.click(screen.getByTestId('gate-a-width-tablet'))
    expect(frame).toHaveStyle({ width: '768px' })
  })

  it('renders a legible 404 (e.g. "no milestone") instead of a generic error', async () => {
    vi.mocked(fetchGateA).mockResolvedValue({
      ok: false,
      status: 404,
      error: 'coord-portal#9999 has no milestone — Gate A is a milestone-level gate',
    } satisfies GateAFetchResult)
    renderPanel('coord-portal', 9999)

    expect(await screen.findByTestId('gate-a-fetch-error')).toHaveTextContent(/has no milestone/)
  })
})
