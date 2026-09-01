/**
 * Fleet-level health/capacity rollups for `FleetSummary`
 * (`src/components/FleetSummary.tsx`, #66) — pure functions, split into
 * their own module (rather than living alongside the component) so they can
 * be unit-tested directly and so the component file only exports the
 * component itself (react-refresh's own constraint on fast-refresh-eligible
 * files, same reason `driveQueue.ts` / `pipeline.ts` hold this repo's other
 * pure per-panel helpers).
 *
 * **Mirrors `coord.health.aggregate`'s counting rule, does not invent a
 * fourth one.** That module (and its from-scratch Rust port, coord-tui's
 * `src/app/fleet_health.rs` — see that file's own module doc comment) count
 * one unit per machine's already-rolled-up `severity`, plus one unit per
 * fleet-scope check, and pick the worst. `summarizeFleetHealth` below is the
 * TypeScript mirror, applied to the same two inputs
 * (`MachineState.severity` per machine, `MachineHealthCheckResult.severity`
 * per fleet check). Keep it in sync with the Python/Rust originals by hand if
 * the rule ever changes.
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
 */
import type { MachineHealthCheckResult, MachineState } from '@/api/client'
import type { Severity } from '@/components/MachinesList'

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
 * `FleetHealthSummary` -- one unit per machine's already-rolled-up
 * `severity`, plus one unit per fleet-scope check (see this module's doc
 * comment for why that granularity, not one unit per individual per-machine
 * check row). Missing/empty inputs degrade to "no units" (`worst: 'ok'`, all
 * counts zero) rather than throwing -- mirrors `coord.health.aggregate.
 * summarize_fleet_health`'s own `None`-tolerant posture.
 */
export function summarizeFleetHealth(
  machines: MachineState[],
  fleetChecks: MachineHealthCheckResult[],
): FleetHealthSummary {
  const counts: Record<Severity, number> = { ok: 0, warn: 0, crit: 0, unknown: 0 }
  let worst: Severity = 'ok'
  const units: Severity[] = [
    ...machines.map((m) => m.severity),
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

export interface FleetCapacity {
  /** Sum of every machine's `headless_workers` -- workers running right now. */
  used: number
  /** Sum of `concurrency_limit` across machines that report one, or `null`
   * when none do -- never rendered as a bogus "0 available" (#63's
   * `MachineDetail` "N / M" convention: omit the denominator rather than
   * fabricate it). */
  total: number | null
}

/** Total worker capacity in use vs available, summed across the roster. */
export function summarizeFleetCapacity(machines: MachineState[]): FleetCapacity {
  const used = machines.reduce((sum, m) => sum + m.headless_workers, 0)
  const knownLimits = machines.filter(
    (m): m is MachineState & { concurrency_limit: number } => m.concurrency_limit !== null,
  )
  const total =
    knownLimits.length > 0 ? knownLimits.reduce((sum, m) => sum + m.concurrency_limit, 0) : null
  return { used, total }
}
