/**
 * Pipeline predicates shared between the Pipeline panel and the shell.
 *
 * Lifted out of `Home.tsx` (#1547) because the activity rail needs the same
 * two answers Home's filter tabs need — how many items are in flight, and how
 * many are waiting on a human — and a second, independently-drifting copy of
 * "what counts as active" in the rail would be a lie the moment either
 * definition changed.
 */
import type { PipelineStage, PipelineView } from '@/api/client'

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
 * The two independent facts a stage chip needs to show (#28):
 *
 * - `fill` — the stage's *outcome*: did/will it pass. `'pending'` covers both
 *   "hasn't run yet" and "running right now" — outcome-wise those are the
 *   same unknown, so they render identically; only `ring` (below)
 *   distinguishes "running right now" from "hasn't started".
 * - `ring` — whether this is the stage *currently in flight*, independent of
 *   outcome. Kept off the same visual channel as `fill` on purpose: before
 *   #28, `is_current` was expressed by swapping the chip's fill color, which
 *   conflated "is this happening right now" with "did/will it succeed" into
 *   one color choice.
 */
export type StageChipFill = 'pass' | 'fail' | 'pending' | 'skipped'

export interface StageChipVisual {
  fill: StageChipFill
  ring: boolean
}

/**
 * Single source of truth for stage-chip coloring (#28), shared by
 * `PipelineCard`'s stage chips, `Detail`'s header stage-chip strip, and
 * `Detail`'s merge-section gate-status list — three call sites that, before
 * this, each reimplemented the same completed/current/skipped/waiting →
 * color mapping separately (this repo already has one instance of exactly
 * that class of bug at the cross-repo level, the TUI/coord-web split-brain
 * epic claude-coordinator#2096; no reason to also have it three times within
 * one file).
 *
 * `fill` is verdict-aware where `stage.status`/`current_stage` alone are
 * not: a review that ran fine and came back `request-changes` maps to
 * backend `current_stage = "review_done"` — the exact same value a genuinely
 * *approved* review produces (`coord/pipeline.py` is verdict-blind by
 * design) — so `FAILED_STAGES` (crashed *assignments*, e.g. `review_failed`)
 * never fires for a rejected verdict, and once the review stage is no longer
 * `is_current` it falls into the plain `status === 'completed'` case and
 * renders green regardless of the verdict. Checking `view.review_verdict` /
 * `view.test_verdict` directly closes that gap without touching the backend
 * — `PipelineView` already carries both fields on the wire (visible
 * elsewhere in `Detail.tsx`, e.g. the "Verdict: Changes requested" text),
 * they just weren't consulted by any badge-coloring code before this.
 *
 * Verdict checks run first and win outright — a rejected/failed verdict
 * renders red *regardless* of `stage.status` or whether the stage is still
 * `is_current`, per #28's acceptance bar (this must hold true even before
 * claude-coordinator#2498 — which fixes `current_stage` itself jumping to
 * `merge_ready` without checking `review_verdict` — lands; the two issues
 * are independent).
 */
export function stageChipVisual(stage: PipelineStage, view: PipelineView): StageChipVisual {
  const ring = stage.is_current

  if (stage.name === 'review' && view.review_verdict === 'request-changes') {
    return { fill: 'fail', ring }
  }
  if (stage.name === 'smoke' && view.test_verdict === 'failed') {
    return { fill: 'fail', ring }
  }
  if (stage.is_current && FAILED_STAGES.has(view.current_stage)) {
    return { fill: 'fail', ring }
  }
  if (stage.status === 'completed') {
    return { fill: 'pass', ring }
  }
  if (stage.status === 'skipped') {
    return { fill: 'skipped', ring }
  }
  return { fill: 'pending', ring }
}

/**
 * Shared ring treatment for `stageChipVisual`'s `ring: true` case — kept as
 * one constant so the "this stage is currently in flight" affordance looks
 * the same across all three call sites (badge chips and the merge-section
 * status dots alike) rather than each picking its own.
 */
export const STAGE_CHIP_RING_CLASS = 'ring-2 ring-ring ring-offset-1 ring-offset-background'

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
 * Does `candidate` — which appears *later* in the API's row list than
 * `incumbent` — nonetheless represent a more recent attempt/state for the
 * same issue? (#19)
 *
 * Two signals, in priority order:
 *
 * 1. **`finished_at`, when both rows have one.** This is the same recency
 *    signal the server itself sorts by, so comparing it directly means the
 *    collapse survives a change to (or a bug in) the server's ordering
 *    instead of silently inverting again. Strictly greater wins, so equal
 *    timestamps fall through to rule 2.
 * 2. **Otherwise, array position — earlier wins** (`false` here).
 *    `/api/pipeline` sorts rows *newest-first* (claude-coordinator
 *    `coord/dashboard/server.py`, `reverse=True`, #2066 step 3: "today's
 *    running work above a July failure, not the reverse"), so the FIRST
 *    occurrence of a key is its newest row.
 *
 * Rule 2 is what covers unfinished rows: a still-running attempt has
 * `finished_at === null`, and the server ranks it by `dispatched_at` —
 * a field `PipelineView` does not carry (see `src/api/generated.ts`, which
 * is code-generated and must not be hand-extended), so array position is
 * the only recency signal available for those rows. Deliberately *not*
 * treating `null` as "newest": an abandoned/limbo row that never finished
 * would then permanently outrank a genuinely newer `merged` row — the exact
 * class of bug #19 was.
 *
 * #19 was the inverse of rule 2: the old code kept the LAST occurrence, on a
 * doc comment claiming rows arrive in creation order. Against the real
 * newest-first order that kept each issue's *oldest* attempt, so any issue
 * with a rework cycle rendered its stale row forever — e.g.
 * claude-coordinator#2472 stuck on a red "failed" badge long after it merged,
 * and stuck in the Active tab because `isActive` was evaluated against that
 * stale row rather than the `merged` one.
 */
function supersedes(candidate: PipelineView, incumbent: PipelineView): boolean {
  if (candidate.finished_at != null && incumbent.finished_at != null) {
    return candidate.finished_at > incumbent.finished_at
  }
  return false
}

/**
 * Collapse assignment rows to one per (repo, issue), keeping the most recent
 * row for each key (see `supersedes` for what "most recent" means and why).
 * Earlier attempts are superseded, not discarded — they're still reachable
 * from the detail view's history, just not duplicated here as sibling cards.
 *
 * The result preserves each surviving key's position at the *winning* row's
 * index in `views`, so an issue keeps the place its current state earned in
 * the server's ordering.
 */
export function latestPerIssue(views: PipelineView[]): PipelineView[] {
  const winnerIndexForKey = new Map<string, number>()
  views.forEach((view, i) => {
    const key = issueKey(view)
    const incumbent = winnerIndexForKey.get(key)
    if (incumbent === undefined || supersedes(view, views[incumbent])) {
      winnerIndexForKey.set(key, i)
    }
  })

  const winners = new Set(winnerIndexForKey.values())
  return views.filter((_, i) => winners.has(i))
}

/**
 * The single view representing an issue's current state — the same recency
 * rule `latestPerIssue` uses, for call sites (`Detail.tsx`) that look up one
 * (repo, issue) pair rather than rendering the whole list. Sharing
 * `supersedes` is the point: if this picked a different row than the
 * collapse does, tapping a card would open a detail view describing a
 * different attempt than the card that led there.
 *
 * `issueNumber` accepts a route param string as-is; comparison always
 * converts to string so a leading-zero or malformed URL segment fails the
 * match rather than silently coercing to some other issue's number.
 */
export function findLatestForIssue(
  views: PipelineView[],
  repo: string,
  issueNumber: number | string,
): PipelineView | null {
  let latest: PipelineView | null = null
  for (const view of views) {
    if (view.repo_name !== repo || String(view.issue_number) !== String(issueNumber)) {
      continue
    }
    if (latest === null || supersedes(view, latest)) {
      latest = view
    }
  }
  return latest
}
