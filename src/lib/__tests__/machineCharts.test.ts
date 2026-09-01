/**
 * Unit tests for `src/lib/machineCharts.ts` (#65, M-4).
 *
 * Covers the pieces `MachineCharts.tsx` builds its charts from: range
 * selection/filtering, gap-aware segment splitting (never interpolating
 * across, never plotting as 0), the three-outcome single-series chart plan,
 * the multi-series overlay plan, and aria-label construction (contract
 * §8a).
 */
import { describe, it, expect } from 'vitest'
import type { MachineMetricPoint, MachineMetricsSeries } from '@/api/client'
import {
  buildMachineChartAriaLabel,
  buildMachineChartMultiAriaLabel,
  buildMachineChartSegments,
  DEFAULT_MACHINE_CHART_RANGE_ID,
  filterMachineChartPoints,
  findMachineMetricSeries,
  formatMachineChartBytes,
  formatMachineChartTick,
  formatMachineChartValue,
  MACHINE_CHART_RANGES,
  machineChartMultiPlan,
  machineChartPlan,
  machineChartRangeById,
  machineChartValueKind,
  scaleValue,
  type MachineChartRenderPlan,
} from '../machineCharts'

const ALL_RANGE = machineChartRangeById('all')

// ── ranges ───────────────────────────────────────────────────────────────

describe('MACHINE_CHART_RANGES / machineChartRangeById', () => {
  it('defaults to "all", which never bounds by hardcoding the ~6h retention figure', () => {
    expect(DEFAULT_MACHINE_CHART_RANGE_ID).toBe('all')
    const all = machineChartRangeById('all')
    expect(all.seconds).toBe(Infinity)
  })

  it('falls back to the widest range for an unrecognised id', () => {
    expect(machineChartRangeById('bogus')).toEqual(MACHINE_CHART_RANGES[MACHINE_CHART_RANGES.length - 1])
  })
})

describe('filterMachineChartPoints', () => {
  const points: MachineMetricPoint[] = [
    { t: 100, value: 1 },
    { t: 200, value: 2 },
    { t: 300, value: null },
  ]

  it('keeps only samples within the range window, sorted ascending', () => {
    const out = filterMachineChartPoints([points[2], points[0], points[1]], 150, 300)
    // cutoff = 300 - 150 = 150 -> keeps t=200 and t=300, drops t=100
    expect(out.map((p) => p.t)).toEqual([200, 300])
  })

  it('"All" (Infinity seconds) keeps every sample regardless of now', () => {
    const out = filterMachineChartPoints(points, Infinity, 1)
    expect(out).toHaveLength(3)
  })
})

describe('findMachineMetricSeries', () => {
  const metrics: MachineMetricsSeries[] = [
    { metric: 'cpu_pct', unit: '%', points: [] },
    { metric: 'mem_pct', unit: '%', points: [] },
  ]

  it('finds a series by metric key', () => {
    expect(findMachineMetricSeries(metrics, 'mem_pct')?.metric).toBe('mem_pct')
  })

  it('returns null for a metric the machine never reported', () => {
    expect(findMachineMetricSeries(metrics, 'worktree_bytes')).toBeNull()
  })
})

// ── value formatting ─────────────────────────────────────────────────────

describe('machineChartValueKind / formatMachineChartValue', () => {
  it('known metric keys map to their unit kind', () => {
    expect(machineChartValueKind('cpu_pct')).toBe('percent')
    expect(machineChartValueKind('mem_pct')).toBe('percent')
    expect(machineChartValueKind('worktree_bytes')).toBe('bytes')
    expect(machineChartValueKind('active_workers')).toBe('count')
    expect(machineChartValueKind('jobs_completed')).toBe('count')
  })

  it('an unrecognised metric key falls back to count rather than throwing', () => {
    expect(machineChartValueKind('some_future_metric')).toBe('count')
  })

  it('percent rounds and appends %', () => {
    expect(formatMachineChartValue(54.6, 'percent')).toBe('55%')
  })

  it('bytes reuses binary-unit formatting', () => {
    expect(formatMachineChartValue(1_500_000_000, 'bytes')).toBe('1.4 GB')
    expect(formatMachineChartBytes(512)).toBe('512 B')
  })

  it('count rounds to the nearest whole number', () => {
    expect(formatMachineChartValue(3.4, 'count')).toBe('3')
  })

  it('round-trips the exact worktree_bytes value e2e/machine-charts.spec.ts asserts on', () => {
    // Guards against the two drifting independently: the formatter is
    // binary (1024-based), so a future edit to either this byte value or
    // the e2e fixture's copy of it must keep both in sync with what
    // formatMachineChartBytes actually renders, not a decimal (SI) guess.
    expect(formatMachineChartValue(2_147_483_648, 'bytes')).toBe('2.0 GB')
  })
})

