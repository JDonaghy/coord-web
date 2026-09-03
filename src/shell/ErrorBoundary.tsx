/**
 * ErrorBoundary (#87) — contains a render throw to the slot it wraps instead
 * of letting React's default behaviour (unmount the whole tree) blank the
 * entire SPA. This is how both of this repo's contract bugs presented: #76
 * (a `severity` lookup on `undefined` in `MachinesList`) blanked every route,
 * not just `/machines`; #84 (`AnswersPanel` mapping an object as an array)
 * took the rail with it, leaving no in-app way to navigate off the broken
 * route.
 *
 * A class component because `getDerivedStateFromError`/`componentDidCatch`
 * have no hook equivalent in React 18 (`^18.3.1` here). A small local
 * component rather than pulling in `react-error-boundary`, per #85's
 * no-new-runtime-dependency posture.
 *
 * Three instances are mounted (see `ShellLayout.tsx` and `App.tsx`):
 *   - around the list slot   (label="list")
 *   - around the detail slot (label="detail")
 *   - around the whole app, above `<BrowserRouter>` (`topLevel`) — the last
 *     resort for a throw outside both slots (a provider, the shell itself),
 *     and what catches a failed lazy chunk (`Terminal`/`Gallery` in
 *     `App.tsx`, code-split behind `Suspense fallback={null}` — a dynamic
 *     import 404ing after a redeploy throws during that render the same way
 *     any other render throw would).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { paths } from '@/routes/paths'

export interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * Which slot this boundary guards — shown in the fallback ("The {label}
   * panel hit an error") and in the `console.error` call, so the operator
   * and whoever reads the console both know *what* failed, not just *that*
   * something did. Omitted for the top-level boundary, which has no single
   * slot to name.
   */
  label?: string
  /**
   * Renders the last-resort fallback (message + Reload) instead of the
   * panel fallback (message + Retry + a link back to Pipeline). Set on the
   * one boundary that sits above `<BrowserRouter>` — nothing below it can be
   * assumed to still have router context once it has thrown, so the
   * fallback offers a full reload rather than an in-app link.
   */
  topLevel?: boolean
  /**
   * When this changes *while the boundary is currently showing its
   * fallback*, the boundary clears itself and gives `children` another try.
   * Wire this to something that changes on navigation (`useLocation().
   * pathname` in `ShellLayout`) so a caught error doesn't latch — the next
   * navigation shows that route's real content instead of every subsequent
   * route showing the same stale fallback.
   *
   * Deliberately compared only when `state.error` is set: unlike a `key`
   * prop, this does not force `children` to remount on every navigation —
   * only on the navigation that follows a crash. The happy path (no error)
   * is completely unaffected, so e.g. Home's scroll/filter state survives
   * selecting a different pipeline item exactly as it did before this
   * component existed.
   */
  resetKey?: unknown
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Swallowing this would make the *next* bug harder to diagnose than the
    // blank screen this component exists to prevent — see issue #87.
    console.error(
      `ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''} caught an error:`,
      error,
      info.componentStack,
    )
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
      this.reset()
    }
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return this.props.topLevel ? (
      <TopLevelFallback error={error} />
    ) : (
      <PanelFallback error={error} label={this.props.label} onRetry={this.reset} />
    )
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- this plugin doesn't recognize class components as a "react export" (`ErrorBoundary` above is a class, required by getDerivedStateFromError/componentDidCatch having no hook form), so it sees this file as exporting nothing component-shaped and flags these two private fallback subcomponents as if they belonged in their own file. They're deliberately not exported -- only `ErrorBoundary` itself renders them.
function PanelFallback({
  error,
  label,
  onRetry,
}: {
  error: Error
  label?: string
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">
        {label ? `The ${label} panel hit an error` : 'This panel hit an error'}
      </p>
      <p className="max-w-xs break-words text-xs text-muted-foreground">{error.message}</p>
      <div className="mt-1 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to={paths.pipeline()}>Back to Pipeline</Link>
        </Button>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- same false positive as `PanelFallback` above.
function TopLevelFallback({ error }: { error: Error }) {
  return (
    <div
      role="alert"
      className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground [height:100dvh]"
    >
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
      <p className="text-base font-medium">Something went wrong</p>
      <p className="max-w-sm break-words text-sm text-muted-foreground">{error.message}</p>
      {/* A full reload, not `onRetry`/`reset()`: this boundary sits above
          providers and the router, so whatever threw may have left module-
          level or provider state (theme, query cache) in a bad spot that a
          fresh render of the same tree wouldn't clear. A reload always
          starts clean, including picking up a redeployed chunk when the
          throw was a stale lazy-import 404. */}
      <Button size="sm" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  )
}
