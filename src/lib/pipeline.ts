/**
 * Pipeline predicates shared between the Pipeline panel and the shell.
 *
 * Lifted out of `Home.tsx` (#1547) because the activity rail needs the same
 * two answers Home's filter tabs need — how many items are in flight, and how
 * many are waiting on a human — and a second, independently-drifting copy of
 * "what counts as active" in the rail would be a lie the moment either
 * definition changed.
 */
import type { PipelineView } from '@/api/client'

/**
 * `current_stage` values that are terminal failures. Exported (rather than
 * kept as a private copy per module, as it was before #2's review pass) so
 * `PipelineCard` and `Detail`'s "Failed" badge and this module's staleness
 * filter share one definition — a second, independently-drifting copy would
 * let a new terminal-failure stage silently desync the badge from the
 * filter.
 */
export const FAILED_STAGES = new Set(['failed', 'review_failed', 'smoke_failed'])

/**
 * #2: how long a *failed* item stays visible in the Active tab before it's
 * treated as stale. The reported defect was a run that finished 34 days
 * earlier still rendering as the top Active card, badged "Failed" — because
 * a terminal failure typically has a retry gate available, it sorted to
 * priority 0 (needs-me) ahead of that night's actually-running work.
 *
 * Scoped to failures only, not every terminal stage: `merged` items are
 * already unconditionally excluded below, and the "done-ish"
 * waiting-on-a-gate bucket (`done`/`review_done`/`smoke_passed`/
 * `merge_ready`) is already demoted into the collapsed, recency-sorted
 * "Work done" section by `Home.tsx`'s `groupActiveItems` (#1218) —
 * time-boxing that bucket too is a separate product call. A stale failure
 * doesn't vanish from the app: it's still surfaced, unaged, under "Needs me"
 * (`needsMe` below has no recency check), so nothing actionable is lost —
 * only demoted out of "what's happening right now".
 */
const STALE_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * `finished_at` is unix seconds (server-side epoch, see
 * `PipelineView.finished_at`). Takes `now` (ms) explicitly, rather than
 * reading `Date.now()` itself, purely so tests can pin it against fixture
 * data — exported so those tests don't have to go through `isActive`.
 *
 * Deliberately single-purpose (not the thing `Array.prototype.filter`
 * calls directly): `filter` invokes its callback with `(element, index,
 * array)`, and a same-named `now` parameter with a `= Date.now()` default
 * would silently receive that `index` instead — a real bug hit while
 * writing this (index 0 or 1 reads as "now" way before any real
 * `finished_at`, so nothing is ever stale). `isActive` below stays
 * single-argument so every existing `.filter(isActive)` call site keeps
 * working without that footgun.
 */
export function isStaleFailure(view: PipelineView, now: number): boolean {
  return (
    FAILED_STAGES.has(view.current_stage) &&
    view.finished_at != null &&
    now - view.finished_at * 1000 > STALE_FAILURE_WINDOW_MS
  )
}

/**
 * "Active": items that haven't finished (current_stage !== "merged") and
 * aren't a stale failure (see `isStaleFailure`). Single-argument so it's
 * always safe to pass directly to `Array.prototype.filter`.
 */
export function isActive(view: PipelineView): boolean {
  return view.current_stage !== 'merged' && !isStaleFailure(view, Date.now())
}

/**
 * "Needs me": items where at least one human gate action is available.
 * E.g.: work done (needs test dispatch), review approved (needs merge queue),
 * smoke passed (needs merge queue), merge ready (needs merge), failures (need
 * retry/fix).
 *
 * Deliberately has no recency check — it's the permanent, unaged home for
 * anything actionable, so time-boxing `isActive` above can never make an
 * item that still needs a human genuinely disappear from the app.
 */
export function needsMe(view: PipelineView): boolean {
  return view.available_gates.length > 0
}

/**
 * Identity for "the same work item" across assignment rows (#2, defect 3).
 * `/api/pipeline` returns one row per *assignment* — a rework cycle
 * (request-changes attempt, then its approve fix-1) or a multi-stage
 * pipeline (work, review, merge) all file separate `assignment_id` rows for
 * the same (repo, issue) pair, so a raw row count overstates the number of
 * issues actually being tracked.
 */
function issueKey(view: PipelineView): string {
  return `${view.repo_name}#${view.issue_number}`
}

/**
 * Collapse assignment rows to one per (repo, issue), keeping the LAST
 * occurrence of each key. `/api/pipeline` lists assignment rows in creation
 * order, so an issue's last row is its most recent attempt/state — the one
 * a single card should represent; earlier attempts are superseded, not
 * discarded (they're still reachable from the detail view's history, not
 * duplicated here as sibling cards).
 *
 * The result preserves each surviving key's position at its LAST
 * occurrence's index in `views`, not its first — so an issue with a recent
 * rework attempt sorts by that attempt's place in the list, not the
 * original one's.
 */
export function latestPerIssue(views: PipelineView[]): PipelineView[] {
  const lastIndexForKey = new Map<string, number>()
  views.forEach((view, i) => lastIndexForKey.set(issueKey(view), i))

  const result: PipelineView[] = []
  views.forEach((view, i) => {
    if (lastIndexForKey.get(issueKey(view)) === i) {
      result.push(view)
    }
  })
  return result
}

/**
 * The single view representing an issue's current state — the same "last
 * occurrence wins" rule `latestPerIssue` uses, for call sites (`Detail.tsx`)
 * that look up one (repo, issue) pair rather than rendering the whole list.
 * `issueNumber` accepts a route param string as-is; comparison always
 * converts to string so a leading-zero or malformed URL segment fails the
 * match rather than silently coercing to some other issue's number.
 */
export function findLatestForIssue(
  views: PipelineView[],
  repo: string,
  issueNumber: number | string,
): PipelineView | null {
  for (let i = views.length - 1; i >= 0; i--) {
    const view = views[i]
    if (view.repo_name === repo && String(view.issue_number) === String(issueNumber)) {
      return view
    }
  }
  return null
}
