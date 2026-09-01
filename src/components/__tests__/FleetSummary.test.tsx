/**
 * Component tests for `FleetSummary` (#66) — the fleet-level aggregate at
 * the top of the Machines panel.
 *
 * Rendered directly with plain `MachineState[]`/`MachineHealthCheckResult[]`
 * props (no router, no `QueryClientProvider`) — `FleetSummary` is pure
 * presentation, the same split `MachinesList`/`MachinesPanel` establish. The
 * rollup logic itself (`summarizeFleetHealth`/`summarizeFleetCapacity`) is
 * covered directly in `src/lib/__tests__/fleetHealth.test.ts`; this file
 * only pins that the component wires those rollups into the DOM correctly.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import FleetSummary from '@/components/FleetSummary'
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

describe('FleetSummary (rendered)', () => {
  it('renders online/total, the worst severity badge, and capacity', () => {
    const machines = [
      makeMachine({ name: 'a', reachable: true, headless_workers: 2, concurrency_limit: 6 }),
      makeMachine({ name: 'b', reachable: false, headless_workers: 0, concurrency_limit: 4 }),
    ]
    render(<FleetSummary machines={machines} fleetChecks={[]} />)

    expect(screen.getByTestId('fleet-online')).toHaveTextContent('1 / 2 online')
    expect(within(screen.getByTestId('fleet-severity')).getByTestId('severity-badge')).toHaveTextContent('ok')
    expect(screen.getByTestId('fleet-capacity')).toHaveTextContent('Capacity: 2 / 10 workers')
  })

  it('shows the worst severity plus the count at that severity when not all-ok', () => {
    const machines = [
      makeMachine({ name: 'a', severity: 'warn' }),
      makeMachine({ name: 'b', severity: 'warn' }),
      makeMachine({ name: 'c', severity: 'ok' }),
    ]
    render(<FleetSummary machines={machines} fleetChecks={[]} />)

    const badgeArea = screen.getByTestId('fleet-severity')
    expect(within(badgeArea).getByTestId('severity-badge')).toHaveTextContent('warn')
    expect(badgeArea).toHaveTextContent('2 at warn')
  })

  it('renders a fired fleet-scope check as its own row, distinct from any machine row', () => {
    const machines = [makeMachine({ severity: 'ok' })]
    const checks = [
      makeCheck({
        key: 'deploy_lane_skew',
        label: 'deploy lane skew',
        severity: 'crit',
        headroom: '3 machines behind',
      }),
    ]
    render(<FleetSummary machines={machines} fleetChecks={checks} />)

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
    const machines = [makeMachine()]
    const checks = [makeCheck({ key: 'board_latency', severity: 'ok' })]
    render(<FleetSummary machines={machines} fleetChecks={checks} />)

    expect(screen.queryByTestId('fleet-check-board_latency')).not.toBeInTheDocument()
  })

  it('defaults fleetChecks to empty when the prop is omitted', () => {
    render(<FleetSummary machines={[makeMachine()]} />)
    expect(screen.getByTestId('fleet-summary')).toBeInTheDocument()
  })
})
