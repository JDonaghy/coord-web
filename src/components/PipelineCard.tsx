/**
 * PipelineCard — a phone-friendly card for one in-flight pipeline item.
 *
 * Shows: issue title, repo + issue number, stage chips (work→test→review→merge),
 * machine name, and an overall status badge.
 */
import { cn } from '@/lib/utils'
import { type PipelineView, type PipelineStage } from '@/api/client'
import { FAILED_STAGES } from '@/lib/pipeline'

// ── Stage display helpers ─────────────────────────────────────────────────────

/**
 * Map the internal stage name from pipeline.py to the user-facing label.
 * Work Order matches the TUI: Work → Test → Review → Merge.
 */
const STAGE_LABEL: Record<string, string> = {
  coding: 'work',
  smoke:  'test',
  review: 'review',
  merge:  'merge',
}

/**
 * Fine-grained `current_stage` values that indicate the pipeline is currently
 * running (i.e. a subprocess is in progress — no human action required yet).
 */
const RUNNING_STAGES = new Set([
  'coding',
  'review_running',
  'smoke_running',
  'merging',
])

/** Return Tailwind classes for a single stage chip. */
function stageChipClass(stage: PipelineStage, currentStage: string): string {
  const base = 'rounded px-1.5 py-0.5 text-xs font-medium'

  if (stage.is_current) {
    // Active stage — colour by failure vs running
    if (FAILED_STAGES.has(currentStage)) {
      return cn(base, 'bg-destructive text-destructive-foreground')
    }
    return cn(base, 'bg-primary text-primary-foreground')
  }

  switch (stage.status) {
    case 'completed':
      return cn(base, 'bg-green-700 text-white')
    case 'skipped':
      return cn(base, 'border border-border text-muted-foreground opacity-40')
    default:
      // "waiting"
      return cn(base, 'border border-border text-muted-foreground')
  }
}

// ── Relative-time label ───────────────────────────────────────────────────────

/**
 * "3h ago" / "2d ago" style label for a `finished_at` epoch-seconds
 * timestamp (follow-up to #1218: the "Work done" section sorted by recency
 * but never showed a timestamp, so the ordering wasn't user-perceivable).
 *
 * `now` is injectable so tests don't depend on the real clock. Not exported:
 * eslint's react-refresh rule flags non-component exports from a component
 * file, so this stays module-private and is exercised through the rendered
 * `PipelineCard` output in tests instead.
 */
const formatRelativeTime = (epochSeconds: number, now: number = Date.now()): string => {
  const diffSec = Math.round((now - epochSeconds * 1000) / 1000)

  if (diffSec < 60) return 'just now'

  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHour = Math.round(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h ago`

  const diffDay = Math.round(diffHour / 24)
  if (diffDay < 7) return `${diffDay}d ago`

  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

// ── Overall status badge ──────────────────────────────────────────────────────

interface StatusInfo {
  label: string
  className: string
}

/** Map fine-grained current_stage to a human badge + colour. */
function stageStatusInfo(currentStage: string): StatusInfo {
  if (RUNNING_STAGES.has(currentStage)) {
    return { label: 'running', className: 'bg-primary text-primary-foreground' }
  }
  if (FAILED_STAGES.has(currentStage)) {
    return { label: 'failed', className: 'bg-destructive text-destructive-foreground' }
  }
  switch (currentStage) {
    case 'merged':
      return { label: 'merged', className: 'bg-green-700 text-white' }
    case 'merge_ready':
      return { label: 'mergeable', className: 'bg-yellow-600 text-black' }
    case 'review_done':
      return { label: 'review ✓', className: 'bg-yellow-600 text-black' }
    case 'smoke_passed':
      return { label: 'test ✓', className: 'bg-yellow-600 text-black' }
    case 'done':
      return { label: 'work done', className: 'bg-yellow-600 text-black' }
    default:
      return { label: currentStage.replace(/_/g, ' '), className: 'bg-secondary text-secondary-foreground' }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface PipelineCardProps {
  view: PipelineView
  onClick: () => void
  /**
   * This row's item is the one open in the detail panel (#1547).
   *
   * Only ever true on a viewport wide enough to show list and detail at once —
   * on a phone the detail replaces the list, so there is nothing to mark. The
   * treatment is the mock's `.row[aria-selected="true"]`: an accent bar on the
   * leading edge plus a stronger border, never a fill, because the accent
   * means "work is happening here" and a selected row hasn't earned it.
   */
  selected?: boolean
  /**
   * Render a "3h ago" relative-time label next to the repo/machine line —
   * opt-in (rather than always reading `view.finished_at`) so it only shows
   * up where the caller has actually sorted by recency and wants that made
   * legible: the "Work done" section (#1218's follow-up). Elsewhere
   * `finished_at` can be a stale carryover from a prior stage on an
   * item that's now active again, so showing it unconditionally would be
   * misleading.
   */
  finishedAt?: number | null
}

export function PipelineCard({ view, onClick, selected, finishedAt }: PipelineCardProps) {
  const { label: statusLabel, className: statusClass } = stageStatusInfo(view.current_stage)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative w-full overflow-hidden rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors active:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-line-strong before:absolute before:inset-y-2 before:left-0 before:w-[2px] before:rounded-r-sm before:bg-brand before:content-[\'\']',
      )}
    >
      {/* Top row: issue title + status badge */}
      <div className="flex items-start justify-between gap-3">
        <p className="flex-1 truncate text-sm font-medium text-card-foreground">
          {view.issue_title}
        </p>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
            statusClass,
          )}
        >
          {statusLabel}
        </span>
      </div>

      {/* Second row: repo#N + machine + (optionally) relative finish time */}
      <p className="mt-1 text-xs text-muted-foreground">
        {view.repo_name} <span className="font-mono">#{view.issue_number}</span>
        {' · '}
        {view.machine_name}
        {typeof finishedAt === 'number' && (
          <>
            {' · '}
            <span>{formatRelativeTime(finishedAt)}</span>
          </>
        )}
      </p>

      {/* Stage chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {view.stages.map((stage) => (
          <span
            key={stage.name}
            className={stageChipClass(stage, view.current_stage)}
          >
            {STAGE_LABEL[stage.name] ?? stage.name}
          </span>
        ))}
      </div>

      {/* Review findings pending indicator */}
      {view.review_findings_pending && (
        <p className="mt-2 text-xs text-yellow-500">⚠ Review findings not yet posted</p>
      )}
    </button>
  )
}
