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
 *     `src/lib/driveQueue.ts`'s doc comment for why that matters.
 *  2. A **repo-scope dropdown** ("All repos" | one repo at a time), filtering
 *     the grid client-side over a single unscoped fetch (again, see
 *     `src/lib/driveQueue.ts`).
 *  3. The **nine-column grid** itself, column-for-column parity with the
 *     TUI's `QUEUE_COLUMNS` (`tui/src/app/drive_queue.rs`): `#`, `Issue`,
 *     `Title`, `State`, `Machine`, `Tries`, `After`, `Hold`, `Reason`.
 *
 * No row actions yet (QW-4, mutation) and no issue hyperlink yet (QW-5,
 * navigation) -- every cell below is plain text, deliberately, per the
 * issue's own scoping: those are genuinely different concerns sharing one
 * grid, kept as separate follow-ups rather than bundled in here.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchDriveQueue, fetchPipeline, type BoardDriveQueueEntry } from '@/api/client'
import { PanelHeader } from '@/components/PanelHeader'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  buildQueueTitleLookup,
  driveQueueRepoOptions,
  driveQueueSummaryStats,
  filterQueueEntriesByRepo,
  queueAfterCell,
  queueEntryKey,
  queueHoldCell,
  queueMachineCell,
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
 * -- same nine columns, same order. */
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
  const repoOptions = useMemo(() => driveQueueRepoOptions(entries), [entries])
  const scopedEntries = useMemo(
    () => filterQueueEntriesByRepo(entries, repoScope || null),
    [entries, repoScope],
  )
  const titleByKey = useMemo(() => buildQueueTitleLookup(pipeline ?? []), [pipeline])
  const summaryStats = data ? driveQueueSummaryStats(data.summary) : []

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
                  {scopedEntries.map((entry) => (
                    <tr key={queueEntryKey(entry)} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2 text-right font-mono">{entry.position}</td>
                      <td className="px-3 py-2 font-mono">{queueEntryKey(entry)}</td>
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
                    </tr>
                  ))}
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
