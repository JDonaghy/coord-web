/**
 * Component tests for LogPanel (#110) — the stage rail + turn stream at
 * `/log/:repo/:issue`.
 *
 * `@/api/client` is mocked entirely, same convention as `Detail.test.tsx`.
 * `@/realtime/connection`'s `createSseConnection` is mocked too — real
 * `EventSource` doesn't exist in jsdom, and `RealtimeProvider`'s own tests
 * establish the precedent that this SSE wrapper is exactly the seam to fake
 * at (a controllable `{start, stop}` handle capturing the `onEvent`/
 * `onStatusChange` callbacks the component wired up), rather than reaching
 * further down to a fake `window.EventSource` the way the E2E suite does —
 * a real browser is what `e2e/log-panel.spec.ts` is for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

import LogPanel from '@/components/LogPanel'
import { type PipelineView } from '@/api/client'
import type { SseConnectionOptions, SseConnection } from '@/realtime/connection'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    fetchPipeline: vi.fn(),
    assignmentLogUrl: (id: string) => `/api/assignment/${id}/log`,
  }
})
import { fetchPipeline } from '@/api/client'

// Captures the most recently constructed connection's options, so a test can
// drive its onEvent/onStatusChange callbacks directly instead of standing up
// a real (or fake) EventSource.
let lastConnectionOptions: SseConnectionOptions | null = null
const fakeConnection: SseConnection = { start: vi.fn(), stop: vi.fn() }

vi.mock('@/realtime/connection', async () => {
  const actual = await vi.importActual<typeof import('@/realtime/connection')>(
    '@/realtime/connection',
  )
  return {
    ...actual,
    createSseConnection: vi.fn((options: SseConnectionOptions) => {
      lastConnectionOptions = options
      return fakeConnection
    }),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  lastConnectionOptions = null
})

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeView(overrides: Partial<PipelineView> = {}): PipelineView {
  return {
    assignment_id: 'work-1',
    issue_number: 42,
    issue_title: 'Fix the thing',
    repo_name: 'myrepo',
    machine_name: 'laptop',
    current_stage: 'coding',
    stages: [
      { name: 'coding', status: 'active', is_current: true },
      { name: 'smoke', status: 'waiting', is_current: false },
      { name: 'review', status: 'waiting', is_current: false },
      { name: 'uat', status: 'waiting', is_current: false },
      { name: 'merge', status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 10,
    review_findings_pending: false,
    review_verdict: null,
    review_verdict_original: null,
    review_verdict_override_reason: null,
    review_findings_body: null,
    test_verdict: null,
    needs_attention: false,
    needs_attention_reason: null,
    needs_attention_detail: null,
    finished_at: null,
    ...overrides,
  }
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false, refetchOnWindowFocus: false },
    },
  })
}

function renderLogPanel(viewOverride?: Partial<PipelineView> | null) {
  const view = viewOverride === null ? null : makeView(viewOverride ?? {})
  vi.mocked(fetchPipeline).mockResolvedValue(view ? [view] : [])

  const queryClient = createTestQueryClient()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/log/myrepo/42']}>
        <Routes>
          <Route path="/log/:repo/:issue" element={<LogPanel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { view, ...utils }
}

/** Emits an `event: log` SSE frame with the given raw NDJSON text chunk. */
function emitLog(text: string) {
  act(() => {
    lastConnectionOptions?.onEvent('log', text)
  })
}

function emitEnd() {
  act(() => {
    lastConnectionOptions?.onEvent('end', {})
  })
}

function assistantLine(text: string, tools: Array<{ name: string; input?: unknown }> = []) {
  const content: unknown[] = [{ type: 'text', text }]
  for (const t of tools) content.push({ type: 'tool_use', name: t.name, input: t.input })
  return JSON.stringify({ type: 'assistant', message: { content } }) + '\n'
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('LogPanel', () => {
  it('renders the stage rail with the not-yet-reached stages reading as neutral, not failed', async () => {
    renderLogPanel()
    await waitFor(() => expect(screen.getByTestId('stage-rail-coding')).toBeInTheDocument())

    expect(screen.getByTestId('stage-rail-coding')).toHaveAttribute('data-stage-current', 'true')
    // Waiting stages must never render as the 'fail' fill — that's reserved
    // for a stage that actually ran and failed, not one merely not reached.
    for (const stage of ['smoke', 'review', 'uat', 'merge']) {
      expect(screen.getByTestId(`stage-rail-${stage}`)).toHaveAttribute('data-stage-fill', 'pending')
    }
  })

  it('shows an honest empty state when the issue has no recorded leg', async () => {
    renderLogPanel(null)
    await waitFor(() => expect(screen.getByTestId('log-not-found')).toBeInTheDocument())
    expect(screen.queryByTestId('log-turn-stream')).not.toBeInTheDocument()
  })

  it('opens the SSE connection at the assignment log URL once the leg resolves', async () => {
    renderLogPanel()
    await waitFor(() => expect(lastConnectionOptions).not.toBeNull())
    expect(lastConnectionOptions?.url).toBe('/api/assignment/work-1/log')
    expect(fakeConnection.start).toHaveBeenCalled()
  })

  it('renders a streamed turn as a numbered marker, its narration, and each tool call on its own line', async () => {
    renderLogPanel()
    await waitFor(() => expect(lastConnectionOptions).not.toBeNull())

    emitLog(
      assistantLine('Investigating the failing test.', [
        { name: 'Bash', input: { command: 'npm test' } },
      ]),
    )

    await waitFor(() => expect(screen.getByTestId('log-entry-turn-1')).toBeInTheDocument())
    const turn = screen.getByTestId('log-entry-turn-1')
    expect(turn).toHaveTextContent('Turn 1')
    expect(turn).toHaveTextContent('Investigating the failing test.')
    expect(turn).toHaveTextContent('Bash')
    expect(turn).toHaveTextContent('npm test')
  })

  it('never drops a rate_limit_event — it renders as a visibly marked inline entry', async () => {
    renderLogPanel()
    await waitFor(() => expect(lastConnectionOptions).not.toBeNull())

    emitLog(
      JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 1893456000 },
      }) + '\n',
    )

    await waitFor(() => expect(screen.getByTestId('log-entry-rate-limit')).toBeInTheDocument())
    expect(screen.getByTestId('log-entry-rate-limit')).toHaveTextContent('[rate_limit]')
    expect(screen.getByTestId('log-entry-rate-limit')).toHaveTextContent('rejected')
  })

  it('reassembles a turn split across two SSE chunks (mid-line boundary)', async () => {
    renderLogPanel()
    await waitFor(() => expect(lastConnectionOptions).not.toBeNull())

    const fullLine = assistantLine('Split across two chunks.')
    const splitAt = Math.floor(fullLine.length / 2)
    emitLog(fullLine.slice(0, splitAt))
    // Nothing should render yet -- the line isn't complete.
    expect(screen.queryByTestId('log-entry-turn-1')).not.toBeInTheDocument()

    emitLog(fullLine.slice(splitAt))
    await waitFor(() => expect(screen.getByTestId('log-entry-turn-1')).toBeInTheDocument())
    expect(screen.getByTestId('log-entry-turn-1')).toHaveTextContent('Split across two chunks.')
  })

  it('shows Finished once the stream sends its terminal `end` event', async () => {
    renderLogPanel()
    await waitFor(() => expect(lastConnectionOptions).not.toBeNull())
    emitEnd()
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /Log stream/ })).toHaveTextContent('Finished'),
    )
  })
})
