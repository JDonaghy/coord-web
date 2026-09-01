/**
 * Pure helpers for `MachineCharts` (#65, M-4) — time-series charts over a
 * machine's ~6h retained metrics window (claude-coordinator#3020 supplies
 * the retention; `GET /api/machines/{name}/metrics`, `fetchMachineMetrics`
 * in `src/api/client.ts`).
 *
 * Reuses the chart-plan discipline `reportChartPlan` (`src/lib/reports.ts`)
 * established for `ReportsPanel`, pinned by the ms-2 acceptance contract
 * §8a-§8d, applied here to a machine's metrics instead of a report result:
 *
 *  - §8a a full-text `aria-label` summarizing the series
 *    (`buildMachineChartAriaLabel`/`buildMachineChartMultiAriaLabel`)
 *  - §8b colours reuse the existing `pass`/`attn`/`fail`/`idle` status
 *    semantics for the identical meaning (completed=pass, failed=fail;
 *    CPU/memory/disk carry no inherent status so they use the neutral
 *    `brand` accent, same choice `reports.ts`'s categorical fallback makes
 *    for a non-`enum` axis)
 *  - §8c every mark carries a direct, visible value label (see
 *    `MachineCharts.tsx`'s own header comment for why a *time series*
 *    satisfies this differently than a bar chart's one-label-per-bar: the
 *    always-visible latest/hovered readout, not a label on every one of
 *    potentially hundreds of points)
 *  - §8d an unrenderable chart degrades to a one-line reason
 *    (`MachineChartPlan`'s `'degrade'` branch) — unlike `ReportChartPlan`,
 *    there is no `'none'` outcome here: a machine chart panel IS the
 *    content (not an optional add-on above an existing grid), so there is
 *    always something to show — a real chart, or an honest reason there
 *    isn't one.
 *
 * ## Gaps are not zeros
 *
 * `MachineMetricPoint.value` carries an explicit `null` for an "unknown"
 * sample — a failed or timed-out poll (`generated.ts`'s own doc comment).
 * `buildMachineChartSegments` breaks the drawn line at every `null` rather
 * than interpolating across it or treating it as `0`; a run of `null`
 * samples renders as a gap plus a visible marker (`MachineCharts.tsx`), and
 * a series whose every sample in the selected range is `null` degrades
 * entirely rather than rendering a flat zero line (contract §8d's "never an
 * empty axis that reads as a flat healthy zero", applied literally).
 *
 * ## Metric vocabulary (hand-authored, wholesale-replaceable)
 *
 * `MachineMetricsSeries.metric` is open vocabulary (`generated.ts`'s own
 * doc comment) — the Machines API itself (claude-coordinator#3027) hasn't
 * landed yet, so these six key names are this client's own best-guess
 * naming, not a transcription of a real server response. Replace wholesale,
 * same posture as the rest of the Machines API block, the day #3027 lands
 * with real field/metric names:
 *
 *  - `cpu_pct` / `mem_pct` — percent, the panel's CPU/memory charts
 *  - `worktree_bytes` — bytes, the disk/worktree-footprint trend (the
 *    "`/home` full while cargo GC said 19.5GB free" class of incident #65's
 *    issue text names — invisible on `MachineState.worktree_bytes`'s
 *    point-in-time reading alone, which is why this needs a trend)
 *  - `active_workers` — count, charted against the machine's own
 *    `concurrency_limit` ceiling (a constant, not a series — passed
 *    separately as a reference line, `MachineCharts.tsx`)
 *  - `jobs_completed` / `jobs_failed` — count, overlaid on one chart
 *    (`machineChartMultiPlan`) reusing the pass/fail status colours
 */
import type { MachineMetricPoint, MachineMetricsSeries } from '@/api/client'

// ── retained-window range selector ──────────────────────────────────────────

export interface MachineChartRange {
  id: string
  label: string
  /** `Infinity` for "All" — never hardcode the ~6h retention figure as the
   * upper bound; the daemon's own retention window is the real ceiling,
   * whatever it happens to be today. */
  seconds: number
}

