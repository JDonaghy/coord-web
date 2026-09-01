/**
 * MachineCharts — time-series charts over a machine's ~6h retained metrics
 * window (#65, M-4): CPU, memory, disk/worktree footprint, and worker
 * throughput/concurrency. Fed by `MachineDetail`'s already-fetched
 * `MachineMetricsSeries[]` (`fetchMachineMetrics`, same "each section
 * degrades on its own, route-level unavailability is `MachineDetail`'s own
 * job" split #64's `MachineHealth` already established — this component
 * receives a real (possibly metric-sparse) array, never `null`; a coord
 * server too old to serve `/metrics` at all renders `MachineDetail`'s own
 * `UnavailableNote` instead of this component).
 *
 * coord-tui draws two 2-row sparklines (CPU + mem) with no axes, no scale,
 * no hover, and history that dies when the panel closes (#65's issue text,
 * verbatim) — the bar this clears: a real time axis (`formatMachineChartTick`
 * ticks), a value scale (min/max labels), a range selector over the
 * retained window (`RangeSelector`, client-side slice via
 * `filterMachineChartPoints`), and hover/tap readout of the value at a
 * point (`ValueChart`'s pointer handling).
 *
 * ## Why the always-visible readout, not a label on every point (§8c)
 *
 * `ReportsPanel`'s bar chart labels every bar directly because a report
 * result is a handful of categories. A metrics series over even a narrow
 * 30-minute range can carry dozens of samples — labelling every one would
 * be unreadable, especially at a ~390px phone width. Instead, one
 * always-visible value readout (`data-testid="...-value"`) shows the
 * latest known sample by default and re-targets to the hovered/tapped
 * sample on pointer interaction — still a direct, visible value label at
 * all times (never colour-only), just one that tracks the point of
 * interest instead of decorating all of them at once.
 *
 * ## Gaps
 *
 * `MachineMetricPoint.value: null` (an explicit "unknown" sample — a failed
 * or timed-out poll, `generated.ts`'s own doc comment) breaks the drawn
 * line (`buildMachineChartSegments`, `src/lib/machineCharts.ts`) and gets
 * its own small marker on the time axis rather than being silently absent
 * — a gap must be visibly a gap, not indistinguishable from "no data was
 * ever collected here".
 *
 * ## No charting library
 *
 * Inline SVG, hand-rolled, same choice `ReportsPanel`'s bar chart already
 * made (`package.json` unchanged) — full theme-token control (every stroke
 * colour is a `text-*` Tailwind class resolved through `currentColor`, the
 * same CSS custom properties the grid's own status badges use) and no new
 * dependency for a chart shape simple enough not to need one.
 */
import { useMemo, useState } from 'react'

import type { MachineMetricPoint, MachineMetricsSeries } from '@/api/client'
import { cn } from '@/lib/utils'
import {
  DEFAULT_MACHINE_CHART_RANGE_ID,
  MACHINE_CHART_RANGES,
  buildMachineChartAriaLabel,
  buildMachineChartMultiAriaLabel,
  formatMachineChartTick,
  formatMachineChartValue,
  machineChartMultiPlan,
  machineChartPlan,
  machineChartRangeById,
  machineChartValueKind,
  scaleValue,
  type MachineChartSeriesSpec,
  type MachineChartValueKind,
} from '@/lib/machineCharts'

export interface MachineChartsProps {
  metrics: MachineMetricsSeries[]
  /** `MachineState.concurrency_limit` — the active-workers chart's ceiling
   * reference line. `null` renders the chart with no ceiling line rather
   * than a fabricated one. */
  concurrencyLimit: number | null
  /** Injectable "now", same convention `formatRelativeTime` uses, so tests
   * don't depend on the real clock. */
  now?: number
}

const VIEW_W = 400
const VIEW_H = 120
const PAD_X = 4
const PAD_Y = 12

interface ChartSeriesView {
  label: string
  colorClass: string
  points: MachineMetricPoint[]
  segments: { t: number; value: number }[][]
}

