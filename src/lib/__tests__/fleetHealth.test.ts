/**
 * Unit tests for `src/lib/fleetHealth.ts` (#66) — the fleet-level rollup
 * `FleetSummary` (`src/components/FleetSummary.tsx`) renders.
 *
 * The counting rule under test is `coord.health.aggregate`'s: one unit per
 * machine's already-rolled-up `severity`, plus one unit per fleet-scope
 * check (`summarizeFleetHealth`'s own doc comment). `unknown` must outrank
 * `ok` but never `warn`/`crit` — the "must not page" acceptance bullet from
 * #66. Scenarios named per the issue's own ask: all-healthy, mixed,
 * all-unknown, and a fired fleet-scope check.
 */
import { describe, it, expect } from 'vitest'

import { summarizeFleetCapacity, summarizeFleetHealth } from '@/lib/fleetHealth'
import type { MachineHealthCheckResult, MachineState } from '@/api/client'

function makeMachine(overrides: Partial<MachineState> = {}): MachineState {
  return {
    name: 'laptop',
    host: 'laptop.tailnet.ts.net',
    reachable: true,
    last_seen: 1_700_000_000,
    active_assignments: 0,
    headless_workers: 1,
    severity: 'ok',
    agent_version: '1.2.3',
    is_local: true,
    quiet_hours_paused: false,
    hand_paused: false,
    release_cordoned: false,
    worktree_bytes: null,
    concurrency_limit: 4,
    ...overrides,
  }
}

function makeCheck(overrides: Partial<MachineHealthCheckResult> = {}): MachineHealthCheckResult {
  return {
    key: 'board_latency',
    label: 'board latency',
    severity: 'ok',
    headroom: '120ms p99',
    detail: '',
    ...overrides,
  }
}

describe('summarizeFleetHealth', () => {
  it('all-healthy: every machine ok, no fleet checks -> worst ok, unit count == machine count', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })]
    const summary = summarizeFleetHealth(machines, [])

    expect(summary.worst).toBe('ok')
    expect(summary.counts).toEqual({ ok: 2, warn: 0, crit: 0, unknown: 0 })
    expect(summary.unitCount).toBe(2)
  })

  it('mixed: one crit machine outranks a warn machine and an ok fleet check', () => {
    const machines = [
      makeMachine({ name: 'a', severity: 'ok' }),
      makeMachine({ name: 'b', severity: 'warn' }),
      makeMachine({ name: 'c', severity: 'crit' }),
    ]
    const checks = [makeCheck({ severity: 'ok' })]
    const summary = summarizeFleetHealth(machines, checks)

    expect(summary.worst).toBe('crit')
    expect(summary.counts).toEqual({ ok: 2, warn: 1, crit: 1, unknown: 0 })
    expect(summary.unitCount).toBe(4)
  })

  it('all-unknown: every unit unknown -> worst unknown, never silently ok', () => {
    const machines = [
      makeMachine({ name: 'a', severity: 'unknown' }),
      makeMachine({ name: 'b', severity: 'unknown' }),
    ]
    const summary = summarizeFleetHealth(machines, [])

    expect(summary.worst).toBe('unknown')
    expect(summary.counts).toEqual({ ok: 0, warn: 0, crit: 0, unknown: 2 })
  })

  it('unknown outranks ok but never outranks warn/crit (must not page)', () => {
    const okAndUnknown = summarizeFleetHealth(
      [makeMachine({ severity: 'ok' }), makeMachine({ severity: 'unknown' })],
      [],
    )
    expect(okAndUnknown.worst).toBe('unknown')

    const unknownAndWarn = summarizeFleetHealth(
      [makeMachine({ severity: 'unknown' }), makeMachine({ severity: 'warn' })],
      [],
    )
    expect(unknownAndWarn.worst).toBe('warn')

    const unknownAndCrit = summarizeFleetHealth(
      [makeMachine({ severity: 'unknown' }), makeMachine({ severity: 'crit' })],
      [],
    )
    expect(unknownAndCrit.worst).toBe('crit')
  })

  it('a fired fleet-scope check counts as its own unit and can set the worst severity on its own', () => {
    const machines = [makeMachine({ severity: 'ok' })]
    const checks = [
      makeCheck({ key: 'phantom_running', severity: 'crit', label: 'phantom running rows' }),
    ]
    const summary = summarizeFleetHealth(machines, checks)

    expect(summary.worst).toBe('crit')
    expect(summary.counts).toEqual({ ok: 1, warn: 0, crit: 1, unknown: 0 })
    expect(summary.unitCount).toBe(2)
  })

  it('a fleet-scope check does not double count -- one unit per check row, not per machine', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })]
    const checks = [makeCheck({ severity: 'warn' })]
    const summary = summarizeFleetHealth(machines, checks)

    expect(summary.unitCount).toBe(3)
    expect(summary.counts).toEqual({ ok: 2, warn: 1, crit: 0, unknown: 0 })
  })

  it('degrades to "no units" for an empty roster and no fleet checks, rather than throwing', () => {
    const summary = summarizeFleetHealth([], [])
    expect(summary.worst).toBe('ok')
    expect(summary.counts).toEqual({ ok: 0, warn: 0, crit: 0, unknown: 0 })
    expect(summary.unitCount).toBe(0)
  })
})

describe('summarizeFleetCapacity', () => {
  it('sums used and total capacity across the roster', () => {
    const machines = [
      makeMachine({ name: 'a', headless_workers: 2, concurrency_limit: 6 }),
      makeMachine({ name: 'b', headless_workers: 1, concurrency_limit: 4 }),
    ]
    expect(summarizeFleetCapacity(machines)).toEqual({ used: 3, total: 10 })
  })

  it('reports total: null when no machine reports a concurrency_limit, never a fabricated 0', () => {
    const machines = [makeMachine({ headless_workers: 2, concurrency_limit: null })]
    expect(summarizeFleetCapacity(machines)).toEqual({ used: 2, total: null })
  })

  it('sums only the machines that report a limit, ignoring unknown ones', () => {
    const machines = [
      makeMachine({ name: 'a', headless_workers: 1, concurrency_limit: 5 }),
      makeMachine({ name: 'b', headless_workers: 1, concurrency_limit: null }),
    ]
    expect(summarizeFleetCapacity(machines)).toEqual({ used: 2, total: 5 })
  })
})
