/**
 * PipelineStageFlow — one issue's stage-flow view (#100): connected boxes
 * for `Work → Test → Review → Uat → Merge`, each with its own state, a
 * count of the legs that have run against it, and an elapsed timer on
 * whatever is currently in flight — plus, below the boxes, the full leg
 * list newest-first (stage, machine, outcome, duration), the same data
 * `coord gates <repo> <issue>` prints.
 *
 * Renders inside `Detail.tsx`, the per-issue detail view a Home card / Queue
 * row / Board row already opens into — not a new top-level route (#100's
 * "Not in scope: replacing PipelineCard" note: the card stays the
 * list-level summary; this is the detail a row opens into, which already
 * exists as `Detail`).
 *
 * Why the machine name is the feature: the reviewer is a fresh session on a
 * *different* machine with no shared context with the worker — the whole
 * reason the review gate is worth anything — and that independence is
 * invisible unless the per-leg machine is named, not just the issue's
 * current one (`PipelineView.machine_name`, the single most-recent value
 * `PipelineCard`/`Detail`'s header already show). `GET /api/pipeline`
 * collapses a whole issue's history onto one machine/one timing; this
 * component is built on the one endpoint that doesn't,
 * `GET /api/pipeline/{repo}/{issue}/legs` (`fetchPipelineLegs`,
 * claude-coordinator#3184).
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchPipelineLegs,
  type PipelineLegWire,
  type PipelineStage,
  type PipelineView,
} from '@/api/client'
import {
  groupLegsByStage,
  isLegInFlight,
  legDurationMs,
  legStageBox,
  stageChipVisual,
  STAGE_CHIP_RING_CLASS,
} from '@/lib/pipeline'
import { formatCompactDuration } from '@/lib/workerLog'
import { cn } from '@/lib/utils'

/** `PipelineStage.name` -> this view's own box label. Mirrors `Detail.tsx`'s
 * `STAGE_LABEL` / `StageRail.tsx`'s `STAGE_RAIL_LABEL` — each of these three
 * components keeps its own copy on purpose (see `StageRail.tsx`'s doc
 * comment: a drift here is a harmless spelling difference, not a
 * behavioral one, not worth a shared-module dependency for). */
const STAGE_BOX_LABEL: Record<string, string> = {
  coding: 'Work',
  smoke: 'Test',
  review: 'Review',
  uat: 'Uat',
  merge: 'Merge',
}

function boxLabel(stage: PipelineStage): string {
  return STAGE_BOX_LABEL[stage.name] ?? stage.name
}

/** Outcome text + colour for one leg's `status` (`AssignmentStatus | null`
 * on the wire) — deliberately its own small mapping rather than reusing
 * `stageChipVisual` (which answers "how should THIS ISSUE'S current stage
 * render", not "what became of one specific past attempt"). */
function legOutcome(status: PipelineLegWire['status']): { label: string; className: string } {
  switch (status) {
    case 'done':
    case 'merged':
      return { label: status, className: 'text-green-400' }
    case 'failed':
    case 'cancelled':
      return { label: status, className: 'text-destructive' }
    case 'running':
      return { label: 'running', className: 'text-foreground' }
    case 'pending':
      return { label: 'pending', className: 'text-muted-foreground' }
    case 'advisory':
      return { label: 'advisory', className: 'text-muted-foreground' }
    default:
      return { label: 'unknown', className: 'text-muted-foreground' }
  }
}

interface StageBoxProps {
  stage: PipelineStage
  view: PipelineView
  legs: PipelineLegWire[]
  nowMs: number
}