interface HoverState {
  t: number
  /** One value per series, aligned to the same index as the `series` prop
   * — `null` when that series has no sample at (or near) the hovered
   * point, distinct from that sample being an explicit gap. */
  values: (number | null)[]
}

/** The range-selector tab row — a client-side slice over whatever the
 * daemon actually retained (~6h, claude-coordinator#3020), never a second
 * network round trip. One control governs every chart on the panel, so
 * every chart's x-axis stays comparable at a glance. */
function RangeSelector({ rangeId, onChange }: { rangeId: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-3 flex gap-1.5" role="tablist" aria-label="Chart range">
      {MACHINE_CHART_RANGES.map((r) => {
        const selected = r.id === rangeId
        return (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`machine-chart-range-${r.id}`}
            onClick={() => onChange(r.id)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium',
              selected
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'border border-border text-muted-foreground',
            )}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

/** Contract §8d — the one-line reason a chart isn't shown, everything
 * around it (the other charts, the range selector) still renders in full. */
function DegradeNote({ reason, testId }: { reason: string; testId: string }) {
  return (
    <p role="status" data-testid={testId} className="text-xs text-muted-foreground">
      {reason}
    </p>
  )
}

/**
 * The shared SVG line-chart body — a real time axis, a value scale, and
 * hover/tap readout, drawn once and reused for every single- or
 * multi-series chart below rather than duplicating the SVG/pointer-handling
 * code per chart.
 */
function ValueChart({
  title,
  testId,
  ariaLabel,
  series,
  min,
  max,
  domainMinT,
  domainMaxT,
  kind,
  referenceLine,
}: {
  title: string
  testId: string
  ariaLabel: string
  series: ChartSeriesView[]
  min: number
  max: number
  domainMinT: number
  domainMaxT: number
  kind: MachineChartValueKind
  /** The active-workers chart's concurrency-limit ceiling — a constant, not
   * a series. `null` omits the line entirely. */
  referenceLine?: { value: number; label: string } | null
}) {
  const [hover, setHover] = useState<HoverState | null>(null)

  // A flat, sorted-by-time union of every series' known samples, used only
  // to find "the nearest point in time" on pointer move -- the crosshair is
  // driven by time, not by any one series' own sampling cadence.
  const allKnownT = useMemo(
    () =>
      Array.from(
        new Set(
          series.flatMap((s) => s.points.filter((p) => p.value !== null).map((p) => p.t)),
        ),
      ).sort((a, b) => a - b),
    [series],
  )

  // §8c padding: a single sample (min === max, or one point total) still
  // gets a usable value axis rather than a divide-by-zero collapse --
  // `scaleValue` itself handles `min === max`, this just widens the domain
  // slightly so a flat line doesn't render glued to one axis edge.
  const yMin = min === max ? min - 1 : min
  const yMax = min === max ? max + 1 : max

  const xScale = (t: number) => scaleValue(t, domainMinT, domainMaxT, PAD_X, VIEW_W - PAD_X)
  const yScale = (v: number) => scaleValue(v, yMin, yMax, VIEW_H - PAD_Y, PAD_Y)

  function handlePointer(clientX: number, currentTarget: SVGSVGElement) {
    if (allKnownT.length === 0) return
    const rect = currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const viewX = ((clientX - rect.left) / rect.width) * VIEW_W
    let nearestT = allKnownT[0]
    let nearestDist = Math.abs(xScale(nearestT) - viewX)
    for (const t of allKnownT) {
      const dist = Math.abs(xScale(t) - viewX)
      if (dist < nearestDist) {
        nearestT = t
        nearestDist = dist
      }
    }
    const values = series.map((s) => s.points.find((p) => p.t === nearestT)?.value ?? null)
    setHover({ t: nearestT, values })
  }

  const latestValues = series.map((s) => {
    const known = [...s.points].reverse().find((p) => p.value !== null)
    return known ? known.value : null
  })
  const activeT = hover ? hover.t : domainMaxT
  const activeValues = hover ? hover.values : latestValues
  const activeLabel = hover ? formatMachineChartTick(hover.t) : 'latest'

  return (
    <div className="mb-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-faint">{title}</h3>
        <div data-testid={`${testId}-value`} className="flex items-baseline gap-1.5 font-mono text-sm">
          {series.map((s, i) => (
            <span key={s.label} className={cn(s.colorClass, 'font-semibold')}>
              {activeValues[i] !== null ? formatMachineChartValue(activeValues[i] as number, kind) : '—'}
            </span>
          ))}
          <span className="text-[10px] font-normal text-muted-foreground">{activeLabel}</span>
        </div>
      </div>
      <div
        role="img"
        aria-label={ariaLabel}
        data-testid={testId}
        className="rounded-lg border border-border bg-secondary/20 px-2 py-2"
      >
        <div className="flex items-stretch gap-1.5">
          <div className="flex w-9 shrink-0 flex-col justify-between py-0.5 text-right text-[10px] text-muted-foreground">
            <span>{formatMachineChartValue(yMax, kind)}</span>
            <span>{formatMachineChartValue(yMin, kind)}</span>
          </div>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-[120px] w-full touch-none"
            aria-hidden="true"
            onPointerMove={(e) => handlePointer(e.clientX, e.currentTarget)}
            onPointerDown={(e) => handlePointer(e.clientX, e.currentTarget)}
            onPointerLeave={() => setHover(null)}
          >
            {referenceLine && (
              <>
                <line
                  x1={PAD_X}
                  x2={VIEW_W - PAD_X}
                  y1={yScale(referenceLine.value)}
                  y2={yScale(referenceLine.value)}
                  className="text-idle"
                  stroke="currentColor"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
                <text
                  x={VIEW_W - PAD_X}
                  y={yScale(referenceLine.value) - 2}
                  textAnchor="end"
                  className="fill-idle"
                  fontSize={9}
                >
                  {referenceLine.label}
                </text>
              </>
            )}
            {series.map((s) => (
              <g key={s.label}>
                {s.segments.map((segment, si) => (
                  <polyline
                    key={si}
                    points={segment.map((p) => `${xScale(p.t)},${yScale(p.value)}`).join(' ')}
                    fill="none"
                    className={s.colorClass}
                    stroke="currentColor"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
                {/* Gap markers -- an explicit "unknown" sample gets a small
                    dot on the baseline instead of being invisible, so a
                    dead-agent stretch of failed polls is visibly present,
                    never mistaken for "no data was ever collected here". */}
                {s.points
                  .filter((p) => p.value === null)
                  .map((p, gi) => (
                    <circle
                      key={gi}
                      cx={xScale(p.t)}
                      cy={VIEW_H - 3}
                      r={1.75}
                      className={s.colorClass}
                      fill="currentColor"
                      opacity={0.5}
                    />
                  ))}
              </g>
            ))}
            {hover && (
              <line
                x1={xScale(hover.t)}
                x2={xScale(hover.t)}
                y1={PAD_Y}
                y2={VIEW_H - PAD_Y}
                className="text-muted-foreground"
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            )}
          </svg>
        </div>
        <div className="mt-1 flex justify-between pl-[42px] text-[10px] text-muted-foreground">
          <span>{formatMachineChartTick(domainMinT)}</span>
          <span>{formatMachineChartTick(activeT)}</span>
        </div>
        {series.length > 1 && (
          <p className="mt-1.5 pl-[42px] text-[10px] text-muted-foreground">
            {series.map((s) => (
              <span key={s.label} className={cn('mr-3 inline-flex items-center gap-1', s.colorClass)}>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
                {s.label}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}

function SingleMetricChart({
  title,
  testId,
  metrics,
  metricKey,
  colorClass,
  range,
  now,
  referenceLine,
}: {
  title: string
  testId: string
  metrics: MachineMetricsSeries[]
  metricKey: string
  colorClass: string
  range: (typeof MACHINE_CHART_RANGES)[number]
  now: number
  referenceLine?: { value: number; label: string } | null
}) {
  const kind = machineChartValueKind(metricKey)
  const plan = machineChartPlan(metrics, metricKey, title, range, now)

  if (plan.status === 'degrade') {
    return (
      <div className="mb-5">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">{title}</h3>
        <DegradeNote reason={plan.reason} testId={`${testId}-degraded`} />
      </div>
    )
  }

  const ariaLabel = buildMachineChartAriaLabel(title, plan, kind, range.label)
  return (
    <ValueChart
      title={title}
      testId={testId}
      ariaLabel={ariaLabel}
      series={[{ label: title, colorClass, points: plan.points, segments: plan.segments }]}
      min={plan.min}
      max={plan.max}
      domainMinT={plan.domainMinT}
      domainMaxT={plan.domainMaxT}
      kind={kind}
      referenceLine={referenceLine}
    />
  )
}

function ThroughputChart({
  metrics,
  range,
  now,
}: {
  metrics: MachineMetricsSeries[]
  range: (typeof MACHINE_CHART_RANGES)[number]
  now: number
}) {
  const specs: MachineChartSeriesSpec[] = [
    { key: 'jobs_completed', label: 'completed', colorClass: 'text-pass' },
    { key: 'jobs_failed', label: 'failed', colorClass: 'text-fail' },
  ]
  const plan = machineChartMultiPlan(metrics, specs, 'completed/failed job', range, now)
  const title = 'Completed / failed'

  if (plan.status === 'degrade') {
    return (
      <div className="mb-5">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">{title}</h3>
        <DegradeNote reason={plan.reason} testId="machine-chart-throughput-degraded" />
      </div>
    )
  }

  const ariaLabel = buildMachineChartMultiAriaLabel(title, plan, 'count', range.label)
  return (
    <ValueChart
      title={title}
      testId="machine-chart-throughput"
      ariaLabel={ariaLabel}
      series={plan.series.map((s) => ({
        label: s.label,
        colorClass: s.colorClass,
        points: s.points,
        segments: s.segments,
      }))}
      min={Math.min(0, plan.min)}
      max={plan.max}
      domainMinT={plan.domainMinT}
      domainMaxT={plan.domainMaxT}
      kind="count"
    />
  )
}

export default function MachineCharts({ metrics, concurrencyLimit, now = Date.now() / 1000 }: MachineChartsProps) {
  const [rangeId, setRangeId] = useState(DEFAULT_MACHINE_CHART_RANGE_ID)
  const range = machineChartRangeById(rangeId)

  return (
    <div>
      <RangeSelector rangeId={rangeId} onChange={setRangeId} />
      <SingleMetricChart
        title="CPU"
        testId="machine-chart-cpu"
        metrics={metrics}
        metricKey="cpu_pct"
        colorClass="text-brand"
        range={range}
        now={now}
      />
      <SingleMetricChart
        title="Memory"
        testId="machine-chart-memory"
        metrics={metrics}
        metricKey="mem_pct"
        colorClass="text-brand"
        range={range}
        now={now}
      />
      <SingleMetricChart
        title="Worktree footprint"
        testId="machine-chart-disk"
        metrics={metrics}
        metricKey="worktree_bytes"
        colorClass="text-brand"
        range={range}
        now={now}
      />
      <SingleMetricChart
        title="Active workers"
        testId="machine-chart-workers"
        metrics={metrics}
        metricKey="active_workers"
        colorClass="text-brand"
        range={range}
        now={now}
        referenceLine={concurrencyLimit !== null ? { value: concurrencyLimit, label: `ceiling ${concurrencyLimit}` } : null}
      />
      <ThroughputChart metrics={metrics} range={range} now={now} />
    </div>
  )
}
