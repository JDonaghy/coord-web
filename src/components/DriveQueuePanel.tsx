/**
 * DriveQueuePanel — the Queue panel's list-slot content (#7 QW-3).
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
 *  3. The **grid** itself: nine columns in column-for-column parity with the
 *     TUI's `QUEUE_COLUMNS` (`tui/src/app/drive_queue.rs`) -- `#`, `Issue`,
 *     `Title`, `State`, `Machine`, `Tries`, `After`, `Hold`, `Reason` -- plus
 *     a tenth, web-only `Actions` column (see below).
 *
 * Both the dropdown and the grid are fed `entries` only after
 * `filterActiveQueueEntries` has dropped terminal (`done`) rows -- see that
 * function's doc comment in `src/lib/driveQueue.ts`. `drive_queue` rows are
 * marked `done` in place rather than deleted, so without this filter the
 * grid would accumulate every completed queue entry ever recorded.
 *
 * A tenth **Actions** column (#8 QW-4) rounds out the grid: per-row ▲/▼
 * reorder, unblock and release-gate mini buttons. Every guard mirrors what
 * the TUI itself enforces before mutating (`canUnblockQueueEntry` /
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
import { useMemo, useState, type ReactNode } from 'react'
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
import { cn } from '@/lib/utils'
import { issueRef } from '@/lib/repoRef'
import {
  applyQueueMoveOptimistic,
  buildQueueTitleLookup,
  canReleaseQueueGate,
  canUnblockQueueEntry,
  driveQueueRepoOptions,
  driveQueueSummaryStats,
  filterActiveQueueEntries,
  filterQueueEntriesByRepo,
  QUEUE_EMPTY_CELL,
  queueAfterCell,
  queueEntryKey,
  queueHoldCell,
  queueMachineCell,
  queueMoveNeighbor,
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
  align?: 'right'
}

/** Column parity with `Self::QUEUE_COLUMNS` in `tui/src/app/drive_queue.rs`
 * for the first nine -- `Actions` (#8 QW-4) is a web-only tenth column, the
 * TUI's own reorder/unblock/release affordances are key bindings rather than
 * a rendered column. */
const GRID_COLUMNS: readonly GridColumn[] = [
  { key: 'position', label: '#', align: 'right' },
  { key: 'issue', label: 'Issue' },
  { key: 'title', label: 'Title' },
  { key: 'state', label: 'State' },
  { key: 'machine', label: 'Machine' },
  { key: 'tries', label: 'Tries', align: 'right' },
  { key: 'after', label: 'After' },
  { key: 'hold', label: 'Hold' },
  { key: 'reason', label: 'Reason' },
  { key: 'actions', label: 'Actions' },
]

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
  const summaryStats = data ? driveQueueSummaryStats(data.summary) : []

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

          {/* Grid — responsive: scrolls horizontally rather than squeezing
              columns below readability on a narrow viewport. */}
          {scopedEntries.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/40 text-muted-foreground">
                    {GRID_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={cn('px-3 py-2 font-medium', col.align === 'right' && 'text-right')}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scopedEntries.map((entry) => {
                    const canMoveUp = queueMoveNeighbor(scopedEntries, entry, 'up') !== null
                    const canMoveDown = queueMoveNeighbor(scopedEntries, entry, 'down') !== null
                    const canUnblock = canUnblockQueueEntry(entry)
                    const canRelease = canReleaseQueueGate(entry)
                    return (
                      <tr key={queueEntryKey(entry)} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 text-right font-mono">{entry.position}</td>
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
                        <td className="max-w-[220px] truncate px-3 py-2">
                          {queueTitleCell(entry, titleByKey)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={stateBadgeVariant(entry.state)}>{queueStateCell(entry)}</Badge>
                        </td>
                        <td className="px-3 py-2">{queueMachineCell(entry)}</td>
                        <td className="px-3 py-2 text-right font-mono">{entry.attempts}</td>
                        <td className="px-3 py-2">{queueAfterCell(entry)}</td>
                        <td className="px-3 py-2">{queueHoldCell(entry)}</td>
                        <td className="max-w-[320px] px-3 py-2">{queueReasonCell(entry)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
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
