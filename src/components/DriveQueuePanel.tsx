/**
 * DriveQueuePanel — the Queue panel's list-slot content (#7 QW-3, reworked
 * to expandable rows by #82).
 *
 * It is the *list panel's* content, not a screen (#1547, same convention
 * `Home.tsx` documents): `ShellLayout` owns the frame and renders this
 * component into the list slot for the `/queue` route.
 *
 * Three pieces, in the order the epic's mock stacks them:
 *  1. A **summary block** of five stats (pending / running / waiting+eligible
 *     / blocked / held), read verbatim off `GET /api/drive-queue`'s
 *     server-computed aggregate -- never recomputed from `entries` here, see
 *     `src/lib/driveQueue.ts`'s doc comment for why that matters. Computed
 *     over the *raw* entry list, deliberately -- the aggregate is a
 *     server-side count over the whole table, not something the active-entry
 *     filter below should touch.
 *  2. A **repo-scope dropdown** ("All repos" | one repo at a time), filtering
 *     the grid client-side over a single unscoped fetch (again, see
 *     `src/lib/driveQueue.ts`).
 *  3. The **grid** itself, now **expandable rows** (#82, superseding #10's
 *     "same nine columns as the TUI, same order" parity rule by deliberate
 *     operator decision -- the TUI's Queue panel lives in a different repo
 *     now, JDonaghy/coord-tui, and isn't required to follow this redesign).
 *     At rest a row renders exactly three columns -- `Issue`, `Title`,
 *     `State` -- plus a disclosure control; everything else (`#` position,
 *     `After`, `Hold`, `Reason` wrapped in full, the `enqueued_at`
 *     /`launched_at`/`reason_at` timestamps, the live `Machine` +
 *     optional `--machine` pin, the honest `attempts`/`deferrals`/`resumes`
 *     counts, and the `Actions` buttons) lives in a `<dl>` revealed per-row
 *     on demand. `Machine` (always empty in the old column -- it rendered
 *     the pin, not the live machine) and `Tries` (a single relaunch counter,
 *     actively misleading per claude-coordinator#2972) are dropped outright;
 *     `#work`/`#smoke`/`#reviews` leg counts are gated on
 *     JDonaghy/code-coordinator#3060 landing a coordinator-side field and are
 *     NOT shipped here as a guess -- see `src/lib/driveQueue.ts`'s doc
 *     comment.
 *
 * Expansion state (`expandedKeys`) is keyed by `queueEntryKey(entry)`
 * (`repo#issue`), never by row index or `position` -- it must survive both a
 * background refetch and a ▲/▼ reorder that renumbers rows. Multiple rows
 * can be open at once; nothing auto-collapses on poll.
 *
 * Both the dropdown and the grid are fed `entries` only after
 * `filterActiveQueueEntries` has dropped terminal (`done`) rows -- see that
 * function's doc comment in `src/lib/driveQueue.ts`. `drive_queue` rows are
 * marked `done` in place rather than deleted, so without this filter the
 * grid would accumulate every completed queue entry ever recorded.
 *
 * The **Actions** region (#8 QW-4, moved into the expanded `<dl>` by #82 as a
 * direct consequence of "only three columns at rest"): per-row ▲/▼ reorder,
 * unblock and release-gate mini buttons. Every guard mirrors what the TUI
 * itself enforces before mutating (`canUnblockQueueEntry` /
 * `canReleaseQueueGate` / `queueMoveNeighbor` in `src/lib/driveQueue.ts`) --
 * a button that doesn't apply to a row renders *disabled with a tooltip*,
 * never hidden, so the action's existence stays discoverable (the standing
 * "rich client, not hotkeys" feedback this codebase has had before).
 *
 * The **Issue** cell (#9 QW-5) is a `<Link>` to `paths.pipelineItem`, for
 * in-app SPA navigation, plus a small secondary `<a target="_blank">`
 * affordance right next to it. Plain `<Link>`/`<a>` semantics already give
 * ctrl/cmd-click-to-new-tab for free, so the second element isn't there to
 * make new-tab *possible* -- it's there to make it *discoverable* without
 * relying on a modifier click nobody's told about.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  driveQueueAction,
  fetchDriveQueue,
  fetchPipeline,
  type BoardDriveQueueEntry,
  type DriveQueueAction,
  type DriveQueueData,
} from '@/api/client'
import { PanelHeader } from '@/components/PanelHeader'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { paths } from '@/routes/paths'
import { issueRef } from '@/lib/repoRef'
import {
  applyQueueMoveOptimistic,
  buildQueueMachineLookup,
  buildQueueTitleLookup,
  canReleaseQueueGate,
  canUnblockQueueEntry,
  driveQueueRepoOptions,
  driveQueueSummaryStats,
  filterActiveQueueEntries,
  filterQueueEntriesByRepo,
  QUEUE_EMPTY_CELL,
  queueAfterCell,
  queueEnqueuedCell,
  queueEntryKey,
  queueHoldCell,
  queueLaunchedCell,
  queueLiveMachineCell,
  queueMoveNeighbor,
  queuePinnedMachine,
  queueReasonAtCell,
  queueReasonCell,
  queueStateCell,
  queueTitleCell,
} from '@/lib/driveQueue'

/** The dropdown's "All repos" option value -- not a real repo name, so it
 * can never collide with one. */
