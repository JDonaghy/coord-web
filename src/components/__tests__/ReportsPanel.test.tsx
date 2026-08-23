/**
 * Component tests for `ReportsPanel` (#21 RPT-2), covering the two blocking
 * review findings fixed here that the sealed Playwright acceptance slice
 * (`tests/acceptance/ms-2/rpt-2-drive-queue-status.spec.ts`) can't reach
 * without a live `coord web --fixture` process and precise control over
 * when a `fetchReport` promise resolves:
 *
 *  - The staleness guard in `handleRun`: switching tabs while a run is still
 *    in flight must not let the abandoned run's response land on the newly
 *    selected tab's state once it resolves late.
 *  - The catalogue-fetch loading/error states, mirroring
 *    `DriveQueuePanel.test.tsx`'s coverage of the same pattern.
 *
 * Mocking convention matches `DriveQueuePanel.test.tsx`: `@/api/client`
 * mocked entirely, wrapped in QueryClientProvider + ThemeProvider (`
 * PanelHeader` renders a `ThemeToggle`, which needs the theme context) +
 * MemoryRouter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import ReportsPanel from '@/components/ReportsPanel'
import { ThemeProvider } from '@/components/ui/theme-provider'
import type { ReportCatalogue, ReportDef, ReportResult } from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchReportCatalogue: vi.fn(),
  fetchReport: vi.fn(),
}))

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { fetchReportCatalogue, fetchReport } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeReportDef(overrides: Partial<ReportDef> = {}): ReportDef {
  return {
    id: 'drive-queue-status',
    title: 'Drive queue status',
    description: 'Snapshot of the drive queue.',
    params: [],
    row_identity: null,
    ...overrides,
  }
}

function makeCatalogue(reports: ReportDef[]): ReportCatalogue {
  return { reports }
}

function makeResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    report_id: 'drive-queue-status',
    generated_at: 0,
    window: [0, 0],
    columns: ['issue'],
    column_meta: [{ id: 'issue', label: 'Issue', kind: 'text', align: '', weight: 0 }],
    rows: [{ issue: 'api#42' }],
    notes: [],
    totals: null,
    chart: null,
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
    <MemoryRouter initialEntries={['/reports']}>
      <ThemeProvider>
        <QueryClientProvider client={createTestQueryClient()}>
          <ReportsPanel />
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// ── catalogue loading/error (non-blocking review finding) ──────────────────

describe('ReportsPanel — catalogue fetch', () => {
  it('shows a loading message while the catalogue is in flight', async () => {
    vi.mocked(fetchReportCatalogue).mockReturnValue(new Promise(() => {}))
    renderPanel()

    expect(await screen.findByText('Loading reports…')).toBeInTheDocument()
    expect(screen.queryByTestId('reports-tablist')).not.toBeInTheDocument()
  })

  it('shows a retry affordance when the catalogue fetch fails, and retrying re-fetches', async () => {
    vi.mocked(fetchReportCatalogue).mockRejectedValueOnce(new Error('network down'))
    renderPanel()

    expect(await screen.findByText('Failed to load the report catalogue')).toBeInTheDocument()
    expect(screen.queryByTestId('reports-tablist')).not.toBeInTheDocument()

    vi.mocked(fetchReportCatalogue).mockResolvedValueOnce(makeCatalogue([makeReportDef()]))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('reports-tablist')).toBeInTheDocument()
  })
})

// ── handleRun staleness guard (blocking review finding) ─────────────────────

describe('ReportsPanel — stale run guard', () => {
  it('does not let a late-resolving run from an abandoned tab overwrite the newly selected tab', async () => {
    const reportA = makeReportDef({ id: 'drive-queue-status', title: 'Drive queue status' })
    const reportB = makeReportDef({ id: 'issue-activity', title: 'Issue activity' })
    vi.mocked(fetchReportCatalogue).mockResolvedValue(makeCatalogue([reportA, reportB]))

    let resolveA!: (v: ReportResult) => void
    vi.mocked(fetchReport).mockImplementation((reportId: string) => {
      if (reportId === 'drive-queue-status') {
        return new Promise<ReportResult>((resolve) => {
          resolveA = resolve
        })
      }
      return Promise.resolve(
        makeResult({
          report_id: 'issue-activity',
          rows: [{ issue: 'api#99' }],
        }),
      )
    })

    renderPanel()

    // Cold load selects drive-queue-status (contract §3c) -- run it, but
    // never let its response resolve yet.
    await screen.findByTestId('reports-tab-drive-queue-status')
    await userEvent.click(screen.getByTestId('reports-run-button'))
    expect(fetchReport).toHaveBeenCalledWith('drive-queue-status', {})

    // Switch to the other tab before report A's run resolves.
    await userEvent.click(screen.getByTestId('reports-tab-issue-activity'))
    expect(screen.getByTestId('reports-tab-issue-activity')).toHaveAttribute('aria-selected', 'true')
    // No result committed yet for either report -- back to the empty state.
    expect(screen.getByTestId('reports-empty-state')).toBeInTheDocument()

    // Now report A's abandoned run resolves late.
    resolveA(makeResult({ report_id: 'drive-queue-status', rows: [{ issue: 'api#42' }] }))

    // It must NOT land: the empty state stays, issue-activity's tab stays
    // selected, and api#42 (report A's row) never appears under it.
    await waitFor(() => expect(fetchReport).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('reports-empty-state')).toBeInTheDocument()
    expect(screen.queryByText('api#42')).not.toBeInTheDocument()
    expect(screen.getByTestId('reports-tab-issue-activity')).toHaveAttribute('aria-selected', 'true')

    // Running B for real still works normally afterwards.
    await userEvent.click(screen.getByTestId('reports-run-button'))
    await waitFor(() => expect(screen.getByText('api#99')).toBeInTheDocument())
  })
})

// ── decisions' options column (#22 RPT-3, contract §6d) ─────────────────────

describe('ReportsPanel — list-of-dicts cell rendering', () => {
  it('renders a {label, command_or_action, recommended} list as its own option list, never raw JSON', async () => {
    const decisions = makeReportDef({ id: 'decisions', title: 'Decisions' })
    vi.mocked(fetchReportCatalogue).mockResolvedValue(makeCatalogue([decisions]))
    vi.mocked(fetchReport).mockResolvedValue(
      makeResult({
        report_id: 'decisions',
        columns: ['issue', 'decision', 'options'],
        column_meta: [
          { id: 'issue', label: 'Issue', kind: 'text', align: '', weight: 0 },
          { id: 'decision', label: 'Decision', kind: 'text', align: '', weight: 0 },
          { id: 'options', label: 'Options', kind: 'list', align: '', weight: 0 },
        ],
        rows: [
          {
            issue: 'api#40',
            decision: 'Gate fired, awaiting release',
            options: [
              { label: 'Release gate', command_or_action: 'coord drive release --issue 40', recommended: true },
              { label: 'Extend hold', command_or_action: 'coord drive hold --issue 40 --extend 1h', recommended: false },
            ],
          },
        ],
      }),
    )

    renderPanel()
    await screen.findByTestId('reports-tab-decisions')
    await userEvent.click(screen.getByTestId('reports-run-button'))

    const cell = await screen.findByTestId('reports-options-cell-0')
    const recommended = screen.getByText('Release gate').closest('li')
    const plain = screen.getByText('Extend hold').closest('li')

    // Visible label + recommended star + sr-only text on the recommended
    // option only; command_or_action lives in `title`, never printed inline.
    expect(recommended).toHaveAttribute('title', 'coord drive release --issue 40')
    expect(recommended).toHaveTextContent('★')
    expect(recommended?.querySelector('.sr-only')).toHaveTextContent('(recommended)')

    expect(plain).toHaveAttribute('title', 'coord drive hold --issue 40 --extend 1h')
    expect(plain).not.toHaveTextContent('★')
    expect(plain?.querySelector('.sr-only')).toBeNull()

    // The negative assertion #22 explicitly asks for: no raw JSON / dict
    // stringification anywhere in the cell.
    expect(cell.textContent ?? '').not.toMatch(/[{}[\]]/)
    expect(cell.textContent ?? '').not.toContain('command_or_action')
  })

  it('a plain scalar list column (no label field) still renders as comma-joined text', async () => {
    const driveQueue = makeReportDef({ id: 'drive-queue-status', title: 'Drive queue status' })
    vi.mocked(fetchReportCatalogue).mockResolvedValue(makeCatalogue([driveQueue]))
    vi.mocked(fetchReport).mockResolvedValue(
      makeResult({
        columns: ['after'],
        column_meta: [{ id: 'after', label: 'After', kind: 'list', align: '', weight: 0 }],
        rows: [{ after: ['api#42', 'api#40'] }],
      }),
    )

    renderPanel()
    await screen.findByTestId('reports-tab-drive-queue-status')
    await userEvent.click(screen.getByTestId('reports-run-button'))

    await screen.findByText(/api#42, api#40/)
    expect(screen.queryByTestId('reports-options-cell-0')).not.toBeInTheDocument()
  })
})
