/**
 * Fleet-level health rollup for `FleetSummary`
 * (`src/components/FleetSummary.tsx`, #66, re-wired by #76) — a pure
 * function, split into its own module (rather than living alongside the
 * component) so it can be unit-tested directly and so the component file
 * only exports the component itself (react-refresh's own constraint on
 * fast-refresh-eligible files, same reason `driveQueue.ts` / `pipeline.ts`
 * hold this repo's other pure per-panel helpers).
 *
 * **Mirrors `coord.health.aggregate`'s counting rule, does not invent a
 * fourth one.** That module (and its from-scratch Rust port, coord-tui's
 * `src/app/fleet_health.rs` — see that file's own module doc comment) count
 * one unit per machine's already-rolled-up severity, plus one unit per
 * fleet-scope check, and pick the worst. `summarizeFleetHealth` below is the
 * TypeScript mirror. Keep it in sync with the Python/Rust originals by hand
 * if the rule ever changes.
 *
 * **`unknown` outranks `ok` but never `warn`/`crit`.** A missing signal
 * (machine unreachable, never checked in, etc) must never be mistaken for a
 * healthy one -- but it also must not page: `unknown`'s rank sits strictly
 * between `ok` and `warn`.
 *
 * **Severity/headroom consumed verbatim.** Same rule every other Machines-
 * panel component follows (`MachineHealth.tsx`'s doc comment is the fullest
 * statement of it): this module never re-derives a severity from raw
 * numbers, it only tallies the pre-decided strings each row already
 * carries.
 *
 * #76 re-wire: a machine's severity used to live on `MachineState.severity`
 * (invented, never shipped) — it's now looked up from a `Record<string,
 * Severity>` the caller builds once via `joinMachineSeverity`
 * (`src/api/client.ts`) against the real `GET /api/machines/health`
 * response, keeping this module's own counting logic unchanged. Fleet
 * *capacity* (used/total workers) is no longer summed here either -- the
 * real API reports it directly as `GET /api/machines/stats`'s `capacity`
 * (`fetchFleetCapacity`), since there's no per-machine concurrency ceiling
 * on the real roster to sum client-side (`summarizeFleetCapacity` is gone;
 * see this module's git history for the #61-#66 version that summed it).
 */
import type { MachineHealthCheckResult, MachineState, Severity } from '@/api/client'

/** Declaration order is the rank order: `unknown` (1) outranks `ok` (0) but
 * never `warn` (2) / `crit` (3) -- mirrors `coord.health.models.Severity` /
 * coord-tui's `FleetSeverity` (`fleet_health.rs`). */
const SEVERITY_RANK: Record<Severity, number> = { ok: 0, unknown: 1, warn: 2, crit: 3 }

export interface FleetHealthSummary {
  worst: Severity
  counts: Record<Severity, number>
  /** Total machines + fleet checks contributing -- mirrors
   * `coord.health.aggregate.FleetHealthSummary.unit_count`. */
  unitCount: number
}

/**
 * Aggregate a machine roster + fleet-scope checks into one
 * `FleetHealthSummary` -- one unit per machine's joined severity, plus one
 * unit per fleet-scope check (see this module's doc comment for why that
 * granularity, not one unit per individual per-machine check row). Missing/
 * empty inputs degrade to "no units" (`worst: 'ok'`, all counts zero) rather
 * than throwing -- mirrors `coord.health.aggregate.summarize_fleet_health`'s
 * own `None`-tolerant posture.
 *
 * `severityMap` is keyed by machine name (`joinMachineSeverity`) — a machine
 * with no entry counts as `'unknown'`, the same fallback `SeverityBadge`
 * applies when rendering it directly.
 */
export function summarizeFleetHealth(
  machines: MachineState[],
  severityMap: Record<string, Severity>,
  fleetChecks: MachineHealthCheckResult[],
): FleetHealthSummary {
  const counts: Record<Severity, number> = { ok: 0, warn: 0, crit: 0, unknown: 0 }
  let worst: Severity = 'ok'
  const units: Severity[] = [
    ...machines.map((m) => severityMap[m.name] ?? 'unknown'),
    ...fleetChecks.map((c) => c.severity),
  ]
  for (const sev of units) {
    counts[sev] += 1
    if (SEVERITY_RANK[sev] > SEVERITY_RANK[worst]) {
      worst = sev
    }
  }
  return { worst, counts, unitCount: units.length }
}