export const MACHINE_CHART_RANGES: readonly MachineChartRange[] = [
  { id: '30m', label: '30m', seconds: 30 * 60 },
  { id: '1h', label: '1h', seconds: 60 * 60 },
  { id: '3h', label: '3h', seconds: 3 * 60 * 60 },
  { id: '6h', label: '6h', seconds: 6 * 60 * 60 },
  { id: 'all', label: 'All', seconds: Infinity },
]

export const DEFAULT_MACHINE_CHART_RANGE_ID = 'all'

/** Look up a range by id, falling back to the widest ("All") range for an
 * id this build doesn't recognise rather than throwing. */
export function machineChartRangeById(id: string): MachineChartRange {
  return (
    MACHINE_CHART_RANGES.find((r) => r.id === id) ?? MACHINE_CHART_RANGES[MACHINE_CHART_RANGES.length - 1]
  )
}

/** Keep only the samples within `rangeSeconds` of `now`, sorted ascending
 * by time — the client-side slice a range-selector tab applies over
 * whatever the daemon actually retained. */
export function filterMachineChartPoints(
  points: readonly MachineMetricPoint[],
  rangeSeconds: number,
  now: number,
): MachineMetricPoint[] {
  const cutoff = rangeSeconds === Infinity ? -Infinity : now - rangeSeconds
  return points
    .filter((p) => p.t >= cutoff)
    .slice()
    .sort((a, b) => a.t - b.t)
}

/** The named series within a machine's metrics array, or `null` when this
 * machine has never reported it (an older agent, or a metric this build
 * expects that the daemon simply doesn't emit). */
export function findMachineMetricSeries(
  metrics: readonly MachineMetricsSeries[],
  metricKey: string,
): MachineMetricsSeries | null {
  return metrics.find((m) => m.metric === metricKey) ?? null
}

// ── value formatting ─────────────────────────────────────────────────────

export type MachineChartValueKind = 'percent' | 'bytes' | 'count'

/** `metricKey` -> the unit its value should render in. Falls back to
 * `'count'` for a metric key this build doesn't recognise (open vocabulary,
 * same posture as `MachineMetricsSeries.metric` itself). */
const MACHINE_CHART_METRIC_KIND: Record<string, MachineChartValueKind> = {
  cpu_pct: 'percent',
  mem_pct: 'percent',
  worktree_bytes: 'bytes',
  active_workers: 'count',
  jobs_completed: 'count',
  jobs_failed: 'count',
}

export function machineChartValueKind(metricKey: string): MachineChartValueKind {
  return MACHINE_CHART_METRIC_KIND[metricKey] ?? 'count'
}

/** Binary (1024) byte units — same shape as `MachineDetail.tsx`'s own
 * `formatBytes` (worktree footprint, #63), reimplemented here so this
 * module has no dependency on a component file. */
export function formatMachineChartBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/** A chart mark's direct, visible value label (contract §8c) in the unit
 * its metric key implies. */
export function formatMachineChartValue(value: number, kind: MachineChartValueKind): string {
  switch (kind) {
    case 'percent':
      return `${Math.round(value)}%`
    case 'bytes':
      return formatMachineChartBytes(value)
    case 'count':
    default:
      return String(Math.round(value))
  }
}

/** Epoch seconds -> `"HH:MM"`, local time — the x-axis tick label, a
 * shorter cousin of `formatReportTimestamp` (`src/lib/reports.ts`) which
 * always includes the date; an axis spanning at most the retained window
 * (~6h) never needs one. */
