/**
 * Component tests for `MachineHealth` (#64) — the machine detail Health
 * section's per-check rows.
 *
 * Rendered directly with a plain `MachineHealthSnapshot` prop (no router, no
 * QueryClientProvider) -- `MachineHealth` is pure presentation, the same
 * split `MachinesList`/`MachinesPanel` establish; `MachineDetail.test.tsx`
 * covers the data-fetching shell (loading / 404-unavailable / fetch-failure)
 * around it.
 *
 * Two things this file exists to pin, both called out explicitly in #64:
 *
 *  - Every row's `severity` is rendered verbatim via the shared
 *    `SeverityBadge` across all four severities, never re-derived or
 *    re-ranked from `headroom`/`detail`.
 *  - A stale snapshot reads as "last measured OK, a while ago" -- never as
 *    "OK" -- and a machine with no health data at all (old agent, or never
 *    polled: `checked_at: null` and an empty `results`) renders an explicit
 *    "no data" state rather than an empty-but-healthy check list.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import MachineHealth from '@/components/MachineHealth'
import type { MachineHealthCheckResult, MachineHealthSnapshot } from '@/api/client'

function makeResult(overrides: Partial<MachineHealthCheckResult> = {}): MachineHealthCheckResult {
  return {
    key: 'disk',
    check_id: 'disk',
    scope: 'machine',
    title: 'Disk',
    label: 'disk',
    severity: 'ok',
    headroom: '86% used (22G free)',
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<MachineHealthSnapshot> = {}): MachineHealthSnapshot {
  return {
    severity: 'ok',
    stale: false,
    checked_at: 1_700_000_000,
    results: [makeResult()],
    ...overrides,
  }
}

function row(key: string) {
  return screen.getByTestId(`health-row-${key}`)
}

describe('MachineHealth', () => {
  // ── Per-check severity, rendered verbatim ────────────────────────────────

  it.each([
    ['ok', 'ok'],
    ['warn', 'warn'],
    ['crit', 'crit'],
    ['unknown', 'unknown'],
  ] as const)('renders a %s check with the %s severity badge', async (severity, label) => {
    render(
      <MachineHealth
        snapshot={makeSnapshot({
          results: [makeResult({ key: 'toolchain', label: 'toolchain', severity })],
        })}
      />,
    )

    const el = row('toolchain')
    expect(within(el).getByTestId('severity-badge')).toHaveTextContent(label)
  })

  it('renders each check row with its own headroom string, untouched', () => {
    render(
      <MachineHealth
        snapshot={makeSnapshot({
          results: [
            makeResult({ key: 'disk', label: 'disk', headroom: '86% used (22G free)' }),
            makeResult({
              key: 'worktrees',
              label: 'worktrees',
              severity: 'warn',
              headroom: '12.3 GB across 4 checkouts',
            }),
          ],
        })}
      />,
    )

    expect(row('disk')).toHaveTextContent('86% used (22G free)')
    expect(row('worktrees')).toHaveTextContent('12.3 GB across 4 checkouts')
  })

  it('shows detail text for a non-ok row but not for an ok one', () => {
    render(
      <MachineHealth
        snapshot={makeSnapshot({
          results: [
            makeResult({ key: 'disk', severity: 'ok', detail: 'nothing to see' }),
            makeResult({
              key: 'index_lock',
              label: 'index_lock',
              severity: 'crit',
              detail: 'held for 3h by pid 4821',
            }),
          ],
        })}
      />,
    )

    expect(within(row('disk')).queryByText('nothing to see')).not.toBeInTheDocument()
    expect(within(row('index_lock')).getByText('held for 3h by pid 4821')).toBeInTheDocument()
  })

  // ── Honest stale rendering (#1630) ───────────────────────────────────────

  it('renders a stale snapshot with a distinct banner, not as a plain ok row', () => {
    render(
      <MachineHealth
        snapshot={makeSnapshot({
          severity: 'ok',
          stale: true,
          checked_at: 1_700_000_000,
          results: [makeResult({ severity: 'ok' })],
        })}
      />,
    )

    const banner = screen.getByTestId('health-stale-banner')
    expect(banner).toHaveTextContent(/stale/i)
    // The row itself still renders (last-known data), but the page also
    // carries the distinct staleness signal -- never just the bare 'ok'
    // badge with nothing to say it might be out of date.
    expect(within(row('disk')).getByTestId('severity-badge')).toHaveTextContent('ok')
  })

  it('does not render a stale banner for a fresh (non-stale) snapshot', () => {
    render(<MachineHealth snapshot={makeSnapshot({ stale: false })} />)

    expect(screen.queryByTestId('health-stale-banner')).not.toBeInTheDocument()
  })

  // ── No health data at all: old agent / never polled ─────────────────────

  it('renders an explicit "no data" state for a machine with no health data at all', () => {
    render(
      <MachineHealth
        snapshot={makeSnapshot({ severity: 'unknown', stale: true, checked_at: null, results: [] })}
      />,
    )

    const note = screen.getByTestId('health-never-polled')
    expect(note).toHaveTextContent(/no health data/i)
    // Must not read as a healthy empty list -- no severity badge, no
    // "0 checks, all fine" implication anywhere on the page.
    expect(screen.queryByTestId('severity-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('health-stale-banner')).not.toBeInTheDocument()
  })

  it('renders a distinct empty-but-measured note when results are empty but a checked_at exists', () => {
    render(<MachineHealth snapshot={makeSnapshot({ checked_at: 1_700_000_000, results: [] })} />)

    expect(screen.queryByTestId('health-never-polled')).not.toBeInTheDocument()
    expect(screen.getByText(/no checks reported/i)).toBeInTheDocument()
  })
})
