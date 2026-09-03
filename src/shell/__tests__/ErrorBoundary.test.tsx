/**
 * Tests for `ErrorBoundary` (#87) — the containment layer that stops one
 * component's render throw from unmounting the whole SPA, the way #76
 * (MachinesList) and #84 (AnswersPanel) both did.
 *
 * Two tiers:
 *   - Isolated unit tests against `ErrorBoundary` directly: fallback
 *     content, the console report, Retry, the `resetKey`-doesn't-latch
 *     contract, and the `topLevel` fallback's Reload affordance.
 *   - An integration block that mounts the *real* `ShellLayout` (mirroring
 *     `ShellLayout.test.tsx`'s own approach) with a mocked list-slot panel
 *     that can be made to throw on demand, to prove the acceptance criteria
 *     that only show up once the boundary sits inside the real composition:
 *     the rail and status bar survive a list-slot crash, and navigating away
 *     recovers real content rather than latching the fallback forever.
 */
import { type ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Navigate, Routes, Route } from 'react-router-dom'

import { ThemeProvider } from '@/components/ui/theme-provider'
import { paths } from '@/routes/paths'
import { ErrorBoundary } from '../ErrorBoundary'
import { ShellLayout } from '../ShellLayout'
import { EmptyDetail } from '../EmptyDetail'
import { MEDIUM_PX, WIDE_PX, restoreViewport, stubViewportWidth } from './stubViewport'

/** Throws on every render — the render-throw shape both #76 and #84 hit. */
function Bomb({ message = 'boom' }: { message?: string }): ReactElement {
  throw new Error(message)
}

