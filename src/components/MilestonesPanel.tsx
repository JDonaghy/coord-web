/**
 * MilestonesPanel — the Milestones panel's list-slot content (#91, over
 * claude-coordinator#3072's `GET /api/milestones`).
 *
 * The one surface that shows a piece of work as a *story*: one request became
 * a milestone with N slices, here is the sign-off, here is 4 of 6 merged.
 * Pipeline shows what is moving right now; Board and Merge queue are the same
 * facts re-cut. This is the one neither can show.
 *
 * `ShellLayout` owns the frame (rail, status bar) and renders this into the
 * list slot for `/milestones`, same convention `MachinesPanel` documents.
 * Rows navigate to `/milestones/:repo/:number` (`MilestoneDetailPanel`) —
 * the list -> detail convention `SessionsList`/`MachinesPanel` already use.
 *
 * Degraded states are a deliverable here, not an afterthought, and each one
 * renders as *itself* rather than collapsing into a blank list — this repo
 * has had three incidents of exactly the opposite (#76 a panel wired to
 * endpoints that were never built, #84 an envelope read as a bare array, #85
 * a cast where a validation belonged; all three reached the user as a white
 * screen):
 *
 *  - **endpoint absent** (`kind: 'absent'`) — a coord server predating
 *    claude-coordinator#3072. This is the *realistic* case for weeks after
 *    this merges, because coord-web auto-deploys on its own timer, decoupled
 *    from any claude-coordinator release (CLAUDE.md "Deploy").
 *  - **handled 404** (`kind: 'not-found'`) — the route exists and said no.
 *  - **invalid shape** (`kind: 'invalid'`) — validated, not cast; the field
 *    that disagreed is named on screen.
 *  - **empty roster** — a real, successful "no milestones anywhere".
 *  - **partial roster** — `warnings[]` (one repo's `gh` read failed) shown
 *    above the rows that *did* load, never instead of them.
 */
import { AlertTriangle, MilestoneIcon, ServerOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { fetchMilestones, type MilestoneSummaryWire } from '@/api/client'
import { PanelHeader } from '@/components/PanelHeader'
import { Badge } from '@/components/ui/badge'
import {
  groupMilestonesByRepo,
  milestoneProgress,
  milestoneRef,
  workOrderComplete,
  workOrderProgress,
} from '@/lib/milestones'
import { paths } from '@/routes/paths'
import { cn } from '@/lib/utils'

/** A thin closed/total bar. `aria-hidden` — the same numbers are already in
 * the row's text, so a screen reader would otherwise hear them twice. */
export function ProgressBar({ pct, tone }: { pct: number; tone: 'brand' | 'pass' }) {
  return (
    <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-secondary">
      <div
        data-testid="progress-fill"
        className={cn('h-full rounded-full', tone === 'pass' ? 'bg-pass' : 'bg-brand')}
        style={{ width: `${String(pct)}%` }}
      />
    </div>
  )
}

function MilestoneRow({
  milestone,
  onSelect,
}: {
  milestone: MilestoneSummaryWire
  onSelect: () => void
}) {
  const issues = milestoneProgress(milestone)
  const work = workOrderProgress(milestone)
  const complete = workOrderComplete(milestone)
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`milestone-row-${milestone.repo_name}-${String(milestone.milestone_number)}`}
      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-secondary/40 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex items-start gap-2">
        <span className="font-mono text-[.7rem] text-faint">
          {milestoneRef(milestone.repo_name, milestone.milestone_number)}
        </span>
        <span className="flex-1 text-sm font-medium text-foreground">{milestone.title}</span>
        {milestone.oracle && (
          <Badge variant="outline" data-testid="oracle-badge" title="Repo is opted into the oracle loop">
            oracle
          </Badge>
        )}
        {milestone.state === 'closed' && <Badge variant="secondary">closed</Badge>}
      </div>

      <ProgressBar pct={issues.pct} tone={complete ? 'pass' : 'brand'} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[.7rem] text-muted-foreground">
        <span data-testid="issue-progress">
          {issues.done}/{issues.total} issues closed
        </span>
        {milestone.has_work_order ? (
          <span data-testid="work-order-progress">
            work order {work.done}/{work.total}
          </span>
        ) : (
          <span data-testid="no-work-order" className="text-faint">
            no work order
          </span>
        )}
        {milestone.in_flight > 0 && <span className="text-attn">{milestone.in_flight} in flight</span>}
        {milestone.blocked > 0 && <span className="text-fail">{milestone.blocked} blocked</span>}
        {milestone.needs_you.length > 0 && (
          <span className="text-attn" data-testid="needs-you">
            needs you: {milestone.needs_you.join(', ')}
          </span>
        )}
      </div>
    </button>
  )
}

