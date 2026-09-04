import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import Detail from '@/components/Detail'
import SessionDetail from '@/components/SessionDetail'
import MachineDetail from '@/components/MachineDetail'
import { ShellLayout } from '@/shell/ShellLayout'
import { EmptyDetail } from '@/shell/EmptyDetail'
import { ErrorBoundary } from '@/shell/ErrorBoundary'
import { paths } from '@/routes/paths'
import { ThemeProvider } from '@/components/ui/theme-provider'
import { Toaster } from '@/components/ui/toaster'

// Lazy: xterm.js (#1068) is a sizable dependency that's only needed once a
// user actually taps into a live session's take-over view -- code-splitting
// it out of the main bundle keeps the Home/Detail initial load lean instead
// of shipping the terminal renderer to everyone up front.
const Terminal = lazy(() => import('@/components/Terminal'))

// Lazy for the same reason as Terminal above: react-markdown + remark-gfm
// (#90) are only needed once a reviewer actually opens a Gate-A packet link,
// not on the app's main bundle every visitor loads.
const GateAPanel = lazy(() => import('@/components/GateAPanel'))

// Dev-only component gallery (#1546) — renders every ui/* primitive in both
// themes, so a human (or a Playwright acceptance slice) can see the whole
// system at once without hunting through the app for each one. Route-guarded
// by `import.meta.env.DEV` below so production can never navigate to it; it
// still ends up as its own lazy chunk in `dist/` (Rollup splits on the
// `import()` call site regardless of the guard), so vite.config.ts also
// excludes it from the PWA precache list -- see the comment there.
const Gallery = lazy(() => import('@/components/Gallery'))

/**
 * App root.  BrowserRouter is used here; the dashboard server serves index.html
 * as a SPA fallback for all non-API paths so deep links work on hard reload.
 *
 * Route tree (#1548) — every screen the app can show gets one address:
 *
 *   /                                -> redirect to /pipeline (replace, so
 *                                        it doesn't leave a dead entry back
 *                                        button lands on)
 *   /pipeline                        -> EmptyDetail in the detail slot
 *   /pipeline/:repo/:issue           -> Detail (keyed on repo+issue, not
 *                                        assignment_id -- see Detail.tsx)
 *   /pipeline/:repo/:issue/:tab      -> Detail, tab param threaded through
 *                                        for M-W2 to consume; round-trips
 *                                        today without changing what renders
 *   /sessions                        -> EmptyDetail
 *   /sessions/:id                    -> SessionDetail
 *   /machines                        -> EmptyDetail in the detail slot,
 *                                        `MachinesPanel` (#61) in the list
 *                                        slot (wired in `ShellLayout`) --
 *                                        same list/detail split as
 *                                        /pipeline and /sessions above, not
 *                                        the list-only posture /queue,
 *                                        /reports and /answers below have
 *   /machines/:name                  -> MachineDetail (#61) -- state,
 *                                        health, work-stats and metrics
 *                                        each degrade independently to an
 *                                        honest "unavailable" note against a
 *                                        coord server old enough to predate
 *                                        the real Machines API (#76)
 *   /board /merge-queue
 *   /milestones /audit /spend
 *   /settings                        -> ComingSoon(view) -- placeholders for
 *                                        the M-W2+ panels, addressable today
 *                                        so a link to one isn't a 404 while
 *                                        it's being built
 *   /queue                           -> DriveQueuePanel (QW-3) in the list
 *                                        slot, `element={null}` here same as
 *                                        every route above -- there is no
 *                                        detail view for a queue entry yet
 *                                        (QW-4/QW-5)
 *   /reports                         -> ReportsPanel (#21 RPT-2) in the list
 *                                        slot, same `element={null}` posture
 *                                        as /queue -- no detail view for a
 *                                        report result yet
 *   /answers                         -> AnswersPanel (#59) in the list slot,
 *                                        same `element={null}` posture as
 *                                        /queue and /reports -- the composer
 *                                        for one submission's answer is
 *                                        inline in the list itself, no
 *                                        detail view needed
 *   *  (inside the shell)            -> RouteNotFound -- a real not-found
 *                                        state for a genuinely unknown path,
 *                                        rendered inside the shell (rail,
 *                                        status bar) rather than a blank page
 *   /gate-a/:repo/:trackingIssue     -> GateAPanel (#90) -- a milestone's
 *                                        Gate-A review packet (verdict,
 *                                        contract, mocks). Outside the shell,
 *                                        same as /terminal below: this is a
 *                                        link a reviewer opens directly, not
 *                                        somewhere the app's own nav sends
 *                                        anyone, and the width control it
 *                                        ships needs the full viewport, not
 *                                        rail+list+detail chrome eating into it.
 *
 * Every route below `/pipeline` is a child of `ShellLayout`, the react-router
 * *layout route*: the child fills the detail slot (rail + list + detail on
 * wide, the phone app on narrow) and `ShellLayout` derives the rail selection
 * and the list panel's content from the URL itself (`shellViewFromPath`)
 * rather than from separately persisted state -- see `shellState.ts`'s doc
 * comment.
 *
 * The `/` redirect is deliberately declared *outside* `ShellLayout`, as a
 * sibling of it rather than one of its children. `AppShell` only mounts the
 * detail slot -- the thing that would render a child route's `element` --
 * when `showDetail` is true, and on narrow that's `false` until an item is
 * selected (`detailActive`). A redirect placed under `ShellLayout` therefore
 * silently never fires on a phone-sized cold load at `/`: `Outlet` is never
 * mounted, so `<Navigate>`'s effect never runs, and the shell renders with no
 * matched child at all -- exactly the "genuinely unknown route" case, so it
 * falls through to the `*` not-found state instead of redirecting. Matching
 * `/` *before* composing the shell sidesteps the whole class of bug: nothing
 * about "should this redirect fire" may depend on shell layout state.
 *
 * `/terminal/:sessionId` stays deliberately *outside* the shell for a
 * different reason: the PTY pane wants the whole viewport and brings its own
 * key bar, and framing a terminal in a rail plus a status bar would cost it
 * rows on exactly the device (a phone) where rows are scarcest.
 *
 * The outermost `<ErrorBoundary topLevel>` (#87) is the last resort for a
 * throw *outside* `ShellLayout`'s list/detail slots (which have their own
 * boundaries, see `ShellLayout.tsx`) — a provider above it, the shell itself,
 * or `Terminal`/`Gallery` failing to load as a lazy chunk (the standard
 * stale-precache case for a PWA after a redeploy: the chunk's content hash
 * changed, the old filename 404s, and `React.lazy` throws that during
 * render). It sits above `<BrowserRouter>` deliberately: nothing below it can
 * be assumed to still have router context once it has caught something, so
 * its fallback offers a full page reload rather than an in-app link.
 */
