/**
 * Component tests for `MachineCharts` (#65, M-4) — the machine detail
 * Metrics section's CPU/memory/disk/throughput time-series charts.
 *
 * Rendered directly with a plain `metrics`/`concurrencyLimit` prop pair (no
 * router, no `QueryClientProvider`) — same "pure presentation" split
 * `MachineHealth.test.tsx` documents; `MachineDetail.test.tsx` covers the
 * data-fetching shell (loading / 404-unavailable / fetch-failure) around
 * this component.
 *
 * Four things this file exists to pin, all called out in #65's own issue
 * text:
 *
 *  - plan/degrade selection per chart (a recognised metric with data
 *    renders, an unreported one degrades with its own honest reason)
 *  - gap rendering for `unknown` (`value: null`) samples — a broken line,
 *    never an interpolated one and never a flat zero
 *  - the full-text `aria-label` (contract §8a)
 *  - the always-visible value label (contract §8c), including its
 *    hover-driven readout
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import MachineCharts from '@/components/MachineCharts'
import type { MachineMetricsSeries } from '@/api/client'

const NOW = 1_700_010_000

function series(metric: string, points: { t: number; value: number | null }[], unit: string | null = null): MachineMetricsSeries {
  return { metric, unit, points }
}

beforeEach(() => {
  // jsdom's SVGSVGElement has no real layout box -- stub a plausible one so
  // the pointer-hover handler's `clientX -> viewBox x` conversion has a
  // non-zero width to divide by.
  vi.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 120,
    top: 0,
    left: 0,
    right: 400,
    bottom: 120,
    x: 0,
    y: 0,
    toJSON: () => {},
  } as DOMRect)
})

describe('MachineCharts', () => {
  // ── plan/degrade selection ────────────────────────────────────────────

  it('renders a chart for a recognised metric with data, and degrades the others independently', () => {
    const metrics = [series('cpu_pct', [{ t: NOW - 100, value: 42 }], '%')]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)

    expect(screen.getByTestId('machine-chart-cpu')).toBeInTheDocument()
    expect(screen.queryByTestId('machine-chart-cpu-degraded')).not.toBeInTheDocument()

    // mem_pct was never reported -- its own distinct, honest reason.
    expect(screen.getByTestId('machine-chart-memory-degraded')).toHaveTextContent(
      "This machine hasn't reported Memory yet.",
    )
    expect(screen.queryByTestId('machine-chart-memory')).not.toBeInTheDocument()
  })

  it('a machine with no metrics at all degrades every chart, never a false empty axis', () => {
    render(<MachineCharts metrics={[]} concurrencyLimit={null} now={NOW} />)

    expect(screen.getByTestId('machine-chart-cpu-degraded')).toBeInTheDocument()
    expect(screen.getByTestId('machine-chart-memory-degraded')).toBeInTheDocument()
    expect(screen.getByTestId('machine-chart-disk-degraded')).toBeInTheDocument()
    expect(screen.getByTestId('machine-chart-workers-degraded')).toBeInTheDocument()
    expect(screen.getByTestId('machine-chart-throughput-degraded')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('the range selector filters out-of-range data into a degrade, and switching range restores it', () => {
    const metrics = [series('cpu_pct', [{ t: NOW - 5 * 3600, value: 77 }], '%')]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)

    // Default range is "All" -- the 5h-old sample renders.
    expect(screen.getByTestId('machine-chart-cpu')).toBeInTheDocument()

    // Switch to "30m" -- the same sample is now out of range.
    fireEvent.click(screen.getByTestId('machine-chart-range-30m'))
    expect(screen.getByTestId('machine-chart-cpu-degraded')).toHaveTextContent('No CPU samples in the last 30m.')

    // Switching back to "All" brings the chart back.
    fireEvent.click(screen.getByTestId('machine-chart-range-all'))
    expect(screen.getByTestId('machine-chart-cpu')).toBeInTheDocument()
  })

  it('the active-workers chart draws a ceiling reference line only when a concurrency limit is known', () => {
    const metrics = [series('active_workers', [{ t: NOW - 10, value: 2 }])]
    const { rerender } = render(<MachineCharts metrics={metrics} concurrencyLimit={6} now={NOW} />)
    expect(within(screen.getByTestId('machine-chart-workers')).getByText('ceiling 6')).toBeInTheDocument()

    rerender(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)
    expect(within(screen.getByTestId('machine-chart-workers')).queryByText(/ceiling/)).not.toBeInTheDocument()
  })

  // ── gap rendering ────────────────────────────────────────────────────

  it('breaks the line at an unknown sample instead of interpolating or plotting 0', () => {
    const metrics = [
      series('cpu_pct', [
        { t: NOW - 300, value: 10 },
        { t: NOW - 200, value: 20 },
        { t: NOW - 100, value: null },
        { t: NOW, value: 30 },
      ], '%'),
    ]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)

    const chart = screen.getByTestId('machine-chart-cpu')
    // Two known-value runs either side of the gap -> two separate
    // polylines, never one line spanning the gap.
    expect(chart.querySelectorAll('polyline')).toHaveLength(2)
    // The gap sample gets its own visible marker on the baseline.
    expect(chart.querySelectorAll('circle')).toHaveLength(1)
  })

  it('a series whose every sample in range is unknown degrades rather than rendering a flat line', () => {
    const metrics = [
      series('cpu_pct', [
        { t: NOW - 200, value: null },
        { t: NOW - 100, value: null },
      ], '%'),
    ]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)
    expect(screen.getByTestId('machine-chart-cpu-degraded')).toHaveTextContent(
      'Every CPU poll in the last All failed — no readings to chart.',
    )
  })

  // ── aria-label (contract §8a) ────────────────────────────────────────

  it('carries a full-text aria-label summarizing the series', () => {
    const metrics = [series('cpu_pct', [{ t: NOW - 100, value: 42 }], '%')]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)

    const chart = screen.getByTestId('machine-chart-cpu')
    expect(chart).toHaveAttribute('role', 'img')
    expect(chart.getAttribute('aria-label')).toBe('CPU over the last All: latest 42%, min 42%, max 42%.')
  })

  it('the throughput chart aria-label names each series distinctly', () => {
    const metrics = [
      series('jobs_completed', [{ t: NOW - 100, value: 4 }]),
      series('jobs_failed', [{ t: NOW - 100, value: 1 }]),
    ]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)
    const chart = screen.getByTestId('machine-chart-throughput')
    expect(chart.getAttribute('aria-label')).toBe(
      'Completed / failed over the last All: completed latest 4, failed latest 1.',
    )
  })

  // ── value label (contract §8c) + hover readout ───────────────────────

  it('the value readout defaults to the latest known sample', () => {
    const metrics = [
      series('cpu_pct', [
        { t: NOW - 200, value: 10 },
        { t: NOW - 100, value: 88 },
      ], '%'),
    ]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)
    expect(screen.getByTestId('machine-chart-cpu-value')).toHaveTextContent('88%')
  })

  it('hovering the chart re-targets the value readout to the nearest sample', () => {
    const metrics = [
      series('cpu_pct', [
        { t: NOW - 300, value: 10 },
        { t: NOW, value: 90 },
      ], '%'),
    ]
    render(<MachineCharts metrics={metrics} concurrencyLimit={null} now={NOW} />)

    const svg = screen.getByTestId('machine-chart-cpu').querySelector('svg')
    expect(svg).not.toBeNull()
    // Left edge of the chart is nearest the earlier (t = NOW - 300) sample.
    fireEvent.pointerMove(svg as SVGSVGElement, { clientX: 0 })
    expect(screen.getByTestId('machine-chart-cpu-value')).toHaveTextContent('10%')
  })
})
