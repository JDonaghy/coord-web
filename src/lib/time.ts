/**
 * Relative-time display helpers shared across cards/panels that render an
 * epoch-seconds timestamp as a human age label.
 *
 * Extracted from `PipelineCard.tsx` (originally added there for #1218) so
 * `MachineDetail` (#63: last-contact age, active-worker age, job-history
 * age) doesn't hand-roll its own copy of the same bucketing. `PipelineCard`
 * itself couldn't export this: eslint's `react-refresh/only-export-
 * components` rule flags a non-component export from a component file, so
 * it stayed module-private there until a second caller showed up.
 */

/**
 * "3h ago" / "2d ago" style label for an epoch-seconds timestamp.
 *
 * `now` is injectable so tests don't depend on the real clock.
 */
export function formatRelativeTime(epochSeconds: number, now: number = Date.now()): string {
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
