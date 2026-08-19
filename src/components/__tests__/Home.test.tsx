/**
 * Component tests for the Home screen's "Live sessions" section (#1067) and
 * the Active tab's in-progress/done grouping (#1218).
 *
 * Mocks @/api/client entirely; wraps renders in a QueryClientProvider +
 * MemoryRouter so useQuery / useNavigate work correctly, matching
 * Detail.test.tsx's pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Home from '@/components/Home'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { type PipelineView, type SessionInfo } from '@/api/client'

// ── Mock API client + navigate ────────────────────────────────────────────────

vi.mock('@/api/client', () => ({
  fetchPipeline: vi.fn(),
  fetchSessions: vi.fn(),
}))

import { fetchPipeline, fetchSessions } from '@/api/client'

const navigateSpy = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateSpy }
})

beforeEach(() => {
  vi.clearAllMocks()
})

// Unconditionally restore the real clock between tests. One test below pins
// `Date` with `vi.setSystemTime` to make its relative-time labels
// deterministic; doing the restore *inline* at the end of that test means an
// earlier assertion failure skips it and leaks a fake "now" into every
// subsequent test in the file. That mattered once for real: the pinned clock
// sits ~5 months ahead of the wall clock, and the staleness suite below
// builds its fixtures from `Date.now()` at module load — so a single failure
// up there silently aged every "2 hours ago" fixture past the 24h staleness
// window and cascaded into two unrelated red tests. Cheap to make
// unconditional; a no-op when timers were never faked.
afterEach(() => {
  vi.useRealTimers()
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
      { name: 'review', status: 'waiting', is_current: false },
      { name: 'smoke', status: 'waiting', is_current: false },
      { name: 'merge', status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 10,
    review_findings_pending: false,
    review_verdict: null,
    // #1456: null = the reviewer's own verdict stands (the normal case).
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

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    session_id: 'work-2',
    session_name: 'coord-work-2',
    machine: 'desktop',
    host: 'desktop.tailnet.ts.net',
    repo: 'otherrepo',
    issue: 7,
    issue_title: 'Live session issue',
    stage: 'work',
    status: 'running',
    attached: false,
    pane_dead: false,
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

function renderHome() {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Home />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

// ── Live sessions section ─────────────────────────────────────────────────────

describe('Home — live sessions section', () => {
  it('renders live session cards above the pipeline list', async () => {
    vi.mocked(fetchPipeline).mockResolvedValue([makeView()])
    vi.mocked(fetchSessions).mockResolvedValue([makeSession()])

    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Live sessions')).toBeInTheDocument()
    })
    expect(screen.getByText('Live session issue')).toBeInTheDocument()

    // The "Live sessions" heading appears before the pipeline card in DOM order.
    const heading = screen.getByText('Live sessions')
    const pipelineCard = screen.getByText('Fix the thing')
    expect(
      heading.compareDocumentPosition(pipelineCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders no "Live sessions" heading when there are no live sessions', async () => {
    vi.mocked(fetchPipeline).mockResolvedValue([makeView()])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Fix the thing')).toBeInTheDocument()
    })
    expect(screen.queryByText('Live sessions')).not.toBeInTheDocument()
  })

  it('navigates to /terminal/:sessionId when a session card is tapped', async () => {
    vi.mocked(fetchPipeline).mockResolvedValue([])
    vi.mocked(fetchSessions).mockResolvedValue([makeSession()])

    renderHome()

    const card = await screen.findByText('Live session issue')
    await userEvent.click(card)

    expect(navigateSpy).toHaveBeenCalledWith('/terminal/work-2')
  })
})

// ── Active tab: in-progress/done grouping (#1218) ───────────────────────────────

describe('Home — Active tab grouping', () => {
  // #2 review fixup: this used to assert needs-me-first order regardless of
  // recency (the pre-#2 behavior). That's exactly the mechanism the issue
  // flagged as broken — a needs-me item with no timestamp advantage still
  // outranked live work — so it now asserts the corrected, recency-first
  // order: an item that's actively running right now outranks a needs-me
  // item with no recency signal of its own (see `recencyValue` in Home.tsx).
  it('renders in-progress items expanded, running ahead of a needs-me item with no recency signal', async () => {
    // Incoming (API) order deliberately scrambled: needs-me item first, then
    // a running item — expect the running item to sort first regardless.
    const needsMe = makeView({
      assignment_id: 'a-needs-me',
      issue_number: 2,
      issue_title: 'Failed item needing retry',
      current_stage: 'failed',
      available_gates: [{ action: 'retry', label: 'Retry', endpoint: '/api/pipeline/action' }],
    })
    const running = makeView({
      assignment_id: 'a-running',
      issue_number: 1,
      issue_title: 'Running item',
      current_stage: 'coding',
      available_gates: [],
    })
    vi.mocked(fetchPipeline).mockResolvedValue([needsMe, running])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const runningCard = await screen.findByText('Running item')
    const needsMeCard = screen.getByText('Failed item needing retry')
    expect(
      runningCard.compareDocumentPosition(needsMeCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('collapses done-ish items into a "Work done (N)" section by default', async () => {
    const running = makeView({
      assignment_id: 'a-running',
      issue_number: 1,
      issue_title: 'Running item',
      current_stage: 'coding',
    })
    const done1 = makeView({
      assignment_id: 'a-done-1',
      issue_number: 2,
      issue_title: 'Finished thing one',
      current_stage: 'done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: 100,
    })
    const done2 = makeView({
      assignment_id: 'a-done-2',
      issue_number: 3,
      issue_title: 'Finished thing two',
      current_stage: 'review_done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: 200,
    })
    vi.mocked(fetchPipeline).mockResolvedValue([running, done1, done2])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    await waitFor(() => {
      expect(screen.getByText('Running item')).toBeInTheDocument()
    })

    // Collapsed by default: header with count shown, done cards not rendered.
    expect(screen.getByText('Work done (2)')).toBeInTheDocument()
    expect(screen.queryByText('Finished thing one')).not.toBeInTheDocument()
    expect(screen.queryByText('Finished thing two')).not.toBeInTheDocument()
  })

  it('expands the Work done section on tap, sorted by recency descending', async () => {
    const older = makeView({
      assignment_id: 'a-done-older',
      issue_number: 1,
      issue_title: 'Older done item',
      current_stage: 'done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: 100,
    })
    const newer = makeView({
      assignment_id: 'a-done-newer',
      issue_number: 2,
      issue_title: 'Newer done item',
      current_stage: 'smoke_passed',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: 200,
    })
    vi.mocked(fetchPipeline).mockResolvedValue([older, newer])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const toggle = await screen.findByText('Work done (2)')
    await userEvent.click(toggle)

    const newerCard = await screen.findByText('Newer done item')
    const olderCard = await screen.findByText('Older done item')
    expect(
      newerCard.compareDocumentPosition(olderCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('shows a relative-time label per card in the expanded Work done section (#1218 follow-up)', async () => {
    // Fixed "now" so labels are deterministic regardless of wall-clock time.
    const now = 1_800_000_000_000
    vi.setSystemTime(now)

    // Distinct issue numbers: since #2 the Active list collapses to one card
    // per (repo, issue) — two fixtures both riding `makeView`'s default
    // issue_number would be *one* issue's two assignment rows, so only the
    // last would render and this test's "a label per card" premise would be
    // silently untestable ("Work done (1)").
    const threeHoursAgo = makeView({
      assignment_id: 'a-done-3h',
      issue_number: 1,
      issue_title: 'Finished three hours ago',
      current_stage: 'done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: now / 1000 - 3 * 60 * 60,
    })
    const twoDaysAgo = makeView({
      assignment_id: 'a-done-2d',
      issue_number: 2,
      issue_title: 'Finished two days ago',
      current_stage: 'review_done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: now / 1000 - 2 * 24 * 60 * 60,
    })
    vi.mocked(fetchPipeline).mockResolvedValue([threeHoursAgo, twoDaysAgo])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const toggle = await screen.findByText('Work done (2)')
    await userEvent.click(toggle)

    expect(await screen.findByText('3h ago')).toBeInTheDocument()
    expect(screen.getByText('2d ago')).toBeInTheDocument()
    // The clock is restored by the file-level `afterEach`, not here — see the
    // comment on it.
  })

  it('keeps the "Needs me" tab as a flat, ungrouped list', async () => {
    const done = makeView({
      assignment_id: 'a-done',
      issue_title: 'Finished needing merge',
      current_stage: 'done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: 100,
    })
    vi.mocked(fetchPipeline).mockResolvedValue([done])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const tab = await screen.findByRole('tab', { name: /Needs me/i })
    await userEvent.click(tab)

    // Rendered directly — no collapsed "Work done" wrapper on this tab.
    expect(await screen.findByText('Finished needing merge')).toBeInTheDocument()
    expect(screen.queryByText(/Work done \(/)).not.toBeInTheDocument()
  })
})

// ── Active tab: staleness filter, API-order preservation, per-issue grouping (#2) ──

describe('Home — Active tab staleness/order/grouping (#2)', () => {
  // Real, relative-to-now timestamps rather than `vi.useFakeTimers` +
  // `vi.setSystemTime`: `isActive` (src/lib/pipeline.ts) defaults to the
  // real `Date.now()`, and Terminal.test.tsx's reconnect-resilience suite
  // already documents that this repo's `waitFor`/`findBy*` polling relies on
  // real timers and stalls under a faked clock — not worth fighting here.
  const nowSec = Date.now() / 1000
  const daysAgoSec = (days: number) => nowSec - days * 24 * 60 * 60

  it('excludes a card whose failed run finished more than the staleness window ago', async () => {
    // Mirrors #2's screenshot repro: current_stage "failed", finished_at 34
    // days ago — must not appear in Active at all, not just be reprioritized.
    const staleFailed = makeView({
      assignment_id: 'a-stale-failed',
      issue_number: 772,
      issue_title: 'Milestone workflow — Phase 4',
      current_stage: 'failed',
      finished_at: daysAgoSec(34),
      available_gates: [{ action: 'retry', label: 'Retry', endpoint: '/api/pipeline/action' }],
    })
    const live = makeView({
      assignment_id: 'a-live',
      issue_number: 1960,
      issue_title: 'That night’s actively-driving work',
      current_stage: 'coding',
    })
    vi.mocked(fetchPipeline).mockResolvedValue([staleFailed, live])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    await waitFor(() => {
      expect(screen.getByText('That night’s actively-driving work')).toBeInTheDocument()
    })
    expect(screen.queryByText('Milestone workflow — Phase 4')).not.toBeInTheDocument()
  })

  it('renders the most recently active item first even when a stale item leads the API order', async () => {
    // API order deliberately mirrors #2: the stale failure is first in the
    // response, live work is second — the rendered order must not put the
    // stale item on top.
    const staleFailed = makeView({
      assignment_id: 'a-stale-failed',
      issue_number: 772,
      issue_title: 'Old failure',
      current_stage: 'failed',
      finished_at: daysAgoSec(34),
      available_gates: [{ action: 'retry', label: 'Retry', endpoint: '/api/pipeline/action' }],
    })
    const live = makeView({
      assignment_id: 'a-live',
      issue_number: 1960,
      issue_title: 'Newest live work',
      current_stage: 'coding',
    })
    vi.mocked(fetchPipeline).mockResolvedValue([staleFailed, live])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const section = await screen.findByRole('region', { name: 'Active items' })
    const cards = within(section).getAllByRole('button')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Newest live work')
  })

  // The above test can't distinguish "sorted by recency" from "sorted by
  // needs-me priority": the competing item is filtered out by staleness
  // entirely, leaving one card either way. This test pins the general case
  // with two *surviving* (non-stale) items where recency and needs-me
  // priority disagree — a failed item with a retry gate that finished
  // recently (inside the staleness window, so not filtered) vs. an item
  // that's actively running right now. Per `recencyValue` (Home.tsx), a
  // currently-running item is always most recent, so it renders first even
  // though the needs-me item's failure is the more recently *timestamped*
  // event of the two.
  it('ranks a currently-running item ahead of a non-stale needs-me item, regardless of which finished more recently', async () => {
    const recentlyFailed = makeView({
      assignment_id: 'a-recently-failed',
      issue_number: 772,
      issue_title: 'Failed two hours ago',
      current_stage: 'failed',
      finished_at: daysAgoSec(2 / 24), // 2 hours ago — inside the 24h window
      available_gates: [{ action: 'retry', label: 'Retry', endpoint: '/api/pipeline/action' }],
    })
    const runningNow = makeView({
      assignment_id: 'a-running-now',
      issue_number: 1960,
      issue_title: 'Started seconds ago',
      current_stage: 'coding',
    })
    // API order deliberately mirrors #2's repro: the needs-me item leads.
    vi.mocked(fetchPipeline).mockResolvedValue([recentlyFailed, runningNow])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const section = await screen.findByRole('region', { name: 'Active items' })
    const cards = within(section).getAllByRole('button')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Started seconds ago')
    expect(cards[1]).toHaveTextContent('Failed two hours ago')
  })

  it('orders two non-running Active items by recency when neither is currently running', async () => {
    const olderFailure = makeView({
      assignment_id: 'a-older-failure',
      issue_number: 5,
      issue_title: 'Failed six hours ago',
      current_stage: 'failed',
      finished_at: daysAgoSec(6 / 24),
      available_gates: [{ action: 'retry', label: 'Retry', endpoint: '/api/pipeline/action' }],
    })
    const newerFailure = makeView({
      assignment_id: 'a-newer-failure',
      issue_number: 6,
      issue_title: 'Failed one hour ago',
      current_stage: 'review_failed',
      finished_at: daysAgoSec(1 / 24),
      available_gates: [{ action: 'dispatch_fix', label: 'Fix', endpoint: '/api/pipeline/action' }],
    })
    // API order deliberately puts the older one first.
    vi.mocked(fetchPipeline).mockResolvedValue([olderFailure, newerFailure])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const section = await screen.findByRole('region', { name: 'Active items' })
    const cards = within(section).getAllByRole('button')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Failed one hour ago')
    expect(cards[1]).toHaveTextContent('Failed six hours ago')
  })

  it('renders exactly one Active card for an issue with a rework cycle (two work rows)', async () => {
    // Mirrors #1930: a request-changes attempt followed by its approve fix-1.
    const requestChanges = makeView({
      assignment_id: 'review-1',
      issue_number: 1930,
      issue_title: 'Rework cycle issue',
      current_stage: 'review_failed',
      available_gates: [{ action: 'dispatch_fix', label: 'Fix', endpoint: '/api/pipeline/action' }],
    })
    const approveFix = makeView({
      assignment_id: 'review-2',
      issue_number: 1930,
      issue_title: 'Rework cycle issue',
      current_stage: 'coding',
    })
    vi.mocked(fetchPipeline).mockResolvedValue([requestChanges, approveFix])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const cards = await screen.findAllByText('Rework cycle issue')
    expect(cards).toHaveLength(1)
  })

  it('collapses two done-ish rows for one issue into a single "Work done" card', async () => {
    // The per-issue collapse is applied upstream of the in-progress/done-ish
    // split, so it has to hold on the "Work done" path too — not just the
    // expanded in-progress list the test above covers. Regression pin: the
    // #1218-follow-up test in the sibling suite reads a *count* out of this
    // section's header, so a collapse that only ran on the in-progress
    // branch would show up there as a confusing off-by-one rather than as a
    // failure that names the real rule.
    const firstAttempt = makeView({
      assignment_id: 'done-1',
      issue_number: 1930,
      issue_title: 'Done twice issue',
      current_stage: 'done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: daysAgoSec(2 / 24),
    })
    const secondAttempt = makeView({
      assignment_id: 'done-2',
      issue_number: 1930,
      issue_title: 'Done twice issue',
      current_stage: 'review_done',
      available_gates: [{ action: 'enqueue', label: 'Queue', endpoint: '/api/pipeline/action' }],
      finished_at: daysAgoSec(1 / 24),
    })
    vi.mocked(fetchPipeline).mockResolvedValue([firstAttempt, secondAttempt])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    const toggle = await screen.findByText('Work done (1)')
    await userEvent.click(toggle)

    expect(await screen.findAllByText('Done twice issue')).toHaveLength(1)
  })

  it('header count equals the number of rendered Active cards', async () => {
    const running = makeView({
      assignment_id: 'a-running',
      issue_number: 1,
      issue_title: 'Running item',
      current_stage: 'coding',
    })
    // Two rows, same issue — collapses to one card.
    const reworkOld = makeView({
      assignment_id: 'a-rework-old',
      issue_number: 2,
      issue_title: 'Reworked item',
      current_stage: 'review_failed',
    })
    const reworkNew = makeView({
      assignment_id: 'a-rework-new',
      issue_number: 2,
      issue_title: 'Reworked item',
      current_stage: 'coding',
    })
    // A stale failure — excluded entirely.
    const staleFailed = makeView({
      assignment_id: 'a-stale',
      issue_number: 3,
      issue_title: 'Stale failure',
      current_stage: 'failed',
      finished_at: daysAgoSec(34),
    })
    vi.mocked(fetchPipeline).mockResolvedValue([running, reworkOld, reworkNew, staleFailed])
    vi.mocked(fetchSessions).mockResolvedValue([])

    renderHome()

    // Two distinct issues survive (issue 1, issue 2); issue 3 is stale.
    await waitFor(() => {
      expect(screen.getByText('2 tracked')).toBeInTheDocument()
    })
    const section = screen.getByRole('region', { name: 'Active items' })
    expect(within(section).getAllByRole('button')).toHaveLength(2)
  })
})
