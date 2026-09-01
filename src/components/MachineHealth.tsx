/**
 * MachineHealth — the Health section's per-check rows on the machine detail
 * panel (#64), fed by `MachineDetail`'s already-fetched
 * `MachineHealthSnapshot` (`fetchMachineHealth`, `src/api/client.ts`).
 *
 * Two rules this file exists to enforce, both spelled out in #64:
 *
 *  - **Consume severity verbatim.** Every row arrives with a pre-decided
 *    `severity` chosen upstream by a Python probe (`coord/health/checks/`:
 *    disk, worktrees, toolchain, index_lock, spawned_coord, cargo_targets
 *    and the rest) — this component renders it via the shared
 *    `SeverityBadge` and never looks at raw numbers to re-derive or re-rank
 *    it. Same rule coord-tui's `fleet_health.rs` states for the identical
 *    wire data (its module doc comment is the canonical source).
 *
 *  - **Honest stale rendering.** `severity`/`stale` answer "trust this right
 *    now?"; `results`/`checked_at` answer "what did we last see?" (#1630).
 *    A stale snapshot renders its rows *plus* a banner naming how old the
 *    measurement is — never silently as if it were current. A snapshot with
 *    no `checked_at` at all (old agent, or a machine coord has never
 *    polled) renders as an explicit "no data" state, never as an empty-but-
 *    healthy check list.
 */
import { SeverityBadge } from '@/components/MachinesList'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/time'
import type { MachineHealthSnapshot } from '@/api/client'

export interface MachineHealthProps {
  snapshot: MachineHealthSnapshot
}

export default function MachineHealth({ snapshot }: MachineHealthProps) {
  const { stale, checked_at, results } = snapshot

  // Never reported at all -- an old agent that predates health reporting, or
  // a machine coord has never successfully polled. This is data-shape
  // "nothing here", distinct from the route-level {available: false} note
  // `MachineDetail` already renders for a coord server that doesn't serve
  // this endpoint yet -- both must read as "no signal", never as "OK".
  if (checked_at === null && results.length === 0) {
    return (
      <p role="status" data-testid="health-never-polled" className="text-sm text-muted-foreground">
        No health data reported for this machine (old agent, or never polled).
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {stale && (
        <p
          data-testid="health-stale-banner"
          className="rounded bg-idle-wash px-2 py-1 text-xs font-medium text-idle"
        >
          Stale{checked_at !== null ? ` — last measured ${formatRelativeTime(checked_at)}` : ''}.
          These rows may not reflect current state.
        </p>
      )}
      {results.length > 0 ? (
        <ul className="space-y-1">
          {results.map((row) => {
            const showDetail = row.severity !== 'ok' && !!row.detail
            return (
              <li key={row.check} data-testid={`health-row-${row.check}`} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <SeverityBadge severity={row.severity} />
                    <span className="truncate text-foreground">{row.label}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {row.headroom}
                  </span>
                </div>
                {showDetail && (
                  <p className={cn('mt-0.5 pl-1 text-xs text-muted-foreground')}>{row.detail}</p>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          No checks reported
          {checked_at !== null ? ` (last checked ${formatRelativeTime(checked_at)})` : ''}.
        </p>
      )}
    </div>
  )
}
