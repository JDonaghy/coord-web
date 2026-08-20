/**
 * Component tests for `DriveQueuePanel` (#7 QW-3, #9 QW-5).
 *
 * Mocks `@/api/client` entirely; wraps renders in a QueryClientProvider +
 * ThemeProvider + MemoryRouter, matching `Home.test.tsx`'s pattern
 * (`PanelHeader` renders a `ThemeToggle`, which needs the theme context; the
 * Issue cell's `<Link>` -- #9 QW-5 -- needs a Router context to render at
 * all, same reason `Home.test.tsx` wraps in one).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import DriveQueuePanel from '@/components/DriveQueuePanel'
import { ThemeProvider } from '@/components/ui/theme-provider'
import type {
  BoardDriveQueueEntry,
  DriveQueueActionResult,
  DriveQueueData,
  PipelineView,
} from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchDriveQueue: vi.fn(),
  fetchPipeline: vi.fn(),
  driveQueueAction: vi.fn(),
}))

// Mocked independently of `@/components/ui/toaster` (never rendered in these
// tests) so an action's toast can be asserted directly, without depending on
// `use-toast`'s module-level `memoryState` -- that store is a singleton for
// the whole test file, and asserting through a live `<Toaster/>` would leak
// a toast queued by one `it()` into the next.
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { fetchDriveQueue, fetchPipeline, driveQueueAction } from '@/api/client'
import { toast } from '@/components/ui/use-toast'

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
    <MemoryRouter initialEntries={['/queue']}>
      <ThemeProvider>
        <QueryClientProvider client={createTestQueryClient()}>
          <DriveQueuePanel />
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>,
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
    expect(headers).toEqual([
      '#',
      'Issue',
      'Title',
      'State',
      'Machine',
      'Tries',
      'After',
      'Hold',
      'Reason',
      'Actions',
    ])
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
    const cells = within(row as HTMLTableRowElement).getAllByRole('cell')
    // First nine cells are the TUI-parity columns; the tenth is the Actions
    // cell (#8 QW-4), covered by its own describe block below.
    expect(cells.slice(0, 9).map((c) => c.textContent)).toEqual([
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
    expect(cells).toHaveLength(10)
  })
})

// ── issue hyperlink + new-tab affordance (#9 QW-5) ──────────────────────────

describe('DriveQueuePanel — Issue cell hyperlink', () => {
  it('links the Issue cell to the pipeline detail route for in-app navigation', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({ entries: [makeEntry({ repo_name: 'repo-a', issue_number: 42 })] }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    renderPanel()

    const link = await screen.findByRole('link', { name: 'repo-a#42' })
    expect(link).toHaveAttribute('href', '/pipeline/repo-a/42')
    // In-app SPA nav -- no explicit target, so it navigates within the
    // existing tab (ctrl/cmd-click still opens a new one for free).
    expect(link).not.toHaveAttribute('target')
  })

  it('offers a secondary, discoverable open-in-new-tab affordance alongside the link', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({ entries: [makeEntry({ repo_name: 'repo-a', issue_number: 42 })] }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    renderPanel()

    const newTabLink = await screen.findByRole('link', { name: 'Open repo-a#42 in a new tab' })
    expect(newTabLink).toHaveAttribute('href', '/pipeline/repo-a/42')
    expect(newTabLink).toHaveAttribute('target', '_blank')
    // `rel="noreferrer"` on a target="_blank" link -- standard hardening
    // against the opened tab reaching back via `window.opener`.
    expect(newTabLink).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })
})

describe('DriveQueuePanel — active-entry filter', () => {
  it('drops a done entry from the grid but keeps a done entry with a fired gate', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, state: 'done', hold_state: '' }),
          makeEntry({
            id: 2,
            repo_name: 'repo-a',
            issue_number: 2,
            state: 'done',
            hold_after: 1,
            hold_state: 'fired',
          }),
          makeEntry({ id: 3, repo_name: 'repo-a', issue_number: 3, state: 'waiting' }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])

    renderPanel()

    expect(await screen.findByText('repo-a#3')).toBeInTheDocument()
    expect(screen.getByText('repo-a#2')).toBeInTheDocument()
    expect(screen.queryByText('repo-a#1')).not.toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3) // header + 2 active rows
  })

  it('excludes a repo from the dropdown when its only entries are done and unheld', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, state: 'waiting' }),
          makeEntry({ id: 2, repo_name: 'repo-done-only', issue_number: 2, state: 'done', hold_state: '' }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])

    renderPanel()

    const select = await screen.findByLabelText('Repo')
    const options = within(select).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['All repos', 'repo-a'])
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

// ── row actions (#8 QW-4) ────────────────────────────────────────────────────

describe('DriveQueuePanel — row actions: guard states', () => {
  it('disables Unblock on a non-blocked row, with the reason discoverable via its tooltip', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({ entries: [makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, state: 'waiting' })] }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    renderPanel()

    const unblockBtn = await screen.findByRole('button', { name: 'Unblock repo-a#1' })
    expect(unblockBtn).toBeDisabled()
    expect(unblockBtn.title).toContain('Only a blocked row can be unblocked')
  })

  it('enables Unblock on a blocked row', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({ entries: [makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, state: 'blocked' })] }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Unblock repo-a#1' })).toBeEnabled()
  })

  it('disables Release unless hold_state is "fired" (armed-but-unfired refuses too)', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({
            id: 1,
            repo_name: 'repo-a',
            issue_number: 1,
            hold_after: 1,
            hold_state: 'armed',
          }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    renderPanel()

    const releaseBtn = await screen.findByRole('button', { name: "Release repo-a#1's gate" })
    expect(releaseBtn).toBeDisabled()
    expect(releaseBtn.title).toContain('Only a fired gate can be released')
  })

  it('enables Release once the gate has fired', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({
            id: 1,
            repo_name: 'repo-a',
            issue_number: 1,
            hold_after: 1,
            hold_state: 'fired',
          }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    renderPanel()

    expect(await screen.findByRole('button', { name: "Release repo-a#1's gate" })).toBeEnabled()
  })

  it('disables Move up on the first row and Move down on the last row only', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, position: 0 }),
          makeEntry({ id: 2, repo_name: 'repo-a', issue_number: 2, position: 1 }),
          makeEntry({ id: 3, repo_name: 'repo-a', issue_number: 3, position: 2 }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    renderPanel()

    await screen.findByText('repo-a#1')
    expect(screen.getByRole('button', { name: 'Move repo-a#1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move repo-a#1 down' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move repo-a#2 up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move repo-a#2 down' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move repo-a#3 up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move repo-a#3 down' })).toBeDisabled()
  })
})

describe('DriveQueuePanel — row actions: request payload, busy state, toast', () => {
  it('clicking Unblock on a blocked row shows an immediate busy state, sends the unblock payload, and toasts success', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({ entries: [makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, state: 'blocked' })] }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    let resolveAction!: (v: DriveQueueActionResult) => void
    vi.mocked(driveQueueAction).mockReturnValue(
      new Promise<DriveQueueActionResult>((resolve) => {
        resolveAction = resolve
      }),
    )
    renderPanel()

    const unblockBtn = await screen.findByRole('button', { name: 'Unblock repo-a#1' })
    await userEvent.click(unblockBtn)

    // Immediate pending/busy state -- a fire-and-forget POST with no visible
    // change is exactly the "reads as hung" failure the issue calls out.
    expect(unblockBtn).toBeDisabled()
    expect(unblockBtn).toHaveAttribute('aria-busy', 'true')

    expect(driveQueueAction).toHaveBeenCalledWith({
      repo_name: 'repo-a',
      issue_number: 1,
      action: 'unblock',
    })

    resolveAction({ ok: true })
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success', title: 'Unblocked' }),
      ),
    )
    await waitFor(() => expect(unblockBtn).not.toHaveAttribute('aria-busy', 'true'))
  })

  it('clicking Release sends the resume payload', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, hold_after: 1, hold_state: 'fired' }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    vi.mocked(driveQueueAction).mockResolvedValue({ ok: true })
    renderPanel()

    const releaseBtn = await screen.findByRole('button', { name: "Release repo-a#1's gate" })
    await userEvent.click(releaseBtn)

    await waitFor(() =>
      expect(driveQueueAction).toHaveBeenCalledWith({
        repo_name: 'repo-a',
        issue_number: 1,
        action: 'resume',
      }),
    )
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success', title: 'Gate released' }),
      ),
    )
  })

  it('toasts destructive on a server-reported failure (result.ok === false)', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({ entries: [makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, state: 'blocked' })] }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    vi.mocked(driveQueueAction).mockResolvedValue({ ok: false, error: 'queue busy' })
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Unblock repo-a#1' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'Action failed',
          description: 'queue busy',
        }),
      ),
    )
  })

  it('toasts destructive when the request itself rejects', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({ entries: [makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, state: 'blocked' })] }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    vi.mocked(driveQueueAction).mockRejectedValue(new Error('network down'))
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Unblock repo-a#1' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          title: 'Action failed',
          description: 'network down',
        }),
      ),
    )
  })
})

describe('DriveQueuePanel — row actions: optimistic reorder', () => {
  it('clicking Move up swaps the row with its displayed neighbour immediately, before the request resolves', async () => {
    vi.mocked(fetchDriveQueue).mockResolvedValue(
      makeData({
        entries: [
          makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1, position: 0 }),
          makeEntry({ id: 2, repo_name: 'repo-a', issue_number: 2, position: 1 }),
        ],
      }),
    )
    vi.mocked(fetchPipeline).mockResolvedValue([])
    let resolveAction!: (v: DriveQueueActionResult) => void
    vi.mocked(driveQueueAction).mockReturnValue(
      new Promise<DriveQueueActionResult>((resolve) => {
        resolveAction = resolve
      }),
    )
    renderPanel()

    await screen.findByText('repo-a#1')
    const rowsBefore = within(screen.getByRole('table')).getAllByRole('row')
    expect(within(rowsBefore[1]).getByText('repo-a#1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Move repo-a#2 up' }))

    // Optimistic: the swap is visible before the request settles at all.
    await waitFor(() => {
      const rowsAfter = within(screen.getByRole('table')).getAllByRole('row')
      expect(within(rowsAfter[1]).getByText('repo-a#2')).toBeInTheDocument()
    })

    expect(driveQueueAction).toHaveBeenCalledWith({
      repo_name: 'repo-a',
      issue_number: 2,
      action: 'move',
      to_position: 0,
    })

    resolveAction({ ok: true })
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', title: 'Moved up' })),
    )
  })
})
