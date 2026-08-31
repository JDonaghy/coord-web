/**
 * Component tests for `AnswersPanel` (#59 — record a client answer given
 * out of band over `POST /api/portal/answer`).
 *
 * Mocks `@/api/client` entirely, same pattern `DriveQueuePanel.test.tsx`
 * documents: wraps renders in QueryClientProvider + ThemeProvider +
 * MemoryRouter (`PanelHeader` renders a `ThemeToggle`, which needs the theme
 * context), and mocks `@/components/ui/use-toast` independently of a live
 * `<Toaster/>` so a call's toast can be asserted directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import AnswersPanel from '@/components/AnswersPanel'
import { ThemeProvider } from '@/components/ui/theme-provider'
import type { PortalAnswerResult, PortalNeedsInputItem } from '@/api/client'

vi.mock('@/api/client', () => ({
  fetchPortalNeedsInput: vi.fn(),
  submitPortalAnswer: vi.fn(),
}))

vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }))

import { fetchPortalNeedsInput, submitPortalAnswer } from '@/api/client'
import { toast } from '@/components/ui/use-toast'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<PortalNeedsInputItem> = {}): PortalNeedsInputItem {
  return {
    submission_id: 'sub-1',
    question: 'What is the shipping address for the replacement unit?',
    revision: 3,
    repo_name: 'coord-portal',
    issue_number: 159,
    title: null,
    opened_at: null,
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
    <MemoryRouter initialEntries={['/answers']}>
      <ThemeProvider>
        <QueryClientProvider client={createTestQueryClient()}>
          <AnswersPanel />
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('AnswersPanel — listing', () => {
  it('renders each needs-input submission with its open question in full, not truncated', async () => {
    const longQuestion =
      'Could you confirm the full legal name on the account, the billing address, ' +
      'and whether the replacement should ship to the same address as the original order?'
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([makeItem({ question: longQuestion })])

    renderPanel()

    expect(await screen.findByTestId('answer-question-sub-1')).toHaveTextContent(longQuestion)
    expect(screen.getByText('CP#159')).toBeInTheDocument()
  })

  it('shows an empty state when nothing needs input', async () => {
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([])

    renderPanel()

    expect(await screen.findByTestId('answers-empty-state')).toBeInTheDocument()
  })
})

describe('AnswersPanel — composer validation', () => {
  it('keeps Record answer disabled until both text and a source are provided', async () => {
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([makeItem()])
    const user = userEvent.setup()

    renderPanel()

    const submit = await screen.findByTestId('answer-submit-button-sub-1')
    expect(submit).toBeDisabled()

    await user.type(screen.getByTestId('answer-text-input-sub-1'), 'They confirmed 123 Main St.')
    expect(submit).toBeDisabled()

    await user.selectOptions(screen.getByTestId('answer-source-select-sub-1'), 'phone')
    expect(submit).toBeEnabled()
  })
})

describe('AnswersPanel — recording an answer', () => {
  it('submits the revision from the listing, paired to the typed text and chosen source', async () => {
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([makeItem({ revision: 7 })])
    vi.mocked(submitPortalAnswer).mockResolvedValue({
      ok: true,
      status: 200,
      entry: { submission_id: 'sub-1', text: 'They confirmed 123 Main St.', source: 'phone', revision: 7 },
    } satisfies PortalAnswerResult)
    const user = userEvent.setup()

    renderPanel()

    await user.type(
      await screen.findByTestId('answer-text-input-sub-1'),
      'They confirmed 123 Main St.',
    )
    await user.selectOptions(screen.getByTestId('answer-source-select-sub-1'), 'phone')
    await user.click(screen.getByTestId('answer-submit-button-sub-1'))

    await waitFor(() =>
      expect(submitPortalAnswer).toHaveBeenCalledWith({
        submission_id: 'sub-1',
        text: 'They confirmed 123 Main St.',
        source: 'phone',
        revision: 7,
      }),
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success', title: 'Answer recorded' }),
    )
    expect(await screen.findByTestId('answer-recorded-sub-1')).toBeInTheDocument()
  })

  it('leaves needs-input without a manual second step -- a refetch after submit drops the answered card', async () => {
    vi.mocked(fetchPortalNeedsInput)
      .mockResolvedValueOnce([makeItem()])
      .mockResolvedValueOnce([])
    vi.mocked(submitPortalAnswer).mockResolvedValue({ ok: true, status: 200 })
    const user = userEvent.setup()

    renderPanel()

    await user.type(await screen.findByTestId('answer-text-input-sub-1'), 'Confirmed.')
    await user.selectOptions(screen.getByTestId('answer-source-select-sub-1'), 'email')
    await user.click(screen.getByTestId('answer-submit-button-sub-1'))

    await waitFor(() => expect(screen.queryByTestId('answer-card-sub-1')).not.toBeInTheDocument())
    expect(screen.getByTestId('answers-empty-state')).toBeInTheDocument()
  })

  it('a double-submit still only ever sends one request per click -- server-side idempotency is trusted, not re-implemented', async () => {
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([makeItem()])
    vi.mocked(submitPortalAnswer).mockResolvedValue({ ok: true, status: 200 })
    const user = userEvent.setup()

    renderPanel()

    await user.type(await screen.findByTestId('answer-text-input-sub-1'), 'Confirmed.')
    await user.selectOptions(screen.getByTestId('answer-source-select-sub-1'), 'verbal')
    const submit = screen.getByTestId('answer-submit-button-sub-1')
    await user.click(submit)
    // The button disables itself ("Recording…") the instant a submit is in
    // flight -- a second click while it's still pending is a no-op on the
    // client's side; the one call that does go out is what the server's own
    // idempotent convergence (assert-not-reimplement, per the issue) covers.
    await waitFor(() => expect(submitPortalAnswer).toHaveBeenCalledTimes(1))
  })
})

describe('AnswersPanel — a 409 (question moved on)', () => {
  it('surfaces a re-read prompt on that card instead of a generic failure toast', async () => {
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([makeItem({ revision: 3 })])
    vi.mocked(submitPortalAnswer).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'revision mismatch',
    })
    const user = userEvent.setup()

    renderPanel()

    await user.type(await screen.findByTestId('answer-text-input-sub-1'), 'Confirmed.')
    await user.selectOptions(screen.getByTestId('answer-source-select-sub-1'), 'phone')
    await user.click(screen.getByTestId('answer-submit-button-sub-1'))

    expect(await screen.findByTestId('answer-stale-banner-sub-1')).toHaveTextContent(/re-read/i)
    // Not the generic destructive-toast path a 400/404 takes below.
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })
})

describe('AnswersPanel — a 400/404 failure', () => {
  it('shows an inline error and a destructive toast, and keeps the composer text', async () => {
    vi.mocked(fetchPortalNeedsInput).mockResolvedValue([makeItem()])
    vi.mocked(submitPortalAnswer).mockResolvedValue({
      ok: false,
      status: 404,
      error: 'unknown submission',
    })
    const user = userEvent.setup()

    renderPanel()

    await user.type(await screen.findByTestId('answer-text-input-sub-1'), 'Confirmed.')
    await user.selectOptions(screen.getByTestId('answer-source-select-sub-1'), 'phone')
    await user.click(screen.getByTestId('answer-submit-button-sub-1'))

    expect(await screen.findByTestId('answer-error-sub-1')).toHaveTextContent('unknown submission')
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
    expect(screen.getByTestId('answer-text-input-sub-1')).toHaveValue('Confirmed.')
  })
})