/** Shared by this panel and `MilestoneDetailPanel` — the two honest
 * "the server told us something" states, rendered identically in both places
 * so an operator learns one shape, not two. */
export function MilestonesUnavailable({
  kind,
  error,
  testId,
}: {
  kind: 'absent' | 'not-found' | 'invalid'
  error?: string
  testId: string
}) {
  const copy =
    kind === 'absent'
      ? {
          title: 'Milestones API not available',
          body:
            "This coord server doesn't serve /api/milestones yet — the panel is here, the endpoint " +
            'lands with the next coord rollout. Nothing is broken and nothing is missing from the fleet.',
        }
      : kind === 'not-found'
        ? { title: 'Not found', body: error ?? 'The server has no such repo or milestone.' }
        : {
            title: "Milestone data didn't match the expected shape",
            body:
              error ??
              'The server answered, but a field was not what this build expects. Nothing is rendered ' +
                'rather than showing a half-read response.',
          }
  return (
    <div
      data-testid={testId}
      role="status"
      className="flex flex-col items-center gap-3 px-6 py-14 text-center"
    >
      <ServerOff className="h-7 w-7 text-faint" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{copy.title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{copy.body}</p>
    </div>
  )
}

/** Per-repo fetch failures the endpoint reported instead of failing the whole
 * roster (`coord plans`' own posture). Shown *above* the rows that did load —
 * a partial roster is still worth reading, but silently partial is not. */
export function RosterWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null
  return (
    <div
      role="status"
      data-testid="milestone-warnings"
      className="mb-3 flex gap-2 rounded-lg border border-attn/40 bg-attn-wash px-3 py-2"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-attn" aria-hidden="true" />
      <ul className="space-y-1 text-xs text-foreground">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

export default function MilestonesPanel() {
  const navigate = useNavigate()
  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['milestones'],
    queryFn: () => fetchMilestones(),
  })

  const rows = result?.ok ? result.data.milestones : []
  const groups = groupMilestonesByRepo(rows)

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4">
      <PanelHeader
        title="Milestones"
        count={result?.ok ? rows.length : undefined}
        countLabel="tracked"
      />

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading milestones…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load milestones</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {result && !result.ok && (
        <MilestonesUnavailable
          kind={result.kind}
          error={result.kind === 'absent' ? undefined : result.error}
          testId="milestones-unavailable"
        />
      )}

      {result?.ok && <RosterWarnings warnings={result.data.warnings} />}

      {result?.ok && rows.length === 0 && (
        <div data-testid="milestones-empty" className="flex flex-col items-center gap-3 py-14 text-center">
          <MilestoneIcon className="h-7 w-7 text-faint" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No milestones</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            None of the tracked repos has a milestone yet. One shows up here as soon as a repo does.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.repo} className="mb-5">
          <h2 className="mb-2 font-mono text-[.7rem] uppercase tracking-wide text-faint">
            {group.repo}
          </h2>
          <div className="space-y-2">
            {group.milestones.map((m) => (
              <MilestoneRow
                key={`${m.repo_name}#${String(m.milestone_number)}`}
                milestone={m}
                onSelect={() => navigate(paths.milestoneItem(m.repo_name, m.milestone_number))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