describe('formatMachineChartTick', () => {
  it('renders epoch seconds as local HH:MM', () => {
    const d = new Date(1_700_000_000 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    expect(formatMachineChartTick(1_700_000_000)).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
  })
})

// ── scaleValue ───────────────────────────────────────────────────────────

describe('scaleValue', () => {
  it('maps the domain endpoints to the range endpoints', () => {
    expect(scaleValue(0, 0, 10, 100, 200)).toBe(100)
    expect(scaleValue(10, 0, 10, 100, 200)).toBe(200)
    expect(scaleValue(5, 0, 10, 100, 200)).toBe(150)
  })

  it('collapses to the midpoint when min === max, never dividing by zero', () => {
    expect(scaleValue(7, 7, 7, 0, 100)).toBe(50)
  })
})

// ── gap-aware segments ───────────────────────────────────────────────────

describe('buildMachineChartSegments', () => {
  it('never interpolates across a null (unknown) sample -- it breaks the run', () => {
    const points: MachineMetricPoint[] = [
      { t: 1, value: 10 },
      { t: 2, value: 20 },
      { t: 3, value: null },
      { t: 4, value: null },
      { t: 5, value: 30 },
    ]
    const segments = buildMachineChartSegments(points)
    expect(segments).toEqual([
      [
        { t: 1, value: 10 },
        { t: 2, value: 20 },
      ],
      [{ t: 5, value: 30 }],
    ])
  })

  it('a leading/trailing gap produces no empty segment', () => {
    const points: MachineMetricPoint[] = [
      { t: 1, value: null },
      { t: 2, value: 5 },
      { t: 3, value: null },
    ]
    expect(buildMachineChartSegments(points)).toEqual([[{ t: 2, value: 5 }]])
  })

  it('an all-null series produces zero segments, never a flat zero line', () => {
    const points: MachineMetricPoint[] = [
      { t: 1, value: null },
      { t: 2, value: null },
    ]
    expect(buildMachineChartSegments(points)).toEqual([])
  })
})

// ── single-series chart plan ─────────────────────────────────────────────

describe('machineChartPlan', () => {
  it('degrades when the machine has never reported this metric', () => {
    const plan = machineChartPlan([], 'cpu_pct', 'CPU', ALL_RANGE, 1000)
    expect(plan).toEqual({ status: 'degrade', reason: "This machine hasn't reported CPU yet." })
  })

  it('degrades when the series exists but has zero samples ever', () => {
    const metrics: MachineMetricsSeries[] = [{ metric: 'cpu_pct', unit: '%', points: [] }]
    const plan = machineChartPlan(metrics, 'cpu_pct', 'CPU', ALL_RANGE, 1000)
    expect(plan.status).toBe('degrade')
  })

  it('degrades when every sample is older than the selected range', () => {
    const metrics: MachineMetricsSeries[] = [
      { metric: 'cpu_pct', unit: '%', points: [{ t: 100, value: 50 }] },
    ]
    const range = machineChartRangeById('30m')
    const plan = machineChartPlan(metrics, 'cpu_pct', 'CPU', range, 100_000)
    expect(plan).toEqual({ status: 'degrade', reason: 'No CPU samples in the last 30m.' })
  })

  it('degrades when every sample in range is an explicit unknown, never rendering a flat zero', () => {
    const metrics: MachineMetricsSeries[] = [
      {
        metric: 'cpu_pct',
        unit: '%',
        points: [
          { t: 100, value: null },
          { t: 200, value: null },
        ],
      },
    ]
    const plan = machineChartPlan(metrics, 'cpu_pct', 'CPU', ALL_RANGE, 1000)
    expect(plan).toEqual({
      status: 'degrade',
      reason: 'Every CPU poll in the last All failed — no readings to chart.',
    })
  })

  it('renders with min/max/latest/gapCount computed only over known samples', () => {
    const metrics: MachineMetricsSeries[] = [
      {
        metric: 'cpu_pct',
        unit: '%',
        points: [
          { t: 100, value: 10 },
          { t: 200, value: null }, // a gap -- must not become 0 in min/max
          { t: 300, value: 90 },
        ],
      },
    ]
    const plan = machineChartPlan(metrics, 'cpu_pct', 'CPU', ALL_RANGE, 1000) as MachineChartRenderPlan
    expect(plan.status).toBe('render')
    expect(plan.min).toBe(10)
    expect(plan.max).toBe(90)
    expect(plan.gapCount).toBe(1)
    expect(plan.pointCount).toBe(3)
    expect(plan.latestValue).toBe(90)
    expect(plan.latestT).toBe(300)
    expect(plan.domainMinT).toBe(100)
    expect(plan.domainMaxT).toBe(300)
  })

  it('an unknown *latest* sample renders latestValue null, distinct from "no data at all"', () => {
    const metrics: MachineMetricsSeries[] = [
      {
        metric: 'cpu_pct',
        unit: '%',
        points: [
          { t: 100, value: 40 },
          { t: 200, value: null },
        ],
      },
    ]
    const plan = machineChartPlan(metrics, 'cpu_pct', 'CPU', ALL_RANGE, 1000) as MachineChartRenderPlan
    expect(plan.status).toBe('render')
    expect(plan.latestValue).toBeNull()
    expect(plan.latestT).toBe(200)
  })
})

// ── aria-label (contract §8a) ────────────────────────────────────────────

describe('buildMachineChartAriaLabel', () => {
  it('summarizes label, latest, min, max and gap count in one line', () => {
    const metrics: MachineMetricsSeries[] = [
      {
        metric: 'cpu_pct',
        unit: '%',
        points: [
          { t: 100, value: 10 },
          { t: 200, value: null },
          { t: 300, value: 90 },
        ],
      },
    ]
    const plan = machineChartPlan(metrics, 'cpu_pct', 'CPU', ALL_RANGE, 1000) as MachineChartRenderPlan
    const label = buildMachineChartAriaLabel('CPU', plan, 'percent', 'All')
    expect(label).toBe('CPU over the last All: latest 90%, min 10%, max 90%, 1 gap from failed polls.')
  })

  it('an unknown latest reads as "latest reading unknown", never a fabricated number', () => {
    const metrics: MachineMetricsSeries[] = [
      {
        metric: 'cpu_pct',
        unit: '%',
        points: [
          { t: 100, value: 40 },
          { t: 200, value: null },
        ],
      },
    ]
    const plan = machineChartPlan(metrics, 'cpu_pct', 'CPU', ALL_RANGE, 1000) as MachineChartRenderPlan
    const label = buildMachineChartAriaLabel('CPU', plan, 'percent', 'All')
    expect(label).toContain('latest reading unknown (poll failed)')
  })
})

// ── multi-series (throughput) plan ───────────────────────────────────────

describe('machineChartMultiPlan', () => {
  const specs = [
    { key: 'jobs_completed', label: 'completed', colorClass: 'text-pass' },
    { key: 'jobs_failed', label: 'failed', colorClass: 'text-fail' },
  ]

  it('degrades only when NONE of the declared series has a known sample', () => {
    const plan = machineChartMultiPlan([], specs, 'completed/failed job', ALL_RANGE, 1000)
    expect(plan.status).toBe('degrade')
  })

  it('renders even when only one of the two series has data', () => {
    const metrics: MachineMetricsSeries[] = [
      { metric: 'jobs_completed', unit: null, points: [{ t: 100, value: 4 }] },
    ]
    const plan = machineChartMultiPlan(metrics, specs, 'completed/failed job', ALL_RANGE, 1000)
    expect(plan.status).toBe('render')
    if (plan.status === 'render') {
      const completed = plan.series.find((s) => s.label === 'completed')
      const failed = plan.series.find((s) => s.label === 'failed')
      expect(completed?.latestValue).toBe(4)
      expect(failed?.latestValue).toBeNull()
      expect(failed?.segments).toEqual([])
    }
  })

  it('shares one min/max domain across both series', () => {
    const metrics: MachineMetricsSeries[] = [
      { metric: 'jobs_completed', unit: null, points: [{ t: 100, value: 4 }] },
      { metric: 'jobs_failed', unit: null, points: [{ t: 100, value: 9 }] },
    ]
    const plan = machineChartMultiPlan(metrics, specs, 'completed/failed job', ALL_RANGE, 1000)
    expect(plan.status).toBe('render')
    if (plan.status === 'render') {
      expect(plan.min).toBe(4)
      expect(plan.max).toBe(9)
    }
  })
})

describe('buildMachineChartMultiAriaLabel', () => {
  it('names each series distinctly rather than a single combined number', () => {
    const specs = [
      { key: 'jobs_completed', label: 'completed', colorClass: 'text-pass' },
      { key: 'jobs_failed', label: 'failed', colorClass: 'text-fail' },
    ]
    const metrics: MachineMetricsSeries[] = [
      { metric: 'jobs_completed', unit: null, points: [{ t: 100, value: 4 }] },
      { metric: 'jobs_failed', unit: null, points: [{ t: 100, value: 0 }] },
    ]
    const plan = machineChartMultiPlan(metrics, specs, 'completed/failed job', ALL_RANGE, 1000)
    expect(plan.status).toBe('render')
    if (plan.status === 'render') {
      const label = buildMachineChartMultiAriaLabel('Completed / failed', plan, 'count', 'All')
      expect(label).toBe('Completed / failed over the last All: completed latest 4, failed latest 0.')
    }
  })
})
