/**
 * Tests for the Board panel (#101) — the tree/detail split, the number/ref
 * filter, and the pure helpers in `src/lib/board.ts` that back both.
 *
 * Mocks `@/api/client`'s fetchers, same posture `MilestonesPanel.test.tsx`
 * and `GateAPanel.test.tsx` use. `e2e/board.spec.ts` covers the same surface
 * end to end against real route mocking; this file is the fast, always-run
 * half.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import BoardPanel from '@/components/BoardPanel'
import BoardDetail from '@/components/BoardDetail'
import { ThemeProvider } from '@/components/ui/theme-provider'
import {
  boardIssuesFromDriveQueue,
  filterBoardGroups,
  groupBoardIssuesByRepo,
  parseBoardFilter,
} from '@/lib/board'
import type { BoardDriveQueueEntry, DriveQueueData, IssueDetailFetchResult, IssueDetailWire } from '@/api/client'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, fetchDriveQueue: vi.fn(), fetchIssueDetail: vi.fn() }
})

import { fetchDriveQueue, fetchIssueDetail } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

function queueEntry(overrides: Partial<BoardDriveQueueEntry> = {}): BoardDriveQueueEntry {
  return {
    id: 1,
    repo_name: 'format-converter',
    issue_number: 2,
    position: 0,
    machine: null,
    after_json: [],
    state: 'blocked',
    attempts: 0,
    deferrals: 0,
    last_reason: '',
    reason_at: null,
    session_name: null,
    launched_at: null,
    enqueued_at: 1_700_000_000,
    hold_after: 0,
    hold_reason: '',
    resume_when: '',
    hold_state: '',
    hold_probes: 0,
    launch_host: 'dellserver',
    hold_scope: 'entry',
    resumes: 0,
    retry_backoff_at: null,
    ...overrides,
  }
}

function driveQueueData(overrides: Partial<DriveQueueData> = {}): DriveQueueData {
  const entries = overrides.entries ?? [
    queueEntry({ id: 1, repo_name: 'format-converter', issue_number: 2, state: 'blocked' }),
    queueEntry({ id: 2, repo_name: 'format-converter', issue_number: 3, state: 'blocked' }),
    queueEntry({ id: 3, repo_name: 'claude-coordinator', issue_number: 42, state: 'waiting' }),
  ]
  return {
    entries,
    summary: { level: 'ok', pending: 0, running: 0, waiting: 1, blocked: 2, eligible: 0, held: 0, fleet_held: 0 },
    titles: overrides.titles ?? {
      'format-converter#2': 'Cloudflare Pages scaffold: static, no-Access, strict no-egress CSP',
      'format-converter#3': 'YAML <-> JSON conversion engine with positioned error reporting',
      'claude-coordinator#42': 'Some coordinator issue',
    },
    ...overrides,
  }
}

function issueDetail(overrides: Partial<IssueDetailWire> = {}): IssueDetailWire {
  return {
    repo_name: 'format-converter',
    number: 3,
    title: 'YAML <-> JSON conversion engine with positioned error reporting',
    body: '## What\n\nParse YAML and emit positioned errors.',
    state: 'open',
    labels: [],
    milestone_number: null,
    milestone_title: null,
    html_url: 'https://github.com/JDonaghy/format-converter/issues/3',
    ...overrides,
  }
}

function issueOk(overrides: Partial<IssueDetailWire> = {}): IssueDetailFetchResult {
  return { ok: true, data: issueDetail(overrides) }
}

function issueNotFound(error = 'unknown issue'): IssueDetailFetchResult {
  return { ok: false, status: 404, error }
}

function renderPanel(initialEntries: string[] = ['/board']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/board" element={<BoardPanel />} />
            <Route path="/board/:repo/:issue" element={<div data-testid="jumped-detail" />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

function renderDetail(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/board/:repo/:issue" element={<BoardDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── pure helpers ─────────────────────────────────────────────────────────────

describe('board.ts — pure helpers', () => {
  it('boardIssuesFromDriveQueue drops entries with no title-map hit', () => {
    const entries = [
      queueEntry({ repo_name: 'a', issue_number: 1 }),
      queueEntry({ repo_name: 'a', issue_number: 2 }),
    ]
    const rows = boardIssuesFromDriveQueue(entries, { 'a#1': 'Has a title' })
    expect(rows).toEqual([{ repo: 'a', number: 1, title: 'Has a title', queueState: 'blocked' }])
  })

  it('groupBoardIssuesByRepo sorts repos alphabetically and issues by number', () => {
    const rows = boardIssuesFromDriveQueue(
      [
        queueEntry({ repo_name: 'zeta', issue_number: 5 }),
        queueEntry({ repo_name: 'alpha', issue_number: 9 }),
        queueEntry({ repo_name: 'alpha', issue_number: 2 }),
      ],
      { 'zeta#5': 'z', 'alpha#9': 'a9', 'alpha#2': 'a2' },
    )
    const groups = groupBoardIssuesByRepo(rows)
    expect(groups.map((g) => g.repo)).toEqual(['alpha', 'zeta'])
    expect(groups[0].issues.map((i) => i.number)).toEqual([2, 9])
  })

  it('parseBoardFilter reads a bare number as a number filter', () => {
    expect(parseBoardFilter('3', ['format-converter'])).toEqual({ kind: 'number', value: 3 })
  })

  it('parseBoardFilter resolves an alias ref (FC#3) to the repo it aliases', () => {
    expect(parseBoardFilter('FC#3', ['format-converter'])).toEqual({
      kind: 'ref',
      repo: 'format-converter',
      number: 3,
    })
  })

  it('parseBoardFilter resolves a full repo-name ref (format-converter#3)', () => {
    expect(parseBoardFilter('format-converter#3', ['format-converter'])).toEqual({
      kind: 'ref',
      repo: 'format-converter',
      number: 3,
    })
  })

  it('parseBoardFilter falls back to a text filter for an unresolvable ref', () => {
    expect(parseBoardFilter('nonesuch#3', ['format-converter'])).toEqual({
      kind: 'text',
      value: 'nonesuch#3',
    })
  })

  it('filterBoardGroups narrows every repo to a matching issue number', () => {
    const groups = [
      { repo: 'a', issues: [{ repo: 'a', number: 3, title: 't1', queueState: 'blocked' }] },
      { repo: 'b', issues: [{ repo: 'b', number: 3, title: 't2', queueState: 'blocked' }] },
      { repo: 'c', issues: [{ repo: 'c', number: 4, title: 't3', queueState: 'blocked' }] },
    ]
    const filtered = filterBoardGroups(groups, { kind: 'number', value: 3 })
    expect(filtered.map((g) => g.repo)).toEqual(['a', 'b'])
  })

})

// ── BoardPanel ───────────────────────────────────────────────────────────────

describe('BoardPanel', () => {
  it('renders a repo tree, collapsed by default', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    renderPanel()

    await screen.findByText('format-converter')
    expect(screen.getByText('claude-coordinator')).toBeInTheDocument()
    // Collapsed: no issue rows visible until a group is expanded.
    expect(screen.queryByTestId('board-issue-format-converter-2')).not.toBeInTheDocument()
  })

  it('expands a repo group on click and shows its issues', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    renderPanel()

    const group = await screen.findByTestId('board-group-format-converter')
    fireEvent.click(group)

    expect(await screen.findByTestId('board-issue-format-converter-2')).toHaveTextContent(
      'Cloudflare Pages scaffold',
    )
    expect(screen.getByTestId('board-issue-format-converter-3')).toHaveTextContent(
      'YAML <-> JSON conversion engine',
    )
  })

  it('remembers an expanded group across a remount (#101 "remember across navigation")', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    const { unmount } = renderPanel()
    const group = await screen.findByTestId('board-group-format-converter')
    fireEvent.click(group)
    await screen.findByTestId('board-issue-format-converter-2')
    unmount()

    renderPanel()
    expect(await screen.findByTestId('board-issue-format-converter-2')).toBeInTheDocument()
  })

  it('a bare number narrows every repo to that issue number', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      driveQueueData({
        entries: [
          queueEntry({ id: 1, repo_name: 'format-converter', issue_number: 3 }),
          queueEntry({ id: 2, repo_name: 'claude-coordinator', issue_number: 3 }),
          queueEntry({ id: 3, repo_name: 'claude-coordinator', issue_number: 42 }),
        ],
        titles: {
          'format-converter#3': 'YAML thing',
          'claude-coordinator#3': 'Coordinator thing',
          'claude-coordinator#42': 'Some coordinator issue',
        },
      }),
    )
    renderPanel()
    await screen.findByText('format-converter')

    fireEvent.change(screen.getByTestId('board-filter-input'), { target: { value: '3' } })

    expect(await screen.findByTestId('board-issue-format-converter-3')).toBeInTheDocument()
    expect(screen.getByTestId('board-issue-claude-coordinator-3')).toBeInTheDocument()
    expect(screen.queryByTestId('board-issue-claude-coordinator-42')).not.toBeInTheDocument()
  })

  it('typing an alias ref (FC#3) jumps straight to that issue', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    renderPanel()
    await screen.findByText('format-converter')

    fireEvent.change(screen.getByTestId('board-filter-input'), { target: { value: 'FC#3' } })

    await waitFor(() => expect(screen.getByTestId('jumped-detail')).toBeInTheDocument())
  })

  it('renders an honest empty state when no queue entries carry a title', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData({ entries: [], titles: {} }))
    renderPanel()
    expect(await screen.findByTestId('board-empty')).toBeInTheDocument()
  })

  it('renders a retry control on a fetch failure', async () => {
    vi.mocked(fetchDriveQueue).mockRejectedValue(new Error('boom'))
    renderPanel()
    expect(await screen.findByText('Failed to load the board')).toBeInTheDocument()
  })
})

// ── BoardDetail ──────────────────────────────────────────────────────────────

describe('BoardDetail', () => {
  it('renders the body from GET /api/issue for a dispatched issue (no regression)', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    vi.mocked(fetchIssueDetail).mockResolvedValue(issueOk({ repo_name: 'format-converter', number: 3 }))
    renderDetail('/board/format-converter/3')

    expect(await screen.findByTestId('board-detail-title')).toHaveTextContent(
      'YAML <-> JSON conversion engine with positioned error reporting',
    )
    expect(await screen.findByText('Parse YAML and emit positioned errors.')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-queue-state')).toHaveTextContent('blocked')
  })

  it('renders the full body for a never-dispatched issue (#107)', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    vi.mocked(fetchIssueDetail).mockResolvedValue(
      issueOk({
        repo_name: 'format-converter',
        number: 2,
        title: 'Cloudflare Pages scaffold: static, no-Access, strict no-egress CSP',
        body: '## What\n\nStatic scaffold, no Access, strict no-egress CSP.',
        html_url: 'https://github.com/JDonaghy/format-converter/issues/2',
      }),
    )
    renderDetail('/board/format-converter/2')

    expect(await screen.findByText('Static scaffold, no Access, strict no-egress CSP.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github.com\/JDonaghy\/format-converter\/issues\/2/ })).toHaveAttribute(
      'href',
      'https://github.com/JDonaghy/format-converter/issues/2',
    )
  })

  it('renders GitHub state and labels straight from the endpoint', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    vi.mocked(fetchIssueDetail).mockResolvedValue(
      issueOk({ state: 'closed', labels: ['area:parser', 'good-first-issue'] }),
    )
    renderDetail('/board/format-converter/3')

    expect(await screen.findByTestId('board-detail-github-state')).toHaveTextContent('closed')
    expect(screen.getByTestId('board-detail-label-area:parser')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-label-good-first-issue')).toBeInTheDocument()
  })

  it('links to the owner/repo slug even when it differs from the coord repo name', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData({ entries: [], titles: {} }))
    vi.mocked(fetchIssueDetail).mockResolvedValue(
      issueOk({
        repo_name: 'claude-coordinator',
        number: 3194,
        title: '#3194',
        html_url: 'https://github.com/JDonaghy/code-coordinator/issues/3194',
      }),
    )
    renderDetail('/board/claude-coordinator/3194')

    expect(
      await screen.findByRole('link', { name: /github.com\/JDonaghy\/code-coordinator\/issues\/3194/ }),
    ).toHaveAttribute('href', 'https://github.com/JDonaghy/code-coordinator/issues/3194')
  })

  it('renders an honest empty state, not a crash, for an issue the store has never synced', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    vi.mocked(fetchIssueDetail).mockResolvedValue(issueNotFound("unknown issue 'format-converter#999'"))
    renderDetail('/board/format-converter/999')

    expect(await screen.findByTestId('board-detail-not-found')).toBeInTheDocument()
    expect(screen.queryByTestId('board-detail-title')).not.toBeInTheDocument()
  })

  it('rejects an invalid link without crashing', () => {
    renderDetail('/board/format-converter/not-a-number')
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Board link')
  })
})
