/**
 * Unit tests for `src/lib/fleetHealth.ts` (#66, re-wired by #76) — the
 * fleet-level rollup `FleetSummary` (`src/components/FleetSummary.tsx`)
 * renders.
 *
 * The counting rule under test is `coord.health.aggregate`'s: one unit per
 * machine's joined severity, plus one unit per fleet-scope check
 * (`summarizeFleetHealth`'s own doc comment). `unknown` must outrank `ok`
 * but never `warn`/`crit` — the "must not page" acceptance bullet from #66.
 * Scenarios named per the issue's own ask: all-healthy, mixed, all-unknown,
 * and a fired fleet-scope check.
 *
 * `summarizeFleetCapacity` no longer exists post-#76 -- the real API reports
 * fleet capacity directly (`GET /api/machines/stats`'s `capacity`,
 * `fetchFleetCapacity`), since there's no per-machine concurrency ceiling on
 * a real roster to sum client-side.
 */
import { describe, it, expect } from 'vitest'

import { summarizeFleetHealth } from '@/lib/fleetHealth'
import type { MachineHealthCheckResult, MachineState, Severity } from '@/api/client'

function makeMachine(overrides: Partial<MachineState> = {}): MachineState {
  return {
    name: 'laptop',
    host: 'laptop.tailnet.ts.net',
    state: 'online',
    reason: '',
    latency_ms: 10,
    agent_version: '1.2.3',
    repos: [],
    worktree_bytes: null,
    ...overrides,
  }
}

function makeCheck(overrides: Partial<MachineHealthCheckResult> = {}): MachineHealthCheckResult {
  return {
    key: 'board_latency',
    check_id: 'board_latency',
    scope: 'fleet',
    title: 'Board latency',
    label: 'board latency',
    severity: 'ok',
    headroom: '120ms p99',
    ...overrides,
  }
}

/** Builds a `Record<name, Severity>` the same way `joinMachineSeverity`
 * would, from an inline `{name: severity}` map -- keeps these tests focused
 * on the counting rule rather than the join itself (covered separately in
 * `src/api/__tests__/machines.test.ts`). */
function severityMap(entries: Record<string, Severity>): Record<string, Severity> {
  return entries
}

describe('summarizeFleetHealth', () => {
  it('all-healthy: every machine ok, no fleet checks -> worst ok, unit count == machine count', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })]
    const summary = summarizeFleetHealth(machines, severityMap({ a: 'ok', b: 'ok' }), [])

    expect(summary.worst).toBe('ok')
    expect(summary.counts).toEqual({ ok: 2, warn: 0, crit: 0, unknown: 0 })
    expect(summary.unitCount).toBe(2)
  })

  it('mixed: one crit machine outranks a warn machine and an ok fleet check', () => {
    const machines = [
      makeMachine({ name: 'a' }),
      makeMachine({ name: 'b' }),
      makeMachine({ name: 'c' }),
    ]
    const checks = [makeCheck({ severity: 'ok' })]
    const summary = summarizeFleetHealth(machines, severityMap({ a: 'ok', b: 'warn', c: 'crit' }), checks)

    expect(summary.worst).toBe('crit')
    expect(summary.counts).toEqual({ ok: 2, warn: 1, crit: 1, unknown: 0 })
    expect(summary.unitCount).toBe(4)
  })

  it('all-unknown: every unit unknown -> worst unknown, never silently ok', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })]
    const summary = summarizeFleetHealth(machines, severityMap({ a: 'unknown', b: 'unknown' }), [])

    expect(summary.worst).toBe('unknown')
    expect(summary.counts).toEqual({ ok: 0, warn: 0, crit: 0, unknown: 2 })
  })

  it('a machine missing from the severity map counts as unknown, not ok', () => {
    const machines = [makeMachine({ name: 'a' })]
    const summary = summarizeFleetHealth(machines, {}, [])

    expect(summary.worst).toBe('unknown')
    expect(summary.counts).toEqual({ ok: 0, warn: 0, crit: 0, unknown: 1 })
  })

  it('unknown outranks ok but never outranks warn/crit (must not page)', () => {
    const okAndUnknown = summarizeFleetHealth(
      [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })],
      severityMap({ a: 'ok', b: 'unknown' }),
      [],
    )
    expect(okAndUnknown.worst).toBe('unknown')

    const unknownAndWarn = summarizeFleetHealth(
      [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })],
      severityMap({ a: 'unknown', b: 'warn' }),
      [],
    )
    expect(unknownAndWarn.worst).toBe('warn')

    const unknownAndCrit = summarizeFleetHealth(
      [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })],
      severityMap({ a: 'unknown', b: 'crit' }),
      [],
    )
    expect(unknownAndCrit.worst).toBe('crit')
  })

  it('a fired fleet-scope check counts as its own unit and can set the worst severity on its own', () => {
    const machines = [makeMachine({ name: 'a' })]
    const checks = [
      makeCheck({ key: 'phantom_running', severity: 'crit', label: 'phantom running rows' }),
    ]
    const summary = summarizeFleetHealth(machines, severityMap({ a: 'ok' }), checks)

    expect(summary.worst).toBe('crit')
    expect(summary.counts).toEqual({ ok: 1, warn: 0, crit: 1, unknown: 0 })
    expect(summary.unitCount).toBe(2)
  })

  it('a fleet-scope check does not double count -- one unit per check row, not per machine', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })]
    const checks = [makeCheck({ severity: 'warn' })]
    const summary = summarizeFleetHealth(machines, severityMap({ a: 'ok', b: 'ok' }), checks)

    expect(summary.unitCount).toBe(3)
    expect(summary.counts).toEqual({ ok: 2, warn: 1, crit: 0, unknown: 0 })
  })

  it('degrades to "no units" for an empty roster and no fleet checks, rather than throwing', () => {
    const summary = summarizeFleetHealth([], {}, [])
    expect(summary.worst).toBe('ok')
    expect(summary.counts).toEqual({ ok: 0, warn: 0, crit: 0, unknown: 0 })
    expect(summary.unitCount).toBe(0)
  })
})
