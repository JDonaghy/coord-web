/**
 * Component tests for SessionDetail — the `/sessions/:id` detail panel.
 *
 * `ShellLayout.test.tsx` mounts this component through the real shell but
 * only ever asserts on `issue_title` ("Live session issue"); nothing in the
 * suite exercises the aliased `repo#issue` ref this component renders
 * (#46 review finding, site 2 of 8). These tests mock `@/api/client` and
 * wrap the render in a MemoryRouter at `/sessions/:id` so `useParams` /
 * `useNavigate` resolve, the same shape `Detail.test.tsx` uses for `Detail`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import SessionDetail from '@/components/SessionDetail'
import { type SessionInfo } from '@/api/client'
import { paths } from '@/routes/paths'

vi.mock('@/api/client', () => ({
  fetchSessions: vi.fn(),
}))

import { fetchSessions } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    session_id: 'sess-1',
    session_name: 'coord-sess-1',
    machine: 'laptop',
    host: 'laptop.tailnet.ts.net',
    repo: 'myrepo',
    issue: 42,
    issue_title: 'Fix the thing',
    stage: 'work',
    status: 'running',
    attached: false,
    pane_dead: false,
    ...overrides,
  }
}

function renderSessionDetail(sessionId = 'sess-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[paths.session(sessionId)]}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SessionDetail', () => {
  it('renders the aliased repo#issue ref (#46), never the spelled-out repo name', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([makeSession()])
    renderSessionDetail()

    // 'myrepo' aliases to 'M' -- the ref renders as one 'M#42' unit, never
    // 'myrepo #42', 'myrepo#42', or 'M #42'.
    expect(await screen.findByText('M#42')).toBeInTheDocument()
    expect(screen.queryByText(/myrepo/)).not.toBeInTheDocument()
  })

  it('falls back to the plain repo name when the session has no issue', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([
      makeSession({ repo: 'quadraui', issue: null }),
    ])
    renderSessionDetail()

    expect(await screen.findByText('quadraui')).toBeInTheDocument()
  })

  it('renders neither repo nor issue when the session has no assignment', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([
      makeSession({ repo: null, issue: null, machine: 'dellserver' }),
    ])
    renderSessionDetail()

    expect(await screen.findByText('dellserver')).toBeInTheDocument()
    expect(screen.queryByText(/#/)).not.toBeInTheDocument()
  })
})
