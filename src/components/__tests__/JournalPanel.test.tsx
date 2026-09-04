/**
 * Component tests for `JournalPanel` (#93).
 *
 * Same shape as `AnswersPanel.test.tsx`: `@/api/client` is mocked entirely
 * and renders are wrapped in QueryClientProvider + ThemeProvider +
 * MemoryRouter (`PanelHeader` renders a `ThemeToggle`, which needs the theme
 * context; the panel itself navigates, which needs a router).
 *
 * These cover the states a Playwright run can't cheaply reach — a render
 * *throw* inside the timeline, and the panel's own routing behaviour. The
 * rendered-output acceptance bar (both themes, both breakpoints, every
 * degraded state) is `e2e/journal.spec.ts`, per CLAUDE.md's two-tier
 * convention.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import JournalPanel from '@/components/JournalPanel'
import { ThemeProvider } from '@/components/ui/theme-provider'
import type { JournalEntryWire, JournalResponse } from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchJournal: vi.fn(),
  fetchPortalNeedsInput: vi.fn(),
}))

import { fetchJournal, fetchPortalNeedsInput } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchPortalNeedsInput).mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── fixtures ─────────────────────────────────────────────────────────────────

function at(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000
}

function entry(overrides: Partial<JournalEntryWire> = {}): JournalEntryWire {
  return {
    ts: at(2026, 2, 3, 9, 15),
    kind: 'question_pushed',
    actor: 'coord',
    text: 'What is the shipping address?',
    artifact: null,
    source: 'ledger',
    details: {},
    ...overrides,
  }
}

function response(overrides: Partial<JournalResponse> = {}): JournalResponse {
  return {
    submission_id: 'sub_abc123',
    title: 'Replacement unit portal',
    customer_status: 'in_progress',
    link: null,
    gaps: [],
    entries: [],
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

/** Records the current path so a navigation the panel performs is assertable. */
let lastPath = ''
function PathProbe() {
  lastPath = useLocation().pathname
  return null
}

function renderPanel(initialPath = '/journal') {
  lastPath = initialPath
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider>
        <QueryClientProvider client={createTestQueryClient()}>
          <PathProbe />
          <Routes>
            <Route path="/journal" element={<JournalPanel />} />
            <Route path="/journal/:submissionId" element={<JournalPanel />} />
          </Routes>
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('JournalPanel — selection', () => {
  it('asks for nothing until a submission is chosen', async () => {
    renderPanel('/journal')
    expect(await screen.findByTestId('journal-no-selection')).toBeInTheDocument()
    expect(fetchJournal).not.toHaveBeenCalled()
  })

  it('navigates to the submission’s own URL on submit, so the run is bookmarkable', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: response() })
    renderPanel('/journal')

    await user.type(screen.getByTestId('journal-submission-input'), '  sub_0f2a  ')
    await user.click(screen.getByTestId('journal-show-button'))

    await waitFor(() => expect(lastPath).toBe('/journal/sub_0f2a'))
    expect(fetchJournal).toHaveBeenCalledWith('sub_0f2a')
  })

  it('submitting an empty field clears the selection instead of fetching ""', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: response() })
    renderPanel('/journal/sub_0f2a')
    await screen.findByTestId('journal-timeline')

    await user.clear(screen.getByTestId('journal-submission-input'))
    await user.click(screen.getByTestId('journal-show-button'))

    await waitFor(() => expect(lastPath).toBe('/journal'))
    expect(fetchJournal).not.toHaveBeenCalledWith('')
  })

  it('decodes a submission id that needed URL-encoding', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: response() })
    renderPanel(`/journal/${encodeURIComponent('sub/one two')}`)
    await waitFor(() => expect(fetchJournal).toHaveBeenCalledWith('sub/one two'))
  })

  it('offers the needs-input submissions as quick picks', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([
      { submission_id: 'sub_waiting', question: 'q?', revision: 1 },
    ])
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: response() })
    renderPanel('/journal')

    await user.click(await screen.findByTestId('journal-quick-pick-sub_waiting'))
    await waitFor(() => expect(lastPath).toBe('/journal/sub_waiting'))
  })

  it('survives the quick-pick list failing to load — it is an aid, not the content', async () => {
    vi.mocked(fetchPortalNeedsInput).mockRejectedValue(new Error('older coord'))
    vi.mocked(fetchJournal).mockResolvedValue({
      available: true,
      data: response({ entries: [entry()] }),
    })
    renderPanel('/journal/sub_abc123')
    expect(await screen.findByTestId('journal-timeline')).toBeInTheDocument()
  })
})

describe('JournalPanel — degraded states', () => {
  it('renders an empty run as "nothing has happened yet", never an error', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({
      available: true,
      data: response({ gaps: ['no repo/milestone linked to sub_abc123'] }),
    })
    renderPanel('/journal/sub_abc123')

    expect(await screen.findByTestId('journal-empty')).toHaveTextContent(/nothing has happened yet/i)
    expect(screen.queryByTestId('journal-fetch-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journal-unavailable')).not.toBeInTheDocument()
    // The gap is still shown: an empty run with a stated reason is more
    // useful than an empty run without one.
    expect(screen.getByTestId('journal-gaps')).toHaveTextContent(/no repo\/milestone linked/)
  })

  it('explains an absent endpoint rather than blanking', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({ available: false })
    renderPanel('/journal/sub_abc123')
    expect(await screen.findByTestId('journal-unavailable')).toHaveTextContent(/no journal API yet/i)
  })

  it('surfaces a genuine fetch failure with the server’s own message', async () => {
    vi.mocked(fetchJournal).mockRejectedValue(new Error('GET /api/journal/x → HTTP 500: boom'))
    renderPanel('/journal/sub_abc123')
    expect(await screen.findByTestId('journal-fetch-error')).toHaveTextContent(/HTTP 500: boom/)
  })
})

