/**
 * Component tests for `DriveQueuePanel` (#7 QW-3).
 *
 * Mocks `@/api/client` entirely; wraps renders in a QueryClientProvider +
 * ThemeProvider, matching `Home.test.tsx`'s pattern (`PanelHeader` renders a
 * `ThemeToggle`, which needs the theme context).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DriveQueuePanel from '@/components/DriveQueuePanel'
import { ThemeProvider } from '@/components/ui/theme-provider'
import type { BoardDriveQueueEntry, DriveQueueData, PipelineView } from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchDriveQueue: vi.fn(),
  fetchPipeline: vi.fn(),
}))

import { fetchDriveQueue, fetchPipeline } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<BoardDriveQueueEntry> = {}): BoardDriveQueueEntry {
  return {
    id: 1,
    repo_name: 'repo-a',
    issue_number: 1,
    position: 0,
    machine: null,
    after_json: [],
    state: 'waiting',
    attempts: 0,
    deferrals: 0,
    last_reason: '',
    reason_at: null,
    session_name: null,
    launched_at: null,
    enqueued_at: 0,
    hold_after: 0,
    hold_reason: '',
    resume_when: '',
    hold_state: '',
    hold_probes: 0,
    launch_host: '',
    hold_scope: '',
    resumes: 0,
    retry_backoff_at: null,
    ...overrides,
  }
}

function makeData(overrides: Partial<DriveQueueData> = {}): DriveQueueData {
  return {
    entries: [],
    summary: {
      level: 'normal',
      pending: 0,
      running: 0,
      waiting: 0,
      blocked: 0,
      eligible: 0,
      held: 0,
      fleet_held: 0,
    },
    ...overrides,
  }
}

function makeView(overrides: Partial<PipelineView> = {}): PipelineView {
  return {
    assignment_id: 'a-1',
    issue_number: 1,
    issue_title: 'Untitled',
    repo_name: 'repo-a',
    machine_name: 'laptop',
    current_stage: 'coding',
    stages: [],
    available_gates: [],
    progress_pct: 0,
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

function renderPanel() {
  return render(
    <ThemeProvider>
      <QueryClientProvider client={createTestQueryClient()}>
        <DriveQueuePanel />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('DriveQueuePanel — summary block', () => {
  it('renders the five summary stats straight off the API summary, not recomputed', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [makeEntry()],
        summary: {
          level: 'normal',
          pending: 4,
          running: 1,
          waiting: 3,
          blocked: 0,
          eligible: 2,
          held: 1,
          fleet_held: 0,
        },
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])

    renderPanel()

    const summary = await screen.findByLabelText('Queue summary')
    // Each stat is a <dt>label</dt><dd>value</dd> pair inside its own tile --
    // read the value off the label's own tile rather than matching bare
    // numbers, which collide when two stats share a value (running=1,
    // held=1 both below).
    const statValue = (label: string) =>
      within(summary)
        .getByText(label)
        .closest('div')
        ?.querySelector('dd')?.textContent

    expect(statValue('Pending')).toBe('4')
    expect(statValue('Running')).toBe('1')
    expect(statValue('Waiting')).toBe('3 (2 eligible)')
    expect(statValue('Blocked')).toBe('0')
    expect(statValue('Held')).toBe('1')
  })
})

describe('DriveQueuePanel — repo-scope dropdown', () => {
  it('narrows the grid to the selected repo while the summary stays unchanged', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, position: 0 }),
          makeEntry({ id: 2, repo_name: 'repo-b', issue_number: 2, position: 1 }),
        ],
        summary: {
          level: 'normal',
          pending: 2,
          running: 0,
          waiting: 2,
          blocked: 0,
          eligible: 2,
          held: 0,
          fleet_held: 0,
        },
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])

    renderPanel()

    expect(await screen.findByText('repo-a#1')).toBeInTheDocument()
    expect(screen.getByText('repo-b#2')).toBeInTheDocument()

    const select = screen.getByLabelText('Repo')
    await userEvent.selectOptions(select, 'repo-a')

    expect(screen.getByText('repo-a#1')).toBeInTheDocument()
    expect(screen.queryByText('repo-b#2')).not.toBeInTheDocument()

    // The summary block is unaffected by the repo scope -- it always reflects
    // the server's full-queue aggregate (fetchDriveQueue's own doc comment).
    const summary = screen.getByLabelText('Queue summary')
    expect(within(summary).getByText('2 (2 eligible)')).toBeInTheDocument()
  })

  it('offers "All repos" plus one option per distinct repo in the queue', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1 }),
          makeEntry({ id: 2, repo_name: 'repo-b', issue_number: 2 }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])

    renderPanel()

    const select = await screen.findByLabelText('Repo')
    const options = within(select).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All repos', 'repo-a', 'repo-b'])
  })
})

describe('DriveQueuePanel — nine-column grid', () => {
  it('renders the column headers in column-parity order', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(makeData({ entries: [makeEntry()] }))
    vi.mocked(fetchPipeline).mockResolvedValue([])

    renderPanel()

    const table = await screen.findByRole('table')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual(['#', 'Issue', 'Title', 'State', 'Machine', 'Tries', 'After', 'Hold', 'Reason'])
  })

  it('renders a row with the title resolved from the pipeline roster cache and the hold/reason cells formatted', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({
            repo_name: 'repo-a',
            issue_number: 1,
            position: 3,
            state: 'blocked',
            machine: 'desktop',
            attempts: 2,
            after_json: ['repo-a#0'],
            hold_after: 1,
            hold_state: 'fired',
            hold_scope: 'fleet',
            last_reason: 'checks_failed',
          }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([
      makeView({ repo_name: 'repo-a', issue_number: 1, issue_title: 'Fix the grid' }),
    ])

    renderPanel()

    const row = (await screen.findByText('repo-a#1')).closest('tr')
    expect(row).not.toBeNull()
    const cells = within(row as HTMLTableRowElement)
      .getAllByRole('cell')
      .map((c) => c.textContent)
    expect(cells).toEqual([
      '3',
      'repo-a#1',
      'Fix the grid',
      'blocked',
      'desktop',
      '2',
      'repo-a#0',
      'FIRED [fleet]',
      // No `reason_at` on this fixture -> bare reason, no age suffix.
      'checks_failed',
    ])
  })
})

describe('DriveQueuePanel — empty state', () => {
  it('shows an empty-queue message rather than a bare table when there are no entries', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(makeData({ entries: [] }))
    vi.mocked(fetchPipeline).mockResolvedValue([])

    renderPanel()

    expect(await screen.findByText('The drive queue is empty')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
