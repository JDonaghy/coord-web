/**
 * Shared live/reconnecting/disconnected/connecting → { text, dotClass}
 * mapping for a `ConnectionState` (`@/realtime/connection`).
 *
 * Both `ConnectionBadge.tsx` (the global `/events` connection, via
 * `RealtimeProvider`) and `LogPanel.tsx` (a view-local SSE connection to
 * `/api/assignment/{id}/log`, opened directly through `createSseConnection`
 * rather than `RealtimeProvider`) render the same four states the same way;
 * this is the one place that mapping lives, so the two can't quietly drift
 * apart the way two independent `switch` statements would over time.
 */
import type { ConnectionState } from '@/realtime/connection'

export interface ConnectionLabel {
  text: string
  dotClass: string
}

export function connectionStateLabel(state: ConnectionState): ConnectionLabel {
  switch (state) {
    case 'live':
      return { text: 'Live', dotClass: 'bg-green-500' }
    case 'reconnecting':
      return { text: 'Reconnecting…', dotClass: 'bg-yellow-500 animate-pulse' }
    case 'disconnected':
      return { text: 'Disconnected', dotClass: 'bg-destructive' }
    case 'connecting':
    default:
      return { text: 'Connecting…', dotClass: 'bg-muted-foreground animate-pulse' }
  }
}
