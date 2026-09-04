/**
 * The route tree, in one place (#1548).
 *
 * Every screen the app can show has exactly one URL shape, built here rather
 * than string-templated at each call site — a repo name with a `/` in it (a
 * `owner/name` slug) or an id that needs escaping is a bug every hand-rolled
 * template has to remember on its own; a path builder only has to get it
 * right once. `Home`, `Detail`, `SessionsList`, `ShellLayout` and the e2e
 * specs all import from here instead of writing template literals.
 *
 * `PipelineView` (see `src/api/generated.ts`) has no stable per-assignment
 * URL-friendly id worth betting a bookmark on — `assignment_id` is one
 * *attempt* at an issue (work, then a fix, then another fix carry different
 * assignment ids for the same issue) — so the pipeline item route keys on
 * `repo_name` + `issue_number`, which is what a human means by "that issue"
 * and what a link pasted into a GitHub comment or Slack would naturally
 * carry.
 */
import { type ShellView } from '@/shell/shellState'

/** The `PipelineDetailTab` set (`docs/mocks/web/issue-detail.html`), minus
 * Terminal — the tab *content* is M-W2 scope; this route tree only needs to
 * know the tab is addressable and round-trips. `overview` is the default and
 * is never present in a generated URL (see `pipelineItem` below). */
export const DETAIL_TABS = ['overview', 'issue', 'log', 'findings', 'summary'] as const
export type DetailTab = (typeof DETAIL_TABS)[number]

export function isDetailTab(value: string | undefined): value is DetailTab {
  return !!value && (DETAIL_TABS as readonly string[]).includes(value)
}

/** Path builders. Every one returns an absolute, already-encoded path. */
export const paths = {
  pipeline: () => '/pipeline',
  /** `tab` omitted (or `'overview'`) collapses to the two-segment form —
   * `/pipeline/repo/42`, not `/pipeline/repo/42/overview` — so the common
   * case stays the short, shareable URL. */
  pipelineItem: (repo: string, issue: number | string, tab?: DetailTab): string => {
    const base = `/pipeline/${encodeURIComponent(repo)}/${encodeURIComponent(String(issue))}`
    return tab && tab !== 'overview' ? `${base}/${tab}` : base
  },
  sessions: () => '/sessions',
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`,
  terminal: (sessionId: string) => `/terminal/${encodeURIComponent(sessionId)}`,
  board: () => '/board',
  machines: () => '/machines',
  /** #61 — a single machine's detail view, same list -> detail addressing
   * convention `session()` uses: every screen reachable and restorable from
   * its own URL, per the route contract #1548 established. */
  machineItem: (name: string) => `/machines/${encodeURIComponent(name)}`,
  mergeQueue: () => '/merge-queue',
  milestones: () => '/milestones',
  /** #91 — one milestone's ordered work order + Gate-A sign-off. Keyed on
   * `repo` + GitHub's own milestone *number* (not the tracking issue, and
   * not a slug): that pair is what `GET /api/milestones/{repo}/{number}`
   * takes and what `ms-N` means everywhere else in the system
   * (`tests/acceptance/ms-N/`, `coord gate-a`'s own messages). Same
   * list -> detail addressing convention `machineItem`/`session` use. */
  milestoneItem: (repo: string, number: number | string): string =>
    `/milestones/${encodeURIComponent(repo)}/${encodeURIComponent(String(number))}`,
  queue: () => '/queue',
  audit: () => '/audit',
  spend: () => '/spend',
  /** #21 RPT-2 — this contract's own choice (`tests/acceptance/ms-2/
   * contract.md` §1b/§7.2), mirroring `paths.queue()`; no issue body names
   * either the path or this builder. */
  reports: () => '/reports',
  /** #59 — the Answers screen (record an out-of-band client answer against a
   * `needs-input` submission's open question), same route-naming posture as
   * `queue()`/`reports()` above: no issue body names the path, this is this
   * story's own choice. */
  answers: () => '/answers',
  settings: () => '/settings',
  /** #90 — a milestone's Gate-A review packet (verdict, contract, mocks),
   * standalone like `terminal()` above rather than a rail-nav'd `ShellView`:
   * the point is a link a reviewer opens directly (phone, screen share), not
   * a place someone browses to from the app's own nav — see App.tsx's route
   * comment for why `/terminal/:sessionId` and this route both sit outside
   * `ShellLayout`. */
  gateA: (repo: string, trackingIssue: number | string) =>
    `/gate-a/${encodeURIComponent(repo)}/${encodeURIComponent(String(trackingIssue))}`,
} as const

/**
 * Base path (no `:id`/`:tab`) for every rail-selectable view — what
 * `ActivityRail`'s `onSelect` navigates to. Views with no route of their own
 * (`terminal` is opened *from* a session, never navigated to directly) are
 * omitted; `ActivityRail` never offers them as clickable (see
 * `railItems.ts`'s `'soon'`/no-nav entries) so there is nothing to look up
 * for those, but `Partial` keeps that honest here too rather than papering
 * over it with a route that doesn't exist.
 */
export const RAIL_VIEW_PATH: Partial<Record<ShellView, string>> = {
  pipeline: paths.pipeline(),
  board: paths.board(),
  sessions: paths.sessions(),
  machines: paths.machines(),
  'merge-queue': paths.mergeQueue(),
  milestones: paths.milestones(),
  queue: paths.queue(),
  audit: paths.audit(),
  spend: paths.spend(),
  reports: paths.reports(),
  answers: paths.answers(),
  settings: paths.settings(),
}

/**
 * The inverse of `RAIL_VIEW_PATH` — which rail view a URL belongs to, for
 * highlighting the right rail entry and picking the right list panel on cold
 * load. `null` means the path doesn't belong to any known view (root `/`,
 * `/terminal/...`, or a genuinely unknown route) — callers decide what that
 * means for them rather than this function guessing a fallback.
 */
export function shellViewFromPath(pathname: string): ShellView | null {
  const entries = Object.entries(RAIL_VIEW_PATH) as Array<[ShellView, string]>
  // Longest prefix first: without this, '/merge-queue' would never win
  // because nothing here is a prefix of it *except* itself, but this guards
  // future entries where one path is a literal prefix of another.
  const sorted = entries.sort((a, b) => b[1].length - a[1].length)
  for (const [view, base] of sorted) {
    if (pathname === base || pathname.startsWith(`${base}/`)) return view
  }
  return null
}