function renderWithRouter(ui: ReactElement, initialPath = '/pipeline') {
  return render(<MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>)
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React itself also logs the thrown error via console.error -- spy
    // rather than silence it, and assert our own message is among the
    // calls, so a regression that stops reporting the error is caught
    // without this test also having to fight React's own logging.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders the panel fallback in place of the crashed subtree, naming the slot and the error', () => {
    renderWithRouter(
      <ErrorBoundary label="list">
        <Bomb message="severity lookup on undefined" />
      </ErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The list panel hit an error')
    expect(alert).toHaveTextContent('severity lookup on undefined')
  })

  it('still reports the error to the console', () => {
    renderWithRouter(
      <ErrorBoundary label="detail">
        <Bomb message="answers-panel-shape-mismatch" />
      </ErrorBoundary>,
    )

    expect(
      consoleErrorSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('ErrorBoundary (detail)') &&
          call[1] instanceof Error &&
          call[1].message === 'answers-panel-shape-mismatch',
      ),
    ).toBe(true)
  })

  it('offers a Retry that clears the fallback and gives the subtree another render', async () => {
    const user = userEvent.setup()
    // A ref mutated by the *test*, not by the component's own render call --
    // React re-invokes a thrown render function once more in development to
    // produce a clean stack trace, so a component that flips its own "have I
    // thrown yet" flag inside its render body recovers on that internal
    // replay and the boundary never gets a chance to show the fallback at
    // all. Reading an external condition that only the test changes avoids
    // that trap and matches the real shape of a Retry click anyway -- it
    // re-renders the same children, and whether that now succeeds depends on
    // something outside the boundary (fresh data, a fixed dependency), not
    // an internal render counter.
    const shouldCrash = { current: true }
    function ConditionalBomb() {
      if (shouldCrash.current) throw new Error('flaky boom')
      return <div>Recovered content</div>
    }

    renderWithRouter(
      <ErrorBoundary label="detail">
        <ConditionalBomb />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    shouldCrash.current = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('Recovered content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers a link back to a known-good route (Pipeline) from a panel fallback', () => {
    renderWithRouter(
      <ErrorBoundary label="detail">
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('link', { name: 'Back to Pipeline' })).toHaveAttribute(
      'href',
      paths.pipeline(),
    )
  })

  it('does not latch: a resetKey change while erroring clears the fallback for the new children', () => {
    function Wrapper({ resetKey, crash }: { resetKey: string; crash: boolean }) {
      return (
        <ErrorBoundary label="list" resetKey={resetKey}>
          {crash ? <Bomb /> : <div>Real content for {resetKey}</div>}
        </ErrorBoundary>
      )
    }

    const { rerender } = render(
      <MemoryRouter initialEntries={['/pipeline']}>
        <Wrapper resetKey="/pipeline" crash />
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // Simulate a navigation: the resetKey (a stand-in for location.pathname)
    // changes, and the new route's content no longer throws -- mirrors
    // clicking to another rail view after a caught error.
    rerender(
      <MemoryRouter initialEntries={['/pipeline']}>
        <Wrapper resetKey="/sessions" crash={false} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Real content for /sessions')).toBeInTheDocument()
  })

  it('does not reset merely because children re-render without the resetKey itself changing', () => {
    function Wrapper({ resetKey }: { resetKey: string }) {
      return (
        <ErrorBoundary label="list" resetKey={resetKey}>
          <Bomb />
        </ErrorBoundary>
      )
    }

    const { rerender } = render(
      <MemoryRouter initialEntries={['/pipeline']}>
        <Wrapper resetKey="/pipeline" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(
      <MemoryRouter initialEntries={['/pipeline']}>
        <Wrapper resetKey="/pipeline" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  describe('topLevel', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('renders a full-page fallback with a Reload affordance instead of the panel fallback', () => {
      render(
        <ErrorBoundary topLevel>
          <Bomb message="chunk failed to load" />
        </ErrorBoundary>,
      )

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Something went wrong')
      expect(alert).toHaveTextContent('chunk failed to load')
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
      // The panel-only affordances have no meaning above the router.
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Back to Pipeline' })).not.toBeInTheDocument()
    })

    it('still reports the error to the console from the top-level boundary', () => {
      render(
        <ErrorBoundary topLevel>
          <Bomb message="provider blew up" />
        </ErrorBoundary>,
      )

      expect(
        consoleErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[1] instanceof Error &&
            call[1].message === 'provider blew up',
        ),
      ).toBe(true)
    })

    it('reloads the page when Reload is clicked', async () => {
      const reload = vi.fn()
      vi.stubGlobal('location', { ...window.location, reload })
      const user = userEvent.setup()

      render(
        <ErrorBoundary topLevel>
          <Bomb />
        </ErrorBoundary>,
      )

      await user.click(screen.getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })
})

// ── integration: the real shell around the boundary ──────────────────────

const homeCrash = vi.hoisted(() => ({ current: false }))

// A stand-in for the real `Home` panel that can be made to throw on demand,
// shaped like #76's actual bug (a property read on an object that doesn't
// have it) rather than a contrived `throw new Error()` -- so this exercises
// the same kind of render-throw the issue is about, not just any exception.
vi.mock('@/components/Home', () => ({
  default: () => {
    if (homeCrash.current) {
      const row: { severity?: string } = {}
      // Deliberately reproducing #76's shape: a property read on `undefined`
      // thrown during render, not a hand-written `throw`.
      return <div>{row.severity!.toUpperCase()}</div>
    }
    return <div>Home content (mock)</div>
  },
}))

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    fetchPipeline: vi.fn().mockResolvedValue([]),
    fetchSessions: vi.fn().mockResolvedValue([]),
  }
})

function renderShell(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<Navigate to={paths.pipeline()} replace />} />
            <Route element={<ShellLayout />}>
              <Route path="/pipeline" element={<EmptyDetail />} />
              <Route path="/sessions" element={<EmptyDetail />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  )
}

describe('ErrorBoundary — integration with the real shell (#87)', () => {
  beforeEach(() => {
    homeCrash.current = false
    stubViewportWidth(WIDE_PX)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    restoreViewport()
    vi.restoreAllMocks()
  })

  it('contains a list-slot crash to the list pane -- the rail and status bar stay present and interactive', async () => {
    homeCrash.current = true
    renderShell(paths.pipeline())

    expect(await screen.findByRole('alert')).toHaveTextContent('The list panel hit an error')

    // Rail and status bar are siblings of the crashed boundary in AppShell's
    // grid, not descendants -- #76's actual regression was that they went
    // down with the panel too.
    const railButton = screen.getByRole('button', { name: /Sessions/ })
    expect(railButton).toBeInTheDocument()
    expect(railButton).toBeEnabled()
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
  })

  it('does not latch: navigating to Sessions after the crash shows that route real content', async () => {
    const user = userEvent.setup()
    homeCrash.current = true
    renderShell(paths.pipeline())
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Sessions/ }))

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a medium-viewport crash is contained the same way as wide', async () => {
    stubViewportWidth(MEDIUM_PX)
    homeCrash.current = true
    renderShell(paths.pipeline())

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument()
  })
})
