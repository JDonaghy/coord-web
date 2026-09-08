/**
 * StageRail — the five connected stage boxes across the top of the Log view
 * (#110): `Work → Test → Review → Uat → Merge`, each carrying its own state,
 * with the in-flight one highlighted and annotated with its live turn count
 * and elapsed time (`Work T76  6m54s`) — the same information the TUI's own
 * Log tab leads with (see `LogPanel.tsx`'s header comment for the fuller
 * picture; this component is only the rail).
 *
 * Coloring reuses `stageChipVisual` (`@/lib/pipeline`) — the single source
 * of truth `PipelineCard`'s chips, `Detail`'s header strip, and `Detail`'s
 * merge-section gate list already share, so a rejected review or a failed
 * test renders red here exactly like it does everywhere else in the app,
 * and — the property #110 explicitly calls out — a stage that hasn't been
 * reached yet (`fill: 'pending'`, `ring: false`) reads as neutral/waiting,
 * never red: only `FAILED_STAGES`/a rejected verdict on the *current* stage
 * ever produces `fill: 'fail'`.
 */
import { stageChipVisual, STAGE_CHIP_RING_CLASS } from '@/lib/pipeline'
import { formatCompactDuration } from '@/lib/workerLog'
import type { PipelineStage, PipelineView } from '@/api/client'
import { cn } from '@/lib/utils'

/** `PipelineStage.name` -> the rail's own label. Mirrors `Detail.tsx`'s
 * `STAGE_LABEL` (kept as a separate copy rather than a shared export: the
 * two components independently fall back to the raw stage name for an
 * unmapped value, so a drift here is a harmless spelling difference, not a
 * behavioral one — not worth adding a shared-module dependency for). */
const STAGE_RAIL_LABEL: Record<string, string> = {
  coding: 'Work',
  smoke: 'Test',
  review: 'Review',
  uat: 'Uat',
  merge: 'Merge',
}

function railLabel(stage: PipelineStage): string {
  return STAGE_RAIL_LABEL[stage.name] ?? stage.name
}

export interface StageRailProps {
  view: PipelineView
  /** Live turn count for whichever stage is currently in flight
   * (`stage.is_current`) — `null` before the log stream has parsed a first
   * turn, or once the leg has finished and there is no in-flight stage
   * left to annotate. */
  turnCount: number | null
  /** Elapsed time (ms) for the in-flight stage, alongside `turnCount` —
   * `null` under the same conditions. */
  elapsedMs: number | null
}

export function StageRail({ view, turnCount, elapsedMs }: StageRailProps) {
  return (
    <div
      role="list"
      aria-label="Stage rail"
      className="flex w-full items-stretch gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1.5"
    >
      {view.stages.map((stage) => {
        const { fill, ring } = stageChipVisual(stage, view)
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
        const textClass =
          fill === 'pass'
            ? 'text-green-400'
            : fill === 'fail'
              ? 'text-destructive'
              : fill === 'skipped'
                ? 'text-muted-foreground opacity-40'
                : ring
                  ? 'text-foreground'
                  : 'text-muted-foreground'

        return (
          <div
            key={stage.name}
            role="listitem"
            data-testid={`stage-rail-${stage.name}`}
            data-stage-fill={fill}
            data-stage-current={ring}
            aria-current={ring ? 'step' : undefined}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-2 py-2 text-center',
              ring && STAGE_CHIP_RING_CLASS,
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotClass)} aria-hidden="true" />
              <span className={cn('truncate text-xs font-semibold', textClass)}>{railLabel(stage)}</span>
            </span>
            {ring && (turnCount != null || elapsedMs != null) && (
              <span className="whitespace-nowrap font-mono text-[.68rem] text-muted-foreground">
                {turnCount != null ? `T${turnCount}` : null}
                {turnCount != null && elapsedMs != null ? '  ' : null}
                {elapsedMs != null ? formatCompactDuration(elapsedMs) : null}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default StageRail