const ALL_REPOS = ''

interface GridColumn {
  key: string
  label: string
  /** Visually hidden (but still in the accessible name) -- the leading
   * disclosure column has no need for a printed header, but a screen reader
   * user tabbing through `<th>`s still deserves to know what it is. */
  srOnly?: boolean
}

/** The three columns visible at rest (#82) -- `#`, `Machine`, `Tries` and
 * `Actions` all moved into the per-row expanded `<dl>`; see this file's own
 * doc comment for the full rationale and JDonaghy/coord-tui for where the
 * old nine-column TUI parity now lives instead. */
const GRID_COLUMNS: readonly GridColumn[] = [
  { key: 'disclosure', label: 'Expand', srOnly: true },
  { key: 'issue', label: 'Issue' },
  { key: 'title', label: 'Title' },
  { key: 'state', label: 'State' },
]

/** `colSpan` for the expanded-detail `<td>` -- one cell wide per collapsed
 * column, so the `<dl>` spans the full table width. */
const GRID_COLSPAN = GRID_COLUMNS.length

/** State -> `Badge` variant. An unrecognised state renders `outline`
 * (neutral) rather than silently reading as healthy -- same posture
 * `dq_state_colors` documents in `tui/src/app/drive_queue.rs` for an
 * unrecognised state from a newer daemon. */
function stateBadgeVariant(state: string): BadgeProps['variant'] {
  switch (state) {
    case 'running':
      return 'success'
    case 'blocked':
      return 'destructive'
    case 'waiting':
      return 'secondary'
    default:
      return 'outline'
  }
}

/** Display spelling for an entry's issue ref (#46) -- `RA#9101`, never
 * `repo-alpha#9101`. `queueEntryKey(entry)` stays the wire/identity format
 * (React `key`, `busyKey`) and must not be routed through this; this is for
 * visible text, aria-labels and toast descriptions only. */
function entryRef(entry: BoardDriveQueueEntry): string {
  return issueRef(entry.repo_name, entry.issue_number)
}

/** DOM `id` for a row's expanded-detail region, derived from
 * `queueEntryKey(entry)` -- stable across reorders/refetches for the same
 * reason `expandedKeys` itself is keyed that way (#82), and sanitised to
 * only the characters HTML `id`/`aria-controls` linking should rely on
 * (`repo#issue` contains a `#`, which is valid but needlessly fragile to
 * carry into a selector-adjacent attribute). */
function queueRowDetailId(entry: BoardDriveQueueEntry): string {
  return `queue-row-detail-${queueEntryKey(entry).replace(/[^A-Za-z0-9_-]/g, '-')}`
}

// ── row actions (#8 QW-4) ───────────────────────────────────────────────────

interface QueueActionButtonProps {
  /** Visible glyph/label. */
  children: ReactNode
  /** Screen-reader name and native-tooltip text while enabled. */
  label: string
  /** Native-tooltip text while `disabled` -- explains *why*, not just *that*,
   * per the issue's "disabled + tooltip, not hidden" ask. */
  disabledReason?: string
  onClick: () => void
  disabled: boolean
  busy: boolean
}

