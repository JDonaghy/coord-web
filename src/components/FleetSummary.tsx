/**
 * FleetSummary — the fleet-level aggregate at the top of the Machines panel
 * (#66, re-wired by #76): "is the fleet OK?" answered without reading every
 * row.
 *
 * Three facts: worst severity across the fleet plus the count at that
 * severity, total worker capacity in use vs available, and fleet-*scope*
 * health checks (`fleetChecks` — `fetchFleetChecks`, `src/api/client.ts`)
 * that are facts about the fleet as a whole, not any one machine's.
 *
 * #76 dropped the "N / total online" line the #66 version rendered from
 * `MachineState.reachable` -- that field never existed on a real roster (see
 * `MachinesList.tsx`'s doc comment for the full field-list correction); a
 * live roster's `state` is an open-vocabulary string this codebase has no
 * confirmed "reachable" mapping for, and inventing one here would repeat
 * exactly the mistake #76 filed against. The machine count is still
 * available via `machines.length` if a caller wants it elsewhere.
 *
 * **Mirrors `coord.health.aggregate`'s counting rule, does not invent a
 * fourth one.** That module (and its from-scratch Rust port, coord-tui's
 * `src/app/fleet_health.rs` — see that file's own module doc comment) count
 * one unit per machine's joined severity, plus one unit per fleet-scope
 * check, and pick the worst. This component is a *third* consumer of the
 * same rule — `summarizeFleetHealth` (`src/lib/fleetHealth.ts`) is the
 * TypeScript mirror, exported so it can be unit-tested directly without
 * mounting the component. Keep it in sync with the Python/Rust originals by
 * hand if the rule ever changes.
 *
 * **`unknown` outranks `ok` but never `warn`/`crit`.** A missing signal
 * (machine unreachable, never checked in, etc) must never be mistaken for a
 * healthy one -- but it also must not page: `unknown`'s rank sits strictly
 * between `ok` and `warn`, and `SeverityBadge` (`MachinesList.tsx`) already
 * renders it in its own idle colour, distinct from both "fine" (pass) and
 * "paging" (attn/fail) -- reused here rather than re-derived.
 *
 * **Severity/headroom consumed verbatim; capacity summed from the real
 * per-machine numbers.** This component never re-derives a severity from
 * raw numbers (`MachineHealth.tsx`'s doc comment is the fullest statement of
 * that rule). `capacity` IS a client-side sum -- `GET /api/machines/stats`
 * reports `{active, max}` per machine, not a fleet-wide total
 * (`fetchFleetCapacity`, `src/api/client.ts`, sums it the same way the
 * pre-#76 `summarizeFleetCapacity` summed roster fields) -- but every number
 * fed into that sum is still the server's own, never fabricated here.
 */
import { summarizeFleetHealth } from '@/lib/fleetHealth'
import { SeverityBadge } from '@/components/MachinesList'
import type { FleetCapacity, MachineHealthCheckResult, MachineState, Severity } from '@/api/client'

export interface FleetSummaryProps {
  machines: MachineState[]
  /** This machine's joined severity, keyed by name (`joinMachineSeverity`,
   * `src/api/client.ts`). */
  severityMap: Record<string, Severity>
  /** Fleet-scope checks, already resolved to `[]` by the caller when the
   * `/api/machines/health` route is unavailable -- same graceful-degrade
   * posture `coord.health.aggregate.summarize_fleet_health` documents for a
   * missing `fleet_health` block: "no units", not an error. */
  fleetChecks?: MachineHealthCheckResult[]
  /** Fleet-wide worker capacity (`fetchFleetCapacity`, `src/api/client.ts`),
   * or `null` while unresolved/unavailable -- renders with no denominator
   * rather than a fabricated one, same "N / M" convention `MachineDetail`
   * already used pre-#76. */
  capacity: FleetCapacity | null
}

export default function FleetSummary({
  machines,
  severityMap,
  fleetChecks = [],
  capacity,
}: FleetSummaryProps) {
  const health = summarizeFleetHealth(machines, severityMap, fleetChecks)
  const firedFleetChecks = fleetChecks.filter((c) => c.severity !== 'ok')

  return (
    <section
      data-testid="fleet-summary"
      aria-label="Fleet summary"
      className="mb-4 space-y-2 rounded-lg border border-border bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span data-testid="fleet-total" className="text-sm font-medium text-card-foreground">
          {machines.length} machine{machines.length === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-1.5" data-testid="fleet-severity">
          <SeverityBadge severity={health.worst} />
          {health.worst !== 'ok' && (
            <span className="text-xs text-muted-foreground">
              {health.counts[health.worst]} at {health.worst}
            </span>
          )}
        </div>
      </div>

      <div className="text-xs text-muted-foreground" data-testid="fleet-capacity">
        {capacity ? (
          <>
            Capacity: {capacity.used}
            {capacity.total !== null ? ` / ${capacity.total}` : ''} workers
          </>
        ) : (
          'Capacity unavailable'
        )}
      </div>

      {firedFleetChecks.length > 0 && (
        <ul className="space-y-1 border-t border-border pt-2" aria-label="Fleet-scope checks">
          {firedFleetChecks.map((check) => (
            <li
              key={check.key}
              data-testid={`fleet-check-${check.key}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SeverityBadge severity={check.severity} />
                <span className="truncate text-foreground">{check.label}</span>
              </div>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {check.headroom}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
