/**
 * Component tests for `FleetSummary` (#66, re-wired by #76) — the
 * fleet-level aggregate at the top of the Machines panel.
 *
 * #76 dropped the "N / total online" line (`MachineState.reachable` never
 * existed on a real roster) and switched capacity from a client-side sum of
 * per-machine fields to the real `GET /api/machines/stats`'s `capacity`,
 * passed straight through. Severity is now a `severityMap` prop
 * (`joinMachineSeverity`, `src/api/client.ts`) rather than a field read off
 * each `MachineState`.
 *
 * Rendered directly with plain props (no router, no `QueryClientProvider`) —
 * `FleetSummary` is pure presentation, the same split `MachinesList`/
 * `MachinesPanel` establish. The rollup logic itself (`summarizeFleetHealth`)
 * is covered directly in `src/lib/__tests__/fleetHealth.test.ts`; this file
 * only pins that the component wires that rollup (plus `capacity`) into the
 * DOM correctly.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import FleetSummary from '@/components/FleetSummary'
import type { FleetCapacity, MachineHealthCheckResult, MachineState, Severity } from '@/api/client'

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

const CAPACITY: FleetCapacity = { used: 2, total: 10 }

describe('FleetSummary (rendered)', () => {
  it('renders the machine count, the worst severity badge, and capacity', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })]
    render(
      <FleetSummary
        machines={machines}
        severityMap={{ a: 'ok', b: 'ok' }}
        fleetChecks={[]}
        capacity={CAPACITY}
      />,
    )

    expect(screen.getByTestId('fleet-total')).toHaveTextContent('2 machines')
    expect(within(screen.getByTestId('fleet-severity')).getByTestId('severity-badge')).toHaveTextContent('ok')
    expect(screen.getByTestId('fleet-capacity')).toHaveTextContent('Capacity: 2 / 10 workers')
  })

  it('renders singular "machine" for a fleet of one', () => {
    render(
      <FleetSummary machines={[makeMachine({ name: 'a' })]} severityMap={{ a: 'ok' }} fleetChecks={[]} capacity={null} />,
    )
    expect(screen.getByTestId('fleet-total')).toHaveTextContent('1 machine')
  })

  it('renders "Capacity unavailable" rather than a fabricated number when capacity is null', () => {
    render(
      <FleetSummary machines={[makeMachine({ name: 'a' })]} severityMap={{ a: 'ok' }} fleetChecks={[]} capacity={null} />,
    )
    expect(screen.getByTestId('fleet-capacity')).toHaveTextContent('Capacity unavailable')
  })

  it('shows the worst severity plus the count at that severity when not all-ok', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' }), makeMachine({ name: 'c' })]
    render(
      <FleetSummary
        machines={machines}
        severityMap={{ a: 'warn', b: 'warn', c: 'ok' } as Record<string, Severity>}
        fleetChecks={[]}
        capacity={CAPACITY}
      />,
    )

    const badgeArea = screen.getByTestId('fleet-severity')
    expect(within(badgeArea).getByTestId('severity-badge')).toHaveTextContent('warn')
    expect(badgeArea).toHaveTextContent('2 at warn')
  })

  it('renders a fired fleet-scope check as its own row, distinct from any machine row', () => {
    const machines = [makeMachine({ name: 'a' })]
    const checks = [
      makeCheck({
        key: 'deploy_lane_skew',
        label: 'deploy lane skew',
        severity: 'crit',
        headroom: '3 machines behind',
      }),
    ]
    render(
      <FleetSummary machines={machines} severityMap={{ a: 'ok' }} fleetChecks={checks} capacity={CAPACITY} />,
    )

    const row = screen.getByTestId('fleet-check-deploy_lane_skew')
    expect(row).toHaveTextContent('deploy lane skew')
    expect(row).toHaveTextContent('3 machines behind')
    expect(within(row).getByTestId('severity-badge')).toHaveTextContent('crit')

    // And it fed into the overall rollup too.
    expect(within(screen.getByTestId('fleet-severity')).getByTestId('severity-badge')).toHaveTextContent(
      'crit',
    )
  })

  it('does not render an ok fleet-scope check as a row -- only fired (non-ok) ones', () => {
    const machines = [makeMachine({ name: 'a' })]
    const checks = [makeCheck({ key: 'board_latency', severity: 'ok' })]
    render(
      <FleetSummary machines={machines} severityMap={{ a: 'ok' }} fleetChecks={checks} capacity={CAPACITY} />,
    )

    expect(screen.queryByTestId('fleet-check-board_latency')).not.toBeInTheDocument()
  })

  it('defaults fleetChecks to empty when the prop is omitted', () => {
    render(<FleetSummary machines={[makeMachine({ name: 'a' })]} severityMap={{ a: 'ok' }} capacity={null} />)
    expect(screen.getByTestId('fleet-summary')).toBeInTheDocument()
  })
})