/**
 * One mini icon/text button in the Actions cell. `title` (not a Radix
 * tooltip) carries the discoverability -- a native attribute keeps working
 * on a `disabled` button without extra plumbing, same convention
 * `ThemeToggle` already uses for its own icon button.
 *
 * `busy` overrides the label with an ellipsis and forces `disabled` --
 * showing the pending state immediately on click is the issue's explicit
 * bar: "a queued action with no UI change reads as hung".
 */
function QueueActionButton({
  children,
  label,
  disabledReason,
  onClick,
  disabled,
  busy,
}: QueueActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={label}
      aria-busy={busy}
      title={busy ? 'Working…' : disabled ? (disabledReason ?? label) : label}
      className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border px-1 text-[.7rem] leading-none text-foreground enabled:hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? '…' : children}
    </button>
  )
}

export default function DriveQueuePanel() {
  const [repoScope, setRepoScope] = useState<string>(ALL_REPOS)

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['drive-queue'],
    queryFn: () => fetchDriveQueue(),
  })

  // Cache read, not a second fetch: `ShellLayout` already keeps `['pipeline']`
  // warm (for the rail's in-flight count) on every route under the shell,
  // `/queue` included -- this borrows it to resolve issue titles the raw
  // `drive_queue` table doesn't carry. See `buildQueueTitleLookup`'s doc
  // comment.
  const { data: pipeline } = useQuery({ queryKey: ['pipeline'], queryFn: fetchPipeline })

  const entries = useMemo<BoardDriveQueueEntry[]>(() => data?.entries ?? [], [data])
  // `entries` is the raw, unfiltered `drive_queue` table dump -- terminal
  // `done` rows accumulate there forever (see `filterActiveQueueEntries`'s
  // doc comment). Drop them before they can reach either the repo-scope
  // dropdown's option list or the grid.
  const activeEntries = useMemo(() => filterActiveQueueEntries(entries), [entries])
  const repoOptions = useMemo(() => driveQueueRepoOptions(activeEntries), [activeEntries])
  const scopedEntries = useMemo(
    () => filterQueueEntriesByRepo(activeEntries, repoScope || null),
    [activeEntries, repoScope],
  )
  const titleByKey = useMemo(() => buildQueueTitleLookup(pipeline ?? []), [pipeline])
  const machineByKey = useMemo(() => buildQueueMachineLookup(pipeline ?? []), [pipeline])
  const summaryStats = data ? driveQueueSummaryStats(data.summary) : []

  // ── per-row expand/collapse (#82) ─────────────────────────────────────────
  // Keyed by `queueEntryKey(entry)` (`repo#issue`), never row index or
  // `position` -- both change under a background refetch or a ▲/▼ reorder,
  // and expansion must survive either. A `Set` (not a single "which row is
  // open" value) so multiple rows can be open at once, and nothing
  // auto-collapses on poll since this state never gets cleared by a refetch.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const toggleExpanded = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })

  // ── row actions (#8 QW-4) ─────────────────────────────────────────────────

  const queryClient = useQueryClient()
  // Keyed `${repo}#${issue}:${variant}` -- a Set rather than a single
  // "one action at a time" flag (Detail.tsx's `inFlight`) so clicking Unblock
  // on one row doesn't grey out the Release button three rows down; only the
  // button that's actually in flight shows busy. `variant` is a *display*
  // key, not the wire `DriveQueueAction` -- move-up and move-down both send
  // `action: 'move'`, but need to busy independently since they're two
  // different buttons on the same row.
  type QueueActionVariant = 'move-up' | 'move-down' | 'unblock' | 'resume'
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set())

  const busyKey = (entry: BoardDriveQueueEntry, variant: QueueActionVariant) =>
    `${queueEntryKey(entry)}:${variant}`

  const runQueueAction = async (
    entry: BoardDriveQueueEntry,
    variant: QueueActionVariant,
    action: DriveQueueAction,
    extra: Record<string, unknown> | undefined,
    successMessage: string,
  ) => {
    const key = busyKey(entry, variant)
    if (busyKeys.has(key)) return
    setBusyKeys((prev) => new Set(prev).add(key))
    try {
      const result = await driveQueueAction({
        repo_name: entry.repo_name,
        issue_number: entry.issue_number,
        action,
        ...extra,
      })
      if (result.ok) {
        toast({ variant: 'success', title: successMessage, description: entryRef(entry) })
      } else {
        toast({
          variant: 'destructive',
          title: 'Action failed',
          description: result.error ?? entryRef(entry),
        })
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Action failed',
        description: e instanceof Error ? e.message : entryRef(entry),
      })
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      // Refetch regardless of outcome: a successful mutation needs the real
      // post-action row (state/hold_state drive the very guards these
      // buttons render from); a failure needs it too, to drop the `move`
      // optimistic reorder below back to whatever the server actually has --
      // "reconcile on the next poll", just pulled forward to "as soon as we
      // know" rather than waiting on SSE/window-focus.
      void queryClient.invalidateQueries({ queryKey: ['drive-queue'] })
    }
  }

  const handleUnblock = (entry: BoardDriveQueueEntry) =>
    void runQueueAction(entry, 'unblock', 'unblock', undefined, 'Unblocked')

  const handleReleaseGate = (entry: BoardDriveQueueEntry) =>
    void runQueueAction(entry, 'resume', 'resume', undefined, 'Gate released')

  const handleMove = (entry: BoardDriveQueueEntry, direction: 'up' | 'down') => {
    const neighbor = queueMoveNeighbor(scopedEntries, entry, direction)
    if (!neighbor) return
    // Optimistic reorder (issue's explicit allowance for `move`, not required
    // for the other actions): swap the two positions in the query cache's
    // *raw* entry list right away, so the row visibly moves before the
    // request even resolves, rather than sitting still until the next poll.
    queryClient.setQueryData<DriveQueueData>(['drive-queue'], (old) =>
      old ? { ...old, entries: applyQueueMoveOptimistic(old.entries, entry, neighbor) } : old,
    )
    void runQueueAction(
      entry,
      direction === 'up' ? 'move-up' : 'move-down',
      'move',
      { to_position: neighbor.position },
      direction === 'up' ? 'Moved up' : 'Moved down',
    )
  }

  return (
    <div className="mx-auto w-full px-4 py-4">
      <PanelHeader title="Queue" count={data ? scopedEntries.length : undefined} countLabel="in view">
        {isFetching && !isLoading && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-label="Refreshing" />
        )}
      </PanelHeader>

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading queue…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load the drive queue</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Summary block */}
          <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Queue summary">
            {summaryStats.map((stat) => (
              <div key={stat.key} className="rounded-lg border border-border bg-card px-3 py-2">
                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </dt>
                <dd className="mt-0.5 font-mono text-sm text-card-foreground">{stat.value}</dd>
              </div>
            ))}
          </dl>

          {/* Repo-scope dropdown */}
          <div className="mb-4 flex items-center gap-2">
            <label htmlFor="drive-queue-repo-scope" className="text-xs text-muted-foreground">
              Repo
            </label>
            <select
              id="drive-queue-repo-scope"
              value={repoScope}
              onChange={(event) => setRepoScope(event.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground"
            >
              <option value={ALL_REPOS}>All repos</option>
              {repoOptions.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
          </div>

          {/* Grid — three columns at rest, no min-width floor (#82): the
              collapsed row never needs a horizontal scroller, at any of the
              three shell breakpoints (src/shell/breakpoints.ts). The wrapper
              stays `overflow-x-auto` only as a defensive fallback, not
              because the grid is expected to overflow in normal use. */}
          {scopedEntries.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-muted-foreground">
                    {GRID_COLUMNS.map((col) => (
                      <th key={col.key} scope="col" className="px-3 py-2 font-medium">
                        {col.srOnly ? <span className="sr-only">{col.label}</span> : col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scopedEntries.map((entry) => {
                    const key = queueEntryKey(entry)
                    const expanded = expandedKeys.has(key)
                    const detailId = queueRowDetailId(entry)
                    const canMoveUp = queueMoveNeighbor(scopedEntries, entry, 'up') !== null
                    const canMoveDown = queueMoveNeighbor(scopedEntries, entry, 'down') !== null
                    const canUnblock = canUnblockQueueEntry(entry)
                    const canRelease = canReleaseQueueGate(entry)
                    const pinnedMachine = queuePinnedMachine(entry)
                    return (
                      <Fragment key={key}>
                        <tr className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(key)}
                              aria-expanded={expanded}
                              aria-controls={detailId}
                              aria-label={`${expanded ? 'Collapse' : 'Expand'} details for ${entryRef(entry)}`}
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                            >
                              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                            </button>
                          </td>
                          <td className="px-3 py-2 font-mono">
                            <div className="flex items-center gap-1">
                              <Link
                                to={paths.pipelineItem(entry.repo_name, entry.issue_number)}
                                className="hover:underline"
                              >
                                {entryRef(entry)}
                              </Link>
                              <a
                                href={paths.pipelineItem(entry.repo_name, entry.issue_number)}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${entryRef(entry)} in a new tab`}
                                title="Open in new tab"
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </a>
                            </div>
                          </td>
                          <td className="px-3 py-2">{queueTitleCell(entry, titleByKey)}</td>
                          <td className="px-3 py-2">
                            <Badge variant={stateBadgeVariant(entry.state)}>{queueStateCell(entry)}</Badge>
                          </td>
                        </tr>
                        {/* Expanded detail region -- always in the DOM (not
                            conditionally mounted) so `aria-controls` always
                            addresses a real element; visibility is the
                            native `hidden` attribute, same posture a table
                            row needs to disappear cleanly (`[hidden]`'s
                            `display: none` beats the UA `display:
                            table-row`). */}
                        <tr id={detailId} hidden={!expanded} className="border-b border-border/60 last:border-0">
                          <td colSpan={GRID_COLSPAN} className="bg-secondary/20 px-3 py-3">
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  #
                                </dt>
                                <dd className="font-mono">{entry.position}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  After
                                </dt>
                                <dd>{queueAfterCell(entry)}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Hold
                                </dt>
                                <dd>{queueHoldCell(entry)}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Machine
                                </dt>
                                <dd>{queueLiveMachineCell(entry, machineByKey)}</dd>
                              </div>
                              {pinnedMachine && (
                                <div>
                                  <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                    Pinned to
                                  </dt>
                                  <dd>{pinnedMachine}</dd>
                                </div>
                              )}
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Enqueued
                                </dt>
                                <dd>{queueEnqueuedCell(entry)}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Launched
                                </dt>
                                <dd>{queueLaunchedCell(entry)}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Reason updated
                                </dt>
                                <dd>{queueReasonAtCell(entry)}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Attempts
                                </dt>
                                <dd className="font-mono">{entry.attempts}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Deferrals
                                </dt>
                                <dd className="font-mono">{entry.deferrals}</dd>
                              </div>
                              <div>
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Resumes
                                </dt>
                                <dd className="font-mono">{entry.resumes}</dd>
                              </div>
                              <div className="col-span-full">
                                <dt className="text-[.65rem] uppercase tracking-wide text-muted-foreground">
                                  Reason
                                </dt>
                                <dd className="whitespace-pre-wrap break-words">
                                  {queueReasonCell(entry)}
                                </dd>
                              </div>
                            </dl>

                            <div className="mt-3 flex items-center gap-1">
                              <QueueActionButton
                                label={`Move ${entryRef(entry)} up`}
                                disabledReason="Already first in view"
                                onClick={() => handleMove(entry, 'up')}
                                disabled={!canMoveUp}
                                busy={busyKeys.has(busyKey(entry, 'move-up'))}
                              >
                                ▲
                              </QueueActionButton>
                              <QueueActionButton
                                label={`Move ${entryRef(entry)} down`}
                                disabledReason="Already last in view"
                                onClick={() => handleMove(entry, 'down')}
                                disabled={!canMoveDown}
                                busy={busyKeys.has(busyKey(entry, 'move-down'))}
                              >
                                ▼
                              </QueueActionButton>
                              <QueueActionButton
                                label={`Unblock ${entryRef(entry)}`}
                                disabledReason={`Only a blocked row can be unblocked (state: ${entry.state || QUEUE_EMPTY_CELL})`}
                                onClick={() => handleUnblock(entry)}
                                disabled={!canUnblock}
                                busy={busyKeys.has(busyKey(entry, 'unblock'))}
                              >
                                Unblock
                              </QueueActionButton>
                              <QueueActionButton
                                label={`Release ${entryRef(entry)}'s gate`}
                                disabledReason="Only a fired gate can be released"
                                onClick={() => handleReleaseGate(entry)}
                                disabled={!canRelease}
                                busy={busyKeys.has(busyKey(entry, 'resume'))}
                              >
                                Release
                              </QueueActionButton>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-foreground">
                {repoScope ? `No pending entries for ${repoScope}` : 'The drive queue is empty'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
