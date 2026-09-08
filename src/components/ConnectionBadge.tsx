/**
 * Honest connection-state indicator (#1549) — live / reconnecting /
 * stale-since-<time>. Never silently shows stale data as if it were live:
 * the moment the SSE stream drops, this says so.
 */
import { useConnectionStatus } from '@/realtime/RealtimeProvider'
import { connectionStateLabel } from '@/lib/connectionLabel'
import { cn } from '@/lib/utils'

// Explicit options (not the bare `toLocaleTimeString()` default) so this
// small badge doesn't grow seconds or an AM/PM suffix in locales where the
// default format includes them -- hour:minute is all the precision a "how
// stale is this" label needs.
function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function ConnectionBadge() {
  const { state, lastLiveAt } = useConnectionStatus()

  const { text, dotClass } = connectionStateLabel(state)
  // "Stale since <time>" is specific to this badge's `lastLiveAt` tracking
  // (`RealtimeProvider`) — `connectionStateLabel`'s plain "Disconnected"
  // covers every other consumer, so this one override stays local.
  const label = state === 'disconnected' && lastLiveAt ? `Stale since ${formatTime(lastLiveAt)}` : text

  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-label={`Connection: ${label}`}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} aria-hidden="true" />
      {label}
    </span>
  )
}
