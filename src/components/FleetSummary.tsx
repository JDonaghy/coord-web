/**
 * FleetSummary — the fleet-level aggregate at the top of the Machines panel
 * (#66): "is the fleet OK?" answered without reading every row.
 *
 * Four facts, all computed client-side from data the panel already has (or
 * now fetches, #66): machines online/total, worst severity across the fleet
 * plus the count at that severity, total worker capacity in use vs
 * available, and fleet-*scope* health checks (`fleetChecks` —
 * `fetchFleetChecks`, `src/api/client.ts`) that are facts about the fleet as
 * a whole, not any one machine's.
 *
 * **Mirrors `coord.health.aggregate`'s counting rule, does not invent a
 * fourth one.** That module (and its from-scratch Rust port, coord-tui's
 * `src/app/fleet_health.rs` — see that file's own module doc comment) count
 * one unit per machine's already-rolled-up `severity`, plus one unit per
 * fleet-scope check, and pick the worst. This component is a *third*
 * consumer of the same rule, applied to the same two inputs
 * (`MachineState.severity` per machine, `MachineHealthCheckResult.severity`
 * per fleet check) — `summarizeFleetHealth` below is the TypeScript mirror,
 * exported so it can be unit-tested directly without mounting the component.
 * Keep it in sync with the Python/Rust originals by hand if the rule ever
 * changes.
 *
 * **`unknown` outranks `ok` but never `warn`/`crit`.** A missing signal
 * (machine unreachable, never checked in, etc) must never be mistaken for a
 * healthy one -- but it also must not page: `unknown`'s rank sits strictly
 * between `ok` and `warn`, and `SeverityBadge` (`MachinesList.tsx`) already
 * renders it in its own idle colour, distinct from both "fine" (pass) and
 * "paging" (attn/fail) -- reused here rather than re-derived.
 *
 * **Severity/headroom consumed verbatim.** Same rule every other Machines-
 * panel component follows (`MachineHealth.tsx`'s doc comment is the fullest
 * statement of it): this component never re-derives a severity from raw
 * numbers, it only tallies the pre-decided strings each row already
 * carries.
 *
 * The rollup itself (`summarizeFleetHealth`/`summarizeFleetCapacity`) lives
 * in `src/lib/fleetHealth.ts`, not here -- so it can be unit-tested directly
 * and so this file only exports the component (fast-refresh's own
 * constraint on component files; see that module's doc comment).
 */
import { summarizeFleetCapacity, summarizeFleetHealth } from '@/lib/fleetHealth'
import { SeverityBadge } from '@/components/MachinesList'
import type { MachineHealthCheckResult, MachineState } from '@/api/client'

export interface FleetSummaryProps {
  machines: MachineState[]
  /** Fleet-scope checks, already resolved to `[]` by the caller when the
   * `/api/fleet/health` route is unavailable -- same graceful-degrade
   * posture `coord.health.aggregate.summarize_fleet_health` documents for a
   * missing `fleet_health` block: "no units", not an error. */
  fleetChecks?: MachineHealthCheckResult[]
}

export default function FleetSummary({ machines, fleetChecks = [] }: FleetSummaryProps) {
  const online = machines.filter((m) => m.reachable).length
  const total = machines.length
  const health = summarizeFleetHealth(machines, fleetChecks)
  const capacity = summarizeFleetCapacity(machines)
  const firedFleetChecks = fleetChecks.filter((c) => c.severity !== 'ok')

  return (
    <section
      data-testid="fleet-summary"
      aria-label="Fleet summary"
      className="mb-4 space-y-2 rounded-lg border border-border bg-card px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span data-testid="fleet-online" className="text-sm font-medium text-card-foreground">
          {online} / {total} online
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
        Capacity: {capacity.used}
        {capacity.total !== null ? ` / ${capacity.total}` : ''} workers
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