export function formatMachineChartTick(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ── gap-aware line segments ──────────────────────────────────────────────

export interface MachineChartKnownPoint {
  t: number
  value: number
}

export type MachineChartSegment = MachineChartKnownPoint[]

/** Split a (possibly gap-carrying) point list into contiguous runs of known
 * (`value !== null`) samples — one polyline per run. A `null` sample never
 * joins two runs into one (never interpolated across); it simply ends
 * whichever run was open, producing a visible gap in the drawn line. */
export function buildMachineChartSegments(points: readonly MachineMetricPoint[]): MachineChartSegment[] {
  const segments: MachineChartSegment[] = []
  let current: MachineChartSegment = []
  for (const p of points) {
    if (p.value === null) {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
      continue
    }
    current.push({ t: p.t, value: p.value })
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/** Linear interpolation of `value` from `[min, max]` into `[rangeMin,
 * rangeMax]` — the one piece of scale math both the time axis and the
 * value axis share. `min === max` (a single sample, or a perfectly flat
 * series) collapses to the midpoint of the output range rather than
 * dividing by zero. */
export function scaleValue(value: number, min: number, max: number, rangeMin: number, rangeMax: number): number {
  if (max === min) return (rangeMin + rangeMax) / 2
  const t = (value - min) / (max - min)
  return rangeMin + t * (rangeMax - rangeMin)
}

// ── single-series chart plan ─────────────────────────────────────────────

export interface MachineChartRenderPlan {
  status: 'render'
  unit: string | null
  /** The filtered, chronologically-sorted samples (gaps included) — the
   * hover/tap nearest-point lookup and the gap markers both read this
   * directly rather than reconstructing it from `segments`. */
  points: MachineMetricPoint[]
  segments: MachineChartSegment[]
  min: number
  max: number
  domainMinT: number
  domainMaxT: number
  /** The most recent sample's value, or `null` when the most recent poll
   * itself failed — distinct from "no data at all" (that degrades instead,
   * see `machineChartPlan`). */
  latestValue: number | null
  latestT: number
  gapCount: number
  pointCount: number
}

export interface MachineChartDegradePlan {
  status: 'degrade'
  reason: string
}

export type MachineChartPlan = MachineChartRenderPlan | MachineChartDegradePlan

/**
 * Decide what to do with one named metric over the selected range — the
 * single-series counterpart of `reportChartPlan`. Three ways this degrades,
 * each an honest, distinct reason (contract §8d) rather than a shared
 * "no data" catch-all:
 *
 *  1. the machine has never reported this metric at all (no series, or a
 *     series with zero samples ever — an old agent, or one that never
 *     started reporting it)
 *  2. the metric exists but has no samples inside the selected range (a
 *     machine that just started reporting, viewed on a wide range, or one
 *     whose data is all older than a narrow range selection)
 *  3. every sample inside the range is an explicit "unknown" (`value:
 *     null`) — every poll in the window failed; there is nothing to plot,
 *     and rendering an empty axis here would look identical to "measured
 *     zero" (exactly the failure mode #65's issue text calls out)
 */
export function machineChartPlan(
  metrics: readonly MachineMetricsSeries[],
  metricKey: string,
  label: string,
  range: MachineChartRange,
  now: number,
): MachineChartPlan {
  const series = findMachineMetricSeries(metrics, metricKey)
  if (!series || series.points.length === 0) {
    return { status: 'degrade', reason: `This machine hasn't reported ${label} yet.` }
  }

  const filtered = filterMachineChartPoints(series.points, range.seconds, now)
  if (filtered.length === 0) {
    return { status: 'degrade', reason: `No ${label} samples in the last ${range.label}.` }
  }

  const known = filtered.filter((p): p is { t: number; value: number } => p.value !== null)
  if (known.length === 0) {
    return {
      status: 'degrade',
      reason: `Every ${label} poll in the last ${range.label} failed — no readings to chart.`,
    }
  }

  const last = filtered[filtered.length - 1]
  return {
    status: 'render',
    unit: series.unit,
    points: filtered,
    segments: buildMachineChartSegments(filtered),
    min: Math.min(...known.map((p) => p.value)),
    max: Math.max(...known.map((p) => p.value)),
    domainMinT: filtered[0].t,
    domainMaxT: filtered[filtered.length - 1].t,
    latestValue: last.value,
    latestT: last.t,
    gapCount: filtered.length - known.length,
    pointCount: filtered.length,
  }
}

/** The chart region's full-text `aria-label` (contract §8a) for a
 * single-series render plan. */
export function buildMachineChartAriaLabel(
  label: string,
  plan: MachineChartRenderPlan,
  kind: MachineChartValueKind,
  rangeLabel: string,
): string {
  const latest =
    plan.latestValue !== null
      ? `latest ${formatMachineChartValue(plan.latestValue, kind)}`
      : 'latest reading unknown (poll failed)'
  const min = formatMachineChartValue(plan.min, kind)
  const max = formatMachineChartValue(plan.max, kind)
  const gaps = plan.gapCount > 0 ? `, ${plan.gapCount} gap${plan.gapCount === 1 ? '' : 's'} from failed polls` : ''
  return `${label} over the last ${rangeLabel}: ${latest}, min ${min}, max ${max}${gaps}.`
}

// ── multi-series chart plan (completed/failed overlay) ──────────────────

export interface MachineChartSeriesSpec {
  key: string
  label: string
  /** Tailwind `text-*` class resolved via `stroke="currentColor"` — reuses
   * the identical `--pass`/`--fail`/etc custom properties the grid's own
   * status badges resolve through (contract §8b), e.g. `'text-pass'` for
   * completed, `'text-fail'` for failed. */
  colorClass: string
}

export interface MachineChartMultiSeriesResolved {
  label: string
  colorClass: string
  points: MachineMetricPoint[]
  segments: MachineChartSegment[]
  latestValue: number | null
  gapCount: number
}

export interface MachineChartMultiRenderPlan {
  status: 'render'
  series: MachineChartMultiSeriesResolved[]
  min: number
  max: number
  domainMinT: number
  domainMaxT: number
}

export type MachineChartMultiPlan = MachineChartMultiRenderPlan | MachineChartDegradePlan

/**
 * Multi-series counterpart of `machineChartPlan` — overlays several named
 * metrics sharing one value/time domain (the throughput chart's
 * `jobs_completed`/`jobs_failed`). Degrades only when NONE of the declared
 * series has so much as one known sample in range; a spec with no data at
 * all still renders (as an empty series with no line) alongside one that
 * does, rather than dragging the whole chart down — a machine that has
 * never failed a job in the retained window is real data, not a reason to
 * hide the completed line too.
 */
export function machineChartMultiPlan(
  metrics: readonly MachineMetricsSeries[],
  specs: readonly MachineChartSeriesSpec[],
  groupLabel: string,
  range: MachineChartRange,
  now: number,
): MachineChartMultiPlan {
  const resolved = specs.map((spec) => {
    const series = findMachineMetricSeries(metrics, spec.key)
    const filtered = series ? filterMachineChartPoints(series.points, range.seconds, now) : []
    return { spec, filtered }
  })

  const known = resolved.flatMap((r) => r.filtered.filter((p): p is { t: number; value: number } => p.value !== null))
  if (known.length === 0) {
    return {
      status: 'degrade',
      reason: `No ${groupLabel} samples in the last ${range.label} (or every poll failed).`,
    }
  }

  const allT = resolved.flatMap((r) => r.filtered.map((p) => p.t))
  const series: MachineChartMultiSeriesResolved[] = resolved.map((r) => {
    const knownForSeries = r.filtered.filter((p): p is { t: number; value: number } => p.value !== null)
    const last = [...r.filtered].reverse().find((p) => p.value !== null)
    return {
      label: r.spec.label,
      colorClass: r.spec.colorClass,
      points: r.filtered,
      segments: buildMachineChartSegments(r.filtered),
      latestValue: last ? last.value : null,
      gapCount: r.filtered.length - knownForSeries.length,
    }
  })

  return {
    status: 'render',
    series,
    min: Math.min(...known.map((p) => p.value)),
    max: Math.max(...known.map((p) => p.value)),
    domainMinT: Math.min(...allT),
    domainMaxT: Math.max(...allT),
  }
}

/** The chart region's full-text `aria-label` (contract §8a) for a
 * multi-series render plan — one clause per series, each carrying its own
 * direct value label (or an honest "no data"/gap note) rather than a single
 * combined number that would hide which series is which. */
export function buildMachineChartMultiAriaLabel(
  title: string,
  plan: MachineChartMultiRenderPlan,
  kind: MachineChartValueKind,
  rangeLabel: string,
): string {
  const parts = plan.series.map((s) => {
    const latest = s.latestValue !== null ? formatMachineChartValue(s.latestValue, kind) : 'no reading'
    const gaps = s.gapCount > 0 ? ` (${s.gapCount} gap${s.gapCount === 1 ? '' : 's'})` : ''
    return `${s.label} latest ${latest}${gaps}`
  })
  return `${title} over the last ${rangeLabel}: ${parts.join(', ')}.`
}