function StageBox({ stage, view, legs, nowMs }: StageBoxProps) {
  const { fill, ring } = stageChipVisual(stage, view)
  const inFlight = legs.find(isLegInFlight) ?? null
  const borderClass =
    fill === 'pass'
      ? 'border-green-700'
      : fill === 'fail'
        ? 'border-destructive'
        : fill === 'skipped'
          ? 'border-border opacity-40'
          : 'border-border'
  const dotClass =
    fill === 'pass'
      ? 'bg-green-500'
      : fill === 'fail'
        ? 'bg-destructive'
        : fill === 'skipped'
          ? 'bg-border opacity-40'
          : ring
            ? 'bg-ring'
            : 'bg-border'

  return (
    <div
      role="listitem"
      data-testid={`stage-box-${stage.name}`}
      data-stage-fill={fill}
      data-stage-current={ring}
      aria-current={ring ? 'step' : undefined}
      className={cn(
        'flex min-w-[5.5rem] flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2.5 text-center',
        borderClass,
        ring && STAGE_CHIP_RING_CLASS,
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)} aria-hidden="true" />
        <span className="truncate text-xs font-semibold text-foreground">{boxLabel(stage)}</span>
        <span
          className="whitespace-nowrap text-[.68rem] text-muted-foreground"
          aria-label={`${legs.length} ${legs.length === 1 ? 'leg' : 'legs'}`}
        >
          ({legs.length})
        </span>
      </span>
      {inFlight?.dispatched_at != null && (
        <span className="whitespace-nowrap font-mono text-[.68rem] text-muted-foreground">
          {formatCompactDuration(nowMs - inFlight.dispatched_at * 1000)}
        </span>
      )}
    </div>
  )
}

export interface PipelineStageFlowProps {
  view: PipelineView
}

export function PipelineStageFlow({ view }: PipelineStageFlowProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pipeline-legs', view.repo_name, view.issue_number],
    queryFn: () => fetchPipelineLegs(view.repo_name, view.issue_number),
  })

  const legs = data?.ok ? data.data.legs : []
  const groups = groupLegsByStage(legs)
  const anyInFlight = legs.some(isLegInFlight)

  // Ticks a live clock for whatever leg is in flight, same pattern as
  // `LogPanel`'s own `nowMs` state -- stopped entirely (no interval at all)
  // once nothing is running, rather than freezing a stale value forward.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!anyInFlight) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [anyInFlight])

  return (
    <section className="mb-4 rounded-lg border border-border bg-card p-4" aria-label="Stage flow">
      <h3 className="mb-3 text-sm font-semibold text-card-foreground">Stage flow</h3>

      <div role="list" aria-label="Stage boxes" className="flex items-stretch gap-1 overflow-x-auto">
        {view.stages.map((stage, i) => (
          <div key={stage.name} className="flex items-stretch gap-1">
            {i > 0 && (
              <span className="flex items-center text-muted-foreground" aria-hidden="true">
                →
              </span>
            )}
            <StageBox
              stage={stage}
              view={view}
              legs={groups.get(stage.name) ?? []}
              nowMs={nowMs}
            />
          </div>
        ))}
      </div>

      {isLoading && <p className="mt-3 text-xs text-muted-foreground">Loading legs…</p>}
      {isError && <p className="mt-3 text-xs text-destructive">Failed to load leg history</p>}
      {data && !data.ok && data.kind === 'absent' && (
        <p className="mt-3 text-xs text-muted-foreground">
          Per-leg detail isn't available from this coord server yet.
        </p>
      )}
      {data && !data.ok && (data.kind === 'not-found' || data.kind === 'invalid') && (
        <p className="mt-3 text-xs text-destructive">{data.error}</p>
      )}

      {data?.ok && (
        <ul className="mt-3 divide-y divide-border" aria-label="Legs">
          {data.data.legs.length === 0 && (
            <li className="py-2 text-xs text-muted-foreground">No legs dispatched yet.</li>
          )}
          {data.data.legs.map((leg, i) => {
            const outcome = legOutcome(leg.status)
            const duration = isLegInFlight(leg)
              ? leg.dispatched_at != null
                ? formatCompactDuration(nowMs - leg.dispatched_at * 1000)
                : null
              : legDurationMs(leg) != null
                ? formatCompactDuration(legDurationMs(leg) as number)
                : null
            return (
              <li
                key={leg.assignment_id ?? `${leg.stage}-${String(i)}`}
                data-testid="leg-row"
                className="flex items-center justify-between gap-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-foreground">
                    {STAGE_BOX_LABEL[legStageBox(leg.stage)] ?? leg.stage}
                  </span>
                  {' · '}
                  <span className="font-mono text-muted-foreground">
                    {leg.machine_name ?? '—'}
                  </span>
                </span>
                <span className={cn('shrink-0 font-medium', outcome.className)}>{outcome.label}</span>
                <span className="shrink-0 font-mono text-muted-foreground">{duration ?? '—'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default PipelineStageFlow
