/**
 * Component tests for `MachinesList` (#62) — parity coverage against
 * coord-tui's `machines_list` (`coord-tui/src/app/mod.rs`): reachability,
 * rolled-up health severity (including the `'unknown'` honesty rule),
 * agent-version drift against the local machine, and the three independent
 * pause/cordon badges.
 *
 * Rendered directly with plain props (no router, no QueryClientProvider) --
 * `MachinesList` is pure presentation, `MachinesPanel.test.tsx` covers the
 * data-fetching shell around it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MachinesList } from '@/components/MachinesList'
import type { MachineState } from '@/api/client'

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
    ...overrides,
  }
}

function row(name: string) {
  return screen.getByTestId(`machine-row-${name}`)
}

describe('MachinesList', () => {
  // ── Reachability ──────────────────────────────────────────────────────

  it('renders an online machine distinctly from an offline one', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({ name: 'online-one', reachable: true }),
          makeMachine({ name: 'offline-one', reachable: false }),
        ]}
        onSelect={() => undefined}
      />,
    )

    expect(row('online-one')).toHaveTextContent('online')
    expect(row('offline-one')).toHaveTextContent('offline')
  })

  it('calls onSelect with the machine name when a row is pressed', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<MachinesList machines={[makeMachine({ name: 'laptop' })]} onSelect={onSelect} />)

    await user.click(row('laptop'))
    expect(onSelect).toHaveBeenCalledWith('laptop')
  })

  // ── Rolled-up health severity ────────────────────────────────────────

  it.each([
    ['ok', 'ok'],
    ['warn', 'warn'],
    ['crit', 'crit'],
    ['unknown', 'unknown'],
  ] as const)('renders a %s severity badge labeled %s', (severity, label) => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'm1', severity })]}
        onSelect={() => undefined}
      />,
    )
    expect(within(row('m1')).getByTestId('severity-badge')).toHaveTextContent(label)
  })

  it('never renders "unknown" severity with the same styling as "ok" -- the honesty rule', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({ name: 'healthy', severity: 'ok' }),
          makeMachine({ name: 'unvouched', severity: 'unknown' }),
        ]}
        onSelect={() => undefined}
      />,
    )

    const okBadge = within(row('healthy')).getByTestId('severity-badge')
    const unknownBadge = within(row('unvouched')).getByTestId('severity-badge')

    expect(unknownBadge).toHaveTextContent('unknown')
    expect(unknownBadge.className).not.toEqual(okBadge.className)
    // Explicitly not styled with the "ok" pass colour.
    expect(unknownBadge.className).not.toMatch(/text-pass/)
    expect(unknownBadge.className).not.toMatch(/bg-pass-wash/)
  })

  // ── Agent version drift ──────────────────────────────────────────────

  it('does not flag drift when a remote machine matches the local agent version', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({ name: 'local', is_local: true, agent_version: '1.2.3' }),
          makeMachine({ name: 'remote', is_local: false, agent_version: '1.2.3' }),
        ]}
        onSelect={() => undefined}
      />,
    )

    const badge = within(row('remote')).getByTestId('agent-version')
    expect(badge).toHaveTextContent('1.2.3')
    expect(badge.className).not.toMatch(/text-destructive/)
  })

  it('flags drift (rendered red) when a remote machine differs from the local agent version', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({ name: 'local', is_local: true, agent_version: '1.2.3' }),
          makeMachine({ name: 'remote', is_local: false, agent_version: '1.9.9' }),
        ]}
        onSelect={() => undefined}
      />,
    )

    const badge = within(row('remote')).getByTestId('agent-version')
    expect(badge).toHaveTextContent('1.9.9')
    expect(badge.className).toMatch(/text-destructive/)
  })

  it('never flags the local machine itself as drifted', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'local', is_local: true, agent_version: '1.2.3' })]}
        onSelect={() => undefined}
      />,
    )

    const badge = within(row('local')).getByTestId('agent-version')
    expect(badge.className).not.toMatch(/text-destructive/)
  })

  it('does not flag drift when either side has no reported version', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({ name: 'local', is_local: true, agent_version: null }),
          makeMachine({ name: 'remote', is_local: false, agent_version: '1.2.3' }),
        ]}
        onSelect={() => undefined}
      />,
    )

    const badge = within(row('remote')).getByTestId('agent-version')
    expect(badge.className).not.toMatch(/text-destructive/)
  })

  // ── Badge set: quiet-hours / hand-pause / release-cordon ─────────────

  it('renders no pause/cordon badges when none apply', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({
            name: 'm1',
            quiet_hours_paused: false,
            hand_paused: false,
            release_cordoned: false,
          }),
        ]}
        onSelect={() => undefined}
      />,
    )

    const r = row('m1')
    expect(within(r).queryByTestId('badge-quiet-hours')).not.toBeInTheDocument()
    expect(within(r).queryByTestId('badge-hand-pause')).not.toBeInTheDocument()
    expect(within(r).queryByTestId('badge-release-cordon')).not.toBeInTheDocument()
  })

  it('renders a quiet-hours badge distinct from a hand-pause badge', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'm1', quiet_hours_paused: true, hand_paused: false })]}
        onSelect={() => undefined}
      />,
    )

    const r = row('m1')
    expect(within(r).getByTestId('badge-quiet-hours')).toHaveTextContent('quiet hours')
    expect(within(r).queryByTestId('badge-hand-pause')).not.toBeInTheDocument()
    expect(within(r).queryByTestId('badge-release-cordon')).not.toBeInTheDocument()
  })

  it('renders a hand-pause badge distinct from a quiet-hours badge', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'm1', hand_paused: true, quiet_hours_paused: false })]}
        onSelect={() => undefined}
      />,
    )

    const r = row('m1')
    expect(within(r).getByTestId('badge-hand-pause')).toHaveTextContent('paused')
    expect(within(r).queryByTestId('badge-quiet-hours')).not.toBeInTheDocument()
    expect(within(r).queryByTestId('badge-release-cordon')).not.toBeInTheDocument()
  })

  it('renders a release-cordon badge distinct from the pause badges', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({
            name: 'm1',
            release_cordoned: true,
            hand_paused: false,
            quiet_hours_paused: false,
          }),
        ]}
        onSelect={() => undefined}
      />,
    )

    const r = row('m1')
    expect(within(r).getByTestId('badge-release-cordon')).toHaveTextContent('cordoned')
    expect(within(r).queryByTestId('badge-hand-pause')).not.toBeInTheDocument()
    expect(within(r).queryByTestId('badge-quiet-hours')).not.toBeInTheDocument()
  })

  it('renders all three badges at once, distinctly, when a machine is in every state', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({
            name: 'm1',
            quiet_hours_paused: true,
            hand_paused: true,
            release_cordoned: true,
          }),
        ]}
        onSelect={() => undefined}
      />,
    )

    const r = row('m1')
    expect(within(r).getByTestId('badge-quiet-hours')).toHaveTextContent('quiet hours')
    expect(within(r).getByTestId('badge-hand-pause')).toHaveTextContent('paused')
    expect(within(r).getByTestId('badge-release-cordon')).toHaveTextContent('cordoned')
  })
})