describe('JournalPanel — error boundary (#87 must not regress)', () => {
  it('contains a throw raised while rendering the timeline, leaving the picker usable', async () => {
    // A throw that happens during *render*, past every validation seam —
    // which is exactly how #76 (`severity` on `undefined`) and #84 (an
    // object `.map()`ed as an array) both presented. `ts` is read by the
    // day grouping and by every row, i.e. inside the timeline, and nowhere
    // else; that is what makes this the inner boundary's case.
    const booby = response({ entries: [entry()] })
    Object.defineProperty(booby.entries[0], 'ts', {
      get() {
        throw new TypeError('cannot read length of undefined')
      },
    })
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: booby })
    // The boundary logs to console.error by design (#87) — expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderPanel('/journal/sub_abc123')

    // The boundary's fallback, not a blank tree...
    expect(await screen.findByRole('alert')).toHaveTextContent(/journal panel hit an error/i)
    // ...and the picker above it is still mounted and still usable, so the
    // operator's next move is "try another submission", not "reload".
    expect(screen.getByTestId('journal-submission-input')).toBeInTheDocument()
    expect(screen.getByTestId('journal-show-button')).toBeInTheDocument()
  })

  it('contains a throw raised above the inner boundary too, rather than blanking', async () => {
    // The narrow band the inner boundary structurally cannot cover: the
    // panel body reads the response for the header's moment count before
    // the inner boundary's subtree exists. The panel's own outer boundary
    // is what keeps this from taking the whole SPA down — the acceptance
    // bar #93 inherits from #87.
    const booby = response()
    Object.defineProperty(booby, 'entries', {
      get() {
        throw new TypeError('entries is not iterable')
      },
    })
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: booby })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderPanel('/journal/sub_abc123')

    expect(await screen.findByRole('alert')).toHaveTextContent(/journal panel hit an error/i)
    // Recovery is offered, not a dead end.
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})

describe('JournalPanel — the narrative itself', () => {
  const RUN = response({
    link: { repo_name: 'acme/site', milestone_number: 4, issue_number: 12, submission_id: 'sub_abc123', linked_at: 0, actor: 'op', schema: 1 },
    entries: [
      entry({ ts: at(2026, 2, 3, 9, 15), kind: 'question_pushed', actor: 'coord' }),
      entry({
        ts: at(2026, 2, 3, 17, 40),
        kind: 'question_answered',
        actor: 'customer',
        text: 'Leeds office.',
      }),
      entry({
        ts: at(2026, 2, 5, 11, 0),
        kind: 'design_round_published',
        actor: 'coord',
        text: 'round 1',
        artifact: 'https://cdn.example/bundles/r1',
      }),
      entry({
        ts: at(2026, 2, 6, 14, 5),
        kind: 'merged',
        actor: 'coordinator',
        text: 'acme/site#12 merged',
        artifact: 'https://github.com/acme/site/pull/40',
      }),
    ],
  })

  it('groups the run by day and orders the days', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: RUN })
    renderPanel('/journal/sub_abc123')

    await screen.findByTestId('journal-timeline')
    const days = screen.getAllByTestId(/^journal-day-/).map((el) => el.dataset.testid)
    expect(days).toEqual(['journal-day-2026-02-03', 'journal-day-2026-02-05', 'journal-day-2026-02-06'])
  })

  it('gives a client answer, a design round and a merge visually distinct tones', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: RUN })
    renderPanel('/journal/sub_abc123')

    await screen.findByTestId('journal-timeline')
    const tones = screen.getAllByTestId(/^journal-entry-/).map((el) => el.dataset.tone)
    expect(tones).toEqual(['design', 'client', 'design', 'ship'])
    expect(new Set(tones).size).toBeGreaterThan(1)
  })

  it('turns an entry’s artifact into a real link, and leaves the rest plain text', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({ available: true, data: RUN })
    renderPanel('/journal/sub_abc123')

    await screen.findByTestId('journal-timeline')
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      'https://cdn.example/bundles/r1',
      'https://github.com/acme/site/pull/40',
    ])
    expect(links[1]).toHaveTextContent('Open PR')
    expect(links[1]).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('refuses to make a non-http artifact clickable', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({
      available: true,
      data: response({
        entries: [entry({ kind: 'merged', artifact: 'javascript://x%0aalert(1)' })],
      }),
    })
    renderPanel('/journal/sub_abc123')

    await screen.findByTestId('journal-timeline')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('renders a kind this bundle predates instead of dropping the moment', async () => {
    vi.mocked(fetchJournal).mockResolvedValue({
      available: true,
      data: response({ entries: [entry({ kind: 'client_called_in', text: 'rang about scope' })] }),
    })
    renderPanel('/journal/sub_abc123')

    expect(await screen.findByTestId('journal-kind-client_called_in')).toHaveTextContent(
      'Client called in',
    )
    expect(screen.getByText('rang about scope')).toBeInTheDocument()
  })
})
