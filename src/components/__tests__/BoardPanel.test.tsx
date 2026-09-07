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
  extractBriefingBody,
  filterBoardGroups,
  findBoardAssignment,
  groupBoardIssuesByRepo,
  parseBoardFilter,
} from '@/lib/board'
import type { Assignment, BoardData, BoardDriveQueueEntry, DriveQueueData } from '@/api/client'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, fetchDriveQueue: vi.fn(), fetchBoard: vi.fn() }
})

import { fetchBoard, fetchDriveQueue } from '@/api/client'

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

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    machine_name: 'dellserver',
    repo_name: 'format-converter',
    issue_number: 3,
    issue_title: 'YAML <-> JSON conversion engine with positioned error reporting',
    files_allowed: [],
    files_forbidden: [],
    briefing:
      'Issue #3: YAML <-> JSON conversion engine with positioned error reporting\n\n## What\n\nParse YAML and emit positioned errors.',
    assignment_id: 'abc123',
    status: 'running',
    branch: null,
    pr_url: null,
    dispatched_at: 1_700_000_000,
    finished_at: null,
    smoke_test: null,
    smoke_test_reason: null,
    type: 'work',
    review_target: null,
    review_of_assignment_id: null,
    unreachable_count: 0,
    model: null,
    plan: null,
    review_state: null,
    review_dispatch_reason: null,
    required_gates: [],
    review_iteration: 0,
    review_posted_at: null,
    test_state: null,
    test_reason: null,
    test_head_sha: null,
    test_patch_id: null,
    test_base_sha: null,
    test_toolchain: null,
    review_verdict: null,
    review_verdict_original: null,
    review_verdict_override_reason: null,
    verdict_source: null,
    verdict_source_reason: null,
    review_head_sha: null,
    review_patch_id: null,
    review_scoped: false,
    review_scope_base_sha: null,
    cost_usd: null,
    smoke_tests: null,
    provider_name: null,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    failure_reason: null,
    acceptance_state: null,
    acceptance_reason: null,
    acceptance_sha: null,
    acceptance_total: null,
    acceptance_passed: null,
    completion_summary: null,
    audit_goals_json: null,
    audit_bottom_line: null,
    audit_run_number: null,
    for_issue_number: null,
    driven_by: null,
    stop_reason: null,
    ...overrides,
  }
}

function boardData(overrides: Partial<BoardData> = {}): BoardData {
  return { round_number: 1, active: [], completed: [], ...overrides }
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

  it('extractBriefingBody strips the synthesized "Issue #N: title" line', () => {
    const body = extractBriefingBody('Issue #3: A title\n\n## What\n\nDo the thing.')
    expect(body).toBe('## What\n\nDo the thing.')
  })

  it('extractBriefingBody returns the briefing untouched when the prefix is missing', () => {
    expect(extractBriefingBody('No prefix here')).toBe('No prefix here')
  })

  it('findBoardAssignment prefers an active assignment over a completed one', () => {
    const active = assignment({ repo_name: 'a', issue_number: 1, briefing: 'active' })
    const completed = assignment({ repo_name: 'a', issue_number: 1, briefing: 'completed' })
    const found = findBoardAssignment({ active: [active], completed: [completed] }, 'a', 1)
    expect(found?.briefing).toBe('active')
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
  it('renders the body extracted from a matching assignment briefing', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    vi.mocked(fetchBoard).mockResolvedValue(
      boardData({ active: [assignment({ repo_name: 'format-converter', issue_number: 3 })] }),
    )
    renderDetail('/board/format-converter/3')

    expect(await screen.findByTestId('board-detail-title')).toHaveTextContent(
      'YAML <-> JSON conversion engine with positioned error reporting',
    )
    expect(await screen.findByText('Parse YAML and emit positioned errors.')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-queue-state')).toHaveTextContent('blocked')
  })

  it('renders the "not available" state when no assignment ever carried this issue', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData())
    vi.mocked(fetchBoard).mockResolvedValue(boardData())
    renderDetail('/board/format-converter/2')

    expect(await screen.findByTestId('board-detail-no-body')).toBeInTheDocument()
  })

  it('renders an honest "untracked" badge for an issue absent from the queue', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(driveQueueData({ entries: [], titles: {} }))
    vi.mocked(fetchBoard).mockResolvedValue(boardData())
    renderDetail('/board/format-converter/999')

    expect(await screen.findByTestId('board-detail-untracked')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-title')).toHaveTextContent('Issue #999')
  })

  it('rejects an invalid link without crashing', () => {
    renderDetail('/board/format-converter/not-a-number')
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid Board link')
  })
})