export default function App() {
  return (
    <ErrorBoundary topLevel>
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Navigate to={paths.pipeline()} replace />} />

            <Route element={<ShellLayout />}>
              <Route path="/pipeline" element={<EmptyDetail />} />
              <Route path="/pipeline/:repo/:issue" element={<Detail />} />
              <Route path="/pipeline/:repo/:issue/:tab" element={<Detail />} />

              <Route path="/sessions" element={<EmptyDetail />} />
              <Route path="/sessions/:id" element={<SessionDetail />} />

              {/* #61 -- Machines gets the same list/detail split Pipeline and
                  Sessions have (`MachinesPanel` in the list slot, wired in
                  `ShellLayout`), not the list-only posture Queue/Reports/
                  Answers below use: a machine detail view (state/health/
                  work-stats/metrics) is real content this story ships, not a
                  later addition. */}
              <Route path="/machines" element={<EmptyDetail />} />
              <Route path="/machines/:name" element={<MachineDetail />} />

              {/* Placeholders for the M-W2+ panels (#1548) -- addressable now,
                  not a 404, so a bookmark or a pasted link survives the panel
                  shipping later. The rail marks each of these 'soon' and won't
                  navigate here on a click (railItems.ts); this is what a typed
                  or pasted link to one lands on in the meantime. */}
              <Route path="/board" element={null} />
              <Route path="/merge-queue" element={null} />
              <Route path="/milestones" element={null} />
              <Route path="/audit" element={null} />
              <Route path="/spend" element={null} />
              <Route path="/settings" element={null} />

              {/* The list slot's `DriveQueuePanel` (QW-3) is wired in
                  `ShellLayout`, not here -- this route's own element stays
                  `null` same as every other placeholder above, since there is
                  no detail-slot content for a queue entry yet. Declared
                  explicitly rather than left to fall through to the wildcard
                  below, same as every other placeholder -- this one just
                  happens to be 'ready' (clickable) in the rail already, see
                  railItems.ts. */}
              <Route path="/queue" element={null} />

              {/* The list slot's `ReportsPanel` (#21 RPT-2) is wired in
                  `ShellLayout`, same as `/queue` above — no detail-slot
                  content for a report result yet. */}
              <Route path="/reports" element={null} />

              {/* The list slot's `AnswersPanel` (#59) is wired in
                  `ShellLayout`, same posture as `/queue`/`/reports` above — no
                  detail-slot content for one submission's answer flow, the
                  composer lives inline in the list itself. */}
              <Route path="/answers" element={null} />

              {/* Genuinely unknown path under the shell -- a typo'd URL, or a
                  link to a feature that no longer exists. `ShellLayout` puts
                  `RouteNotFound` in the *list* slot for this case (there is no
                  "current view" to hand a list to); this route's own element
                  stays empty so wide doesn't show the same message twice. */}
              <Route path="*" element={null} />
            </Route>
            <Route
              path="/terminal/:sessionId"
              element={
                <div className="min-h-screen bg-background text-foreground">
                  <Suspense fallback={null}>
                    <Terminal />
                  </Suspense>
                </div>
              }
            />
            <Route
              path="/gate-a/:repo/:trackingIssue"
              element={
                <div className="min-h-screen bg-background text-foreground">
                  <Suspense fallback={null}>
                    <GateAPanel />
                  </Suspense>
                </div>
              }
            />
            {import.meta.env.DEV && (
              <Route
                path="/gallery"
                element={
                  <div className="min-h-screen bg-background text-foreground">
                    <Suspense fallback={null}>
                      <Gallery />
                    </Suspense>
                  </div>
                }
              />
            )}
          </Routes>
        </BrowserRouter>
        <Toaster />
      </ThemeProvider>
    </ErrorBoundary>
  )
}
