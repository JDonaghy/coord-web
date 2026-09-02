/**
 * Component tests for `MachinesList` (#62, re-wired by #76) — rolled-up
 * health severity (joined by name, including the `'unknown'` honesty rule
 * and its fallback for a name absent from the map), the open-vocabulary
 * `state` string, and row selection.
 *
 * #76 dropped the pause/cordon badge set and agent-version drift
 * highlighting this file used to cover: both needed `MachineState` fields
 * (`quiet_hours_paused`/`hand_paused`/`release_cordoned`/`is_local`) that
 * never existed on a real roster (see `MachinesList.tsx`'s doc comment).
 *
 * Rendered directly with plain props (no router, no QueryClientProvider) --
 * `MachinesList` is pure presentation, `MachinesPanel.test.tsx` covers the
 * data-fetching shell around it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MachinesList } from '@/components/MachinesList'
import type { MachineState, Severity } from '@/api/client'

function makeMachine(overrides: Partial<MachineState> = {}): MachineState {
  return {
    name: 'laptop',
    host: 'laptop.tailnet.ts.net',
    state: 'online',
    reason: '',
    latency_ms: 12,
    agent_version: '1.2.3',
    repos: ['coord-web'],
    assignments: { active: [] },
    worktree_bytes: null,
    ...overrides,
  }
}

function row(name: string) {
  return screen.getByTestId(`machine-row-${name}`)
}

describe('MachinesList', () => {
  it('renders the roster-supplied state string verbatim', () => {
    render(
      <MachinesList
        machines={[
          makeMachine({ name: 'online-one', state: 'online' }),
          makeMachine({ name: 'offline-one', state: 'unreachable' }),
        ]}
        severityMap={{}}
        onSelect={() => undefined}
      />,
    )

    expect(row('online-one')).toHaveTextContent('online')
    expect(row('offline-one')).toHaveTextContent('unreachable')
  })

  it('calls onSelect with the machine name when a row is pressed', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <MachinesList
        machines={[makeMachine({ name: 'laptop' })]}
        severityMap={{ laptop: 'ok' }}
        onSelect={onSelect}
      />,
    )

    await user.click(row('laptop'))
    expect(onSelect).toHaveBeenCalledWith('laptop')
  })

  // ── Rolled-up health severity (joined by name) ───────────────────────

  it.each([
    ['ok', 'ok'],
    ['warn', 'warn'],
    ['crit', 'crit'],
    ['unknown', 'unknown'],
  ] as const)('renders a %s severity badge labeled %s', (severity, label) => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'm1' })]}
        severityMap={{ m1: severity as Severity }}
        onSelect={() => undefined}
      />,
    )
    expect(within(row('m1')).getByTestId('severity-badge')).toHaveTextContent(label)
  })

  it('renders unknown for a machine absent from severityMap, never a crash or a fabricated ok', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'never-reported' })]}
        severityMap={{}}
        onSelect={() => undefined}
      />,
    )
    expect(within(row('never-reported')).getByTestId('severity-badge')).toHaveTextContent('unknown')
  })

  it('never renders "unknown" severity with the same styling as "ok" -- the honesty rule', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'healthy' }), makeMachine({ name: 'unvouched' })]}
        severityMap={{ healthy: 'ok', unvouched: 'unknown' }}
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

  // ── Agent version / reason ────────────────────────────────────────────

  it('renders the reported agent version verbatim, with no drift comparison', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'm1', agent_version: '1.9.9' })]}
        severityMap={{ m1: 'ok' }}
        onSelect={() => undefined}
      />,
    )
    expect(within(row('m1')).getByTestId('agent-version')).toHaveTextContent('1.9.9')
  })

  it('omits the agent-version span when unreported', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'm1', agent_version: null, reason: '' })]}
        severityMap={{ m1: 'ok' }}
        onSelect={() => undefined}
      />,
    )
    expect(within(row('m1')).queryByTestId('agent-version')).not.toBeInTheDocument()
  })

  it('renders a reason string when present', () => {
    render(
      <MachinesList
        machines={[makeMachine({ name: 'm1', reason: 'connection refused' })]}
        severityMap={{ m1: 'unknown' }}
        onSelect={() => undefined}
      />,
    )
    expect(row('m1')).toHaveTextContent('connection refused')
  })
})
