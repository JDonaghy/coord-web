/**
 * Pure `coord report` helpers for `ReportsPanel` (#21 RPT-2).
 *
 * Three things live here:
 *
 * - **Cell formatting** (`reportCellText`) — a port of `reports_cell_text` /
 *   `tui/src/app/reports.rs`'s `ColumnMeta.kind` dispatch, cell-for-cell:
 *   `text`/`int`/`enum` render (mostly) as-is, `timestamp` becomes
 *   `YYYY-MM-DD HH:MM`, `duration` a compact human string (`3h 12m`),
 *   `list` a comma-join with an em-dash when empty, and `money` a
 *   4-decimal `$X.XXXX` with a literal zero rendering as an em-dash rather
 *   than `$0.0000` — see `tests/acceptance/ms-2/contract.md` §6b, which this
 *   module's own tests cite clause-by-clause. `reportCellClassName` carries
 *   only the two CSS-relevant hints (`mono`, `align`) a caller needs on top
 *   of the text itself; `enum`'s pill/badge rendering is the one kind this
 *   module doesn't own — `ReportsPanel` wraps its raw text in `Badge`
 *   itself, via `reportEnumBadgeVariant` below.
 * - **Parameter defaults** (`buildReportParamDefaults`) — the empty/default
 *   value set a freshly-selected report's param form starts from, read
 *   straight off `ReportParam.default` (never invented) so a client never
 *   hardcodes a per-report field list (`ReportParam`'s own doc comment,
 *   `coord/reports.py`).
 * - **Client-side sort** (`sortReportRows`) — contract §6c: clicking a
 *   sortable column header toggles ascending/descending. Comparison is
 *   numeric for the four numeric-shaped kinds (`int`, `money`, `timestamp`,
 *   `duration` — all plain numbers on the wire, see `ReportResult.rows`'s
 *   doc comment) and lexicographic (via `reportCellText`, so a `list` sorts
 *   on its comma-joined rendering) for everything else.
 */
import type { ChartSpec, ColumnMeta, ReportDef, ReportParam, ReportResult, RowIdentity } from '@/api/client'
import type { BadgeProps } from '@/components/ui/badge'

// ── cell formatting (contract §6b) ──────────────────────────────────────────

/** What an absent/unrenderable cell value shows — same convention as
 * `QUEUE_EMPTY_CELL` in `src/lib/driveQueue.ts`: a blank cell and a failed
 * paint look identical, an em dash says "there is nothing here" out loud. */
export const REPORT_EMPTY_CELL = '—'

/**
 * `"11520"` seconds → `"3h 12m"`, `"100800"` → `"1d 4h"`, `"720"` → `"12m"`.
 * Compact human duration: once a coarser unit applies, the next-finer unit
 * is shown alongside it (days+hours, hours+minutes) and anything finer is
 * dropped — never a three-unit string, and never the finest unit alone once
 * a coarser one is nonzero. Mirrors `format_duration`-shaped helpers
 * elsewhere in this codebase (`formatQueueAge` in `driveQueue.ts` is the
 * relative-clock cousin of this one; this is the fixed-span cousin, no
 * "ago").
 */
export function formatReportDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  if (seconds < 60) return `${seconds}s`
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

/**
 * Epoch-seconds → `YYYY-MM-DD HH:MM`, in the browser's local timezone.
 *
 * Contract §6b pins the FORMAT SHAPE only, not a timezone-conversion rule —
 * `tests/acceptance/ms-2/rpt-2-drive-queue-status.spec.ts` itself asserts
 * this cell by regex shape, never an exact clock reading, for exactly that
 * reason (its own comment: "this suite has no way to force the browser
 * process's local timezone").
 */
export function formatReportTimestamp(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * `1` → `"—"` (a literal zero never renders `$0.0000`, contract §6b),
 * `4.821` → `"$4.8210"` — 4 decimal places, port of `format_money` /
 * `tui/src/app/format.rs`.
 */
export function formatReportMoney(value: number | null | undefined): string {
  if (value == null || value === 0) return REPORT_EMPTY_CELL
  return `$${value.toFixed(4)}`
}

/** `["api#42", "api#40"]` → `"api#42, api#40"`; `[]`/absent → the empty
 * cell. Non-array values (a client meeting bad data) coerce to a
 * single-element list rather than throwing. A `list`-kind cell whose
 * items are `{label, ...}` dicts (see `reportListOptions` below) joins on
 * each option's `label` rather than stringifying the dict — this is the
 * plain-text fallback path (client-side sort, an aria label), so it must
 * never read `[object Object]` any more than the rendered cell may read
 * raw JSON (contract §6d). */
export function formatReportList(value: unknown): string {
  const options = reportListOptions(value)
  if (options) return options.map((o) => o.label).join(', ')
  const arr = Array.isArray(value) ? value : value == null ? [] : [value]
  return arr.length > 0 ? arr.map((v) => String(v)).join(', ') : REPORT_EMPTY_CELL
}

/** A single option in a `decisions`-shaped `options` cell — `label` is
 * always shown, `command_or_action` is machine-facing (surfaced via
 * `title`, never printed inline), `recommended` drives the ★ affordance.
 * Port of the shape `reports_list_item_text` reads in
 * `tui/src/app/reports.rs`. */
export interface ReportListOption {
  label: string
  command_or_action?: string
  recommended: boolean
}

/**
 * Structural (not report-id-keyed) detector: does a `list`-kind cell hold
 * `{label, command_or_action, recommended}`-shaped dicts (contract §6d,
 * `decisions`' `options` column) rather than plain scalars? Returns `null`
 * for anything else — an empty array, a list of strings/numbers, or a
 * non-array value — so a caller can `??`/ternary straight into the plain
 * `formatReportList` path.
 *
 * Deliberately keyed off the VALUE's own shape rather than `columnId ===
 * 'options'` or the selected report's id: RPT-2's picker is catalogue-
 * driven precisely so a report needing bespoke handling is a signal the
 * abstraction leaked (#22's own framing) — any future `list` column on any
 * report whose items happen to carry a `label` gets this same rendering
 * for free, with zero new branches in `ReportsPanel`.
 */
export function reportListOptions(value: unknown): ReportListOption[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const isOptionDict = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) && 'label' in v
  if (!value.every(isOptionDict)) return null
  return (value as Record<string, unknown>[]).map((opt) => ({
    label: String(opt.label),
    command_or_action: typeof opt.command_or_action === 'string' ? opt.command_or_action : undefined,
    recommended: opt.recommended === true,
  }))
}

/**
 * The dispatcher itself — `ColumnMeta.kind` → cell text. An unrecognised
 * kind (a client predating a future kind, per `ColumnMeta`'s own doc
 * comment) falls back to plain stringification rather than failing to
 * render the cell at all.
 */
export function reportCellText(value: unknown, kind: string): string {
  switch (kind) {
    case 'int': {
      if (value == null) return REPORT_EMPTY_CELL
      return String(Math.trunc(Number(value)))
    }
    case 'timestamp': {
      if (value == null) return REPORT_EMPTY_CELL
      return formatReportTimestamp(Number(value))
    }
    case 'duration': {
      if (value == null) return REPORT_EMPTY_CELL
      return formatReportDuration(Number(value))
    }
    case 'list':
      return formatReportList(value)
    case 'money': {
      // Same "value == null -> empty cell" short-circuit every other kind
      // above takes, checked BEFORE the `Number()` coercion below — a
      // missing cell must never fall through to `Number(undefined)` (`NaN`),
      // which `formatReportMoney` doesn't special-case (it only treats a
      // literal `0` and `null`/`undefined` as empty) and would otherwise
      // render as the literal string `"$NaN.0000"`.
      if (value == null) return REPORT_EMPTY_CELL
      return formatReportMoney(typeof value === 'number' ? value : Number(value))
    }
    case 'enum':
    case 'text':
    default:
      return value == null || value === '' ? REPORT_EMPTY_CELL : String(value)
  }
}

/** Mono, tabular-nums rendering applies to every kind except plain `text` —
 * a raw title/description cell reads better in the body font. */
export function reportCellIsMono(kind: string): boolean {
  return kind !== 'text' && kind !== 'enum'
}

/** Right-alignment is a numeric-shaped-kind default (`int`, `money`), but
 * `ColumnMeta.align` is the authority when a report declares one — this is
 * only the fallback for a report that doesn't. */
export function reportCellAlign(meta: Pick<ColumnMeta, 'kind' | 'align'>): 'left' | 'right' {
  if (meta.align === 'right' || meta.align === 'left') return meta.align
  return meta.kind === 'int' || meta.kind === 'money' ? 'right' : 'left'
}

/**
 * `enum`-kind cell → `Badge` variant, matching the same success/warning/
 * destructive/outline status-wash convention `DriveQueuePanel`'s
 * `stateBadgeVariant` already uses (contract §6b: "never solid-fill-plus-
 * white-text"). An unrecognised value renders `outline` rather than
 * silently reading as healthy.
 */
export function reportEnumBadgeVariant(value: string): BadgeProps['variant'] {
  switch (value) {
    case 'running':
    case 'completed':
    case 'passed':
      return 'success'
    case 'blocked':
    case 'failed':
    case 'abandoned':
      return 'destructive'
    case 'held':
      return 'warning'
    default:
      return 'outline'
  }
}

// ── parameter form (contract §4) ────────────────────────────────────────────

/** Which HTML control a `ReportParam.kind` maps to — `choice` → `<select>`,
 * everything else (including an unrecognised future kind) → text `<input>`,
 * per #21's literal mapping and contract §4b's dispatch rule. */
export function reportParamIsChoice(param: Pick<ReportParam, 'kind'>): boolean {
  return param.kind === 'choice'
}

/** The param-form starting values for a report — `ReportParam.default` for
 * every declared param, keyed by `ReportParam.id`. Read verbatim off the
 * catalogue rather than guessing per-report defaults, so a report this
 * client has never seen before still gets a sane starting form. */
export function buildReportParamDefaults(params: readonly ReportParam[]): Record<string, string> {
  const defaults: Record<string, string> = {}
  for (const param of params) {
    defaults[param.id] = param.default
  }
  return defaults
}

/** A `choice` param's `<option>` list: value/label pairs, with the empty
 * choice (the "no filter" preset every `choice` param in this milestone's
 * catalogue declares first) labelled `All repos`-style rather than shown
 * blank — mirrors `mocks/reports-picker.html`'s `<option value="">All
 * repos</option>`. Any other empty-valued choice would be unusual but is
 * handled the same way rather than rendering a blank, unclickable row. */
export function reportChoiceOptions(
  param: Pick<ReportParam, 'choices'>,
): Array<{ value: string; label: string }> {
  return param.choices.map((choice) => ({
    value: choice,
    label: choice === '' ? 'All repos' : choice,
  }))
}

// ── report picker (contract §3) ─────────────────────────────────────────────

/**
 * #21's own report — the one this milestone slice proves end-to-end. Used
 * only to pick a sane default *selection* when a catalogue contains it
 * (falling back to the catalogue's own first entry otherwise); it is
 * deliberately NOT used to reorder the catalogue array itself; see this
 * module's own doc comment header — a generic renderer reads tab order
 * straight off `ReportCatalogue.reports`, the same "don't hardcode a report
 * id list" posture `RowIdentity`'s doc comment states for row navigation.
 */
export const DEFAULT_REPORT_ID = 'drive-queue-status'

/** Which catalogue entry should be selected on cold load — `#21`'s own
 * report when present, else the catalogue's first entry, else `null` for an
 * empty catalogue. */
export function defaultSelectedReportId(reports: readonly ReportDef[]): string | null {
  if (reports.some((r) => r.id === DEFAULT_REPORT_ID)) return DEFAULT_REPORT_ID
  return reports[0]?.id ?? null
}

// ── grid sort (contract §6c) ────────────────────────────────────────────────

export type SortDirection = 'ascending' | 'descending'

/** Toggle helper for a header click — flips the direction only; picking a
 * *different* column always resets to ascending (handled by the caller,
 * which passes `'ascending'` as `current` when the clicked column wasn't
 * already the active one). */
export function toggleSortDirection(current: SortDirection): SortDirection {
  return current === 'ascending' ? 'descending' : 'ascending'
}

/** The four `ColumnMeta.kind`s whose raw row value is already a plain
 * number on the wire (see `ReportResult.rows`'s doc comment) — these sort
 * numerically; everything else sorts on its rendered text. */
function isNumericKind(kind: string): boolean {
  return kind === 'int' || kind === 'money' || kind === 'timestamp' || kind === 'duration'
}

/**
 * Client-side sort over a report's rows (contract §6c) — never a server
 * round trip, and never the CSV export's canonical order (`result_to_csv`'s
 * own doc comment: "the export is the report's own canonical row order,
 * never a client's transient sort"). Returns a new array; `rows` itself is
 * untouched.
 */
export function sortReportRows<T extends Record<string, unknown>>(
  rows: readonly T[],
  columnId: string,
  kind: string,
  direction: SortDirection,
): T[] {
  const sign = direction === 'ascending' ? 1 : -1
  const numeric = isNumericKind(kind)
  return [...rows].sort((a, b) => {
    if (numeric) {
      const av = Number(a[columnId])
      const bv = Number(b[columnId])
      return (av - bv) * sign
    }
    const at = reportCellText(a[columnId], kind)
    const bt = reportCellText(b[columnId], kind)
    return at.localeCompare(bt) * sign
  })
}

// ── header count (contract §2c) ─────────────────────────────────────────────

/** `1` → `"1 row"` (singular), `3` → `"3 rows"` — `reports-header-count`'s
 * exact text, contract §2c. */
export function reportRowCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'row' : 'rows'}`
}

// ── row navigation via row_identity (contract §7, RPT-4 #23) ───────────────

/**
 * The `RowIdentity` declared by the catalogue entry a given `ReportResult`
 * came from, looked up by `report_id` — `ReportResult` itself carries no
 * `row_identity` (only `ReportDef` does, `RowIdentity`'s own doc comment),
 * and the currently-selected tab can momentarily lag a just-landed result
 * during the tab-switch race `ReportsPanel`'s `runTokenRef` already guards.
 * `null` for a report missing from the catalogue (shouldn't happen) or one
 * that declares no `row_identity` at all (§7c — `usage`, `queue-outcomes`,
 * and, per §7.1's flagged-but-unresolved question, `drive-queue-status`
 * today).
 */
export function reportRowIdentityFor(
  reports: readonly ReportDef[],
  reportId: string,
): RowIdentity | null {
  return reports.find((r) => r.id === reportId)?.row_identity ?? null
}

/**
 * Is `columnId` the one column a `row_identity`-declaring report's
 * identifying Link renders in? Always `rowIdentity.issue_column` — the same
 * column `DriveQueuePanel`'s own Issue-column Link occupies. `null`
 * `rowIdentity` (the common case, §7c) means no column ever qualifies, so a
 * caller can unconditionally check every cell without a separate
 * `row_identity !== null` guard.
 */
export function isReportRowIdentityColumn(columnId: string, rowIdentity: RowIdentity | null): boolean {
  return rowIdentity !== null && columnId === rowIdentity.issue_column
}

/**
 * `${repo}#${issue}` for a `row_identity`-declaring report's identifying
 * cell — the same composition `DriveQueuePanel`'s `queueEntryKey`
 * (`src/lib/driveQueue.ts`) uses for `repo_name#issue_number`, applied here
 * to whichever two columns `RowIdentity` names rather than a fixed
 * `BoardDriveQueueEntry` shape. Always composes from the two separate
 * columns — even for a report whose own `issue` column value already
 * *looks* combined (`completed`'s fixture is deliberately seeded this way,
 * see `tests/acceptance/ms-2/rpt-4-row-nav.spec.ts`'s header comment); this
 * function never special-cases a report id to "clean up" that string.
 */
export function reportRowIdentityKey(row: Record<string, unknown>, rowIdentity: RowIdentity): string {
  const repo = row[rowIdentity.repo_column]
  const issue = row[rowIdentity.issue_column]
  return `${repo == null ? '' : String(repo)}#${issue == null ? '' : String(issue)}`
}

/** The `(repo, issue)` pair a `row_identity`-declaring report's identifying
 * cell links to — `paths.pipelineItem(repo, issue)`'s own two arguments,
 * read straight off the row via `RowIdentity`'s named columns. Kept
 * separate from `reportRowIdentityKey` (which always joins with `#`)
 * because `paths.pipelineItem` itself `encodeURIComponent`s each segment
 * independently rather than a pre-joined string. */
export function reportRowIdentityRepoIssue(
  row: Record<string, unknown>,
  rowIdentity: RowIdentity,
): { repo: string; issue: string } {
  const repo = row[rowIdentity.repo_column]
  const issue = row[rowIdentity.issue_column]
  return { repo: repo == null ? '' : String(repo), issue: issue == null ? '' : String(issue) }
}

// ── chart rendering (contract §8, RPT-6 #25) ────────────────────────────────
//
// `reportChartPlan` is a port of `ChartPlan`/`reports_chart_plan` from
// `tui/src/app/reports.rs` (the file #25's own issue text names, verbatim,
// as the thing to port) — the three-outcome compatibility rule that keeps a
// chart-bearing report readable on a client that predates the field, or
// meets a declared `kind` it doesn't understand:
//
//  - `{ status: 'none' }` — no `chart` declared, or nothing worth plotting
//    (an empty result: the empty-window message already owns the panel, an
//    empty axis over it would read as a measured zero, same reasoning as
//    the Rust source). Render exactly as before: no chart, no reserved
//    space, no explanatory line.
//  - `{ status: 'degrade', reason }` — a declaration this build can't
//    honour. One subdued line says why; the grid renders in full,
//    unaffected. Never a half-drawn chart, and never a chart that silently
//    vanishes with no indication anything was skipped.
//  - `{ status: 'render', ... }` — draw it above the grid; both stay
//    visible.
//
// Deliberate differences from the Rust source, both because this is a
// fresh web renderer rather than a byte-exact port of quadraui's terminal
// `Chart` widget:
//
//  1. **Only `kind: "bar"` renders here.** `reports_chart_plan` understands
//     "bar"/"line"/"sparkline"; this initial web port draws bars only (the
//     one shape both contract mocks, `reports-chart.html`/
//     `reports-chart-degraded.html`, illustrate, and the only kind any
//     ms-2 fixture exercises). `line`/`sparkline` degrade the same as any
//     other kind this build doesn't understand yet — the open-vocabulary
//     fallback rule the Rust source itself documents ("same rule as
//     `ColumnMeta.kind`: a kind this binary predates renders the table,
//     not an error") already covers that without a special case.
//  2. **No `multi_series_bars`/quadraui#584 gate.** That check exists
//     because quadraui's terminal bar-chart widget predating #584 drew only
//     `series[0]` and silently dropped the rest. This web renderer draws
//     every series directly (plain HTML columns, no such limitation), so
//     there is no equivalent constraint to port — a multi-series bar chart
//     here is never partially drawn.
//  3. **`categories` is computed for the (more common) no-`group_by`
//     branch too.** `reports_chart_series` only builds per-row axis text
//     inside its `group_by` pivot branch; the terminal `Chart` widget
//     apparently sources its non-pivoted x-axis some other way internal to
//     quadraui. A web bar chart needs a visible, direct category label
//     under every bar regardless (contract §8a/§8c), so this port derives
//     `categories` the same way in both branches: each row's (or each pivot
//     group's) axis text, via `reportCellText` keyed on the axis column's
//     own `ColumnMeta.kind` — exactly `reports_chart_axis_text`'s own
//     formatting rule, just applied one branch wider.
//
// No charting library was added for this (`package.json` unchanged) — the
// dataviz skill's own house style is to build a chart's pieces directly in
// markup from the design system's existing tokens rather than reach for a
// framework, which is also exactly what both contract mocks do (hand-drawn
// SVG bars, no library). It also happens to be the only way to *guarantee*
// contract §8b ("category colours are the same colours the grid's own
// badges already use for the identical value") rather than merely
// approximate it: `reportChartCategoryColorClass` below reuses the exact
// same `reportEnumBadgeVariant` → Tailwind-class mapping the grid's own
// `<Badge>` cells resolve through, so a chart mark's computed colour is
// byte-identical to its row's badge, by construction, on both themes.

/** Rows a legend can label in one line before it stops meaning anything —
 * port of `REPORTS_MAX_CHART_SERIES` (12) in `tui/src/app/reports.rs`. Past
 * this many series the declaration degrades to the grid rather than drawing
 * a chart whose colours no longer map to anything (this repo's "no silent
 * caps" rule: say why instead of quietly plotting a subset). */
const REPORT_CHART_MAX_SERIES = 12

/** One resolved series' data, aligned index-for-index with `categories`. */
export interface ReportChartSeriesData {
  label: string
  data: number[]
}

/** `ChartPlan::Render` — draw a chart above the grid. */
export interface ReportChartRenderPlan {
  status: 'render'
  /** The declaration's own caption (`ChartSpec.title`), `null` when it
   * declared none. */
  title: string | null
  xLabel: string | null
  yLabel: string | null
  series: ReportChartSeriesData[]
  categories: string[]
  /** `ColumnMeta.kind` of whichever column produced `categories` (`x`, or
   * `group_by` when the declaration pivots) — `'text'` when neither names a
   * real column. See `reportChartCategoryColorClass`'s own doc comment for
   * why this is the thing that decides badge-colour reuse vs. a plain
   * categorical fallback. */
  categoryColumnKind: string
}

/** `ChartPlan::Degrade` — table only, plus one line saying why. */
export interface ReportChartDegradePlan {
  status: 'degrade'
  reason: string
}

/** `ChartPlan::None` — nothing declared, or nothing worth plotting. */
export interface ReportChartNonePlan {
  status: 'none'
}

export type ReportChartPlan = ReportChartRenderPlan | ReportChartDegradePlan | ReportChartNonePlan

/** One row's value for a chart series' column, as a number — port of
 * `reports_chart_value`. Looked up by column name, same as a grid cell,
 * since `rows` may carry keys beyond `columns`. A non-numeric cell yields
 * `null` ("no contribution"), never `0` — the difference is what lets a
 * series with no numeric data at all be dropped instead of plotted as a
 * flat zero line. */
function reportChartValue(row: Record<string, unknown>, column: string): number | null {
  const value = row[column]
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function reportColumnKind(result: ReportResult, columnId: string): string {
  return result.column_meta.find((m) => m.id === columnId)?.kind ?? 'text'
}

/** The text identity of a row's (or pivot group's) value in an axis/group
 * column — port of `reports_chart_axis_text`. Rendered through the column's
 * own declared `kind` via `reportCellText`, the same formatting the grid
 * itself uses, so e.g. a `timestamp` axis reads as a time rather than raw
 * epoch seconds. An empty column id (or one no row carries) collapses to a
 * single `''` bucket — a legitimate degenerate answer, not an error. */
function reportChartAxisText(result: ReportResult, row: Record<string, unknown>, column: string): string {
  if (!column) return ''
  return reportCellText(row[column], reportColumnKind(result, column))
}

interface ReportChartSeriesResult {
  series: ReportChartSeriesData[]
  categories: string[]
  categoryColumnKind: string
}

/** Resolve a declaration's series against the result's own rows — port of
 * `reports_chart_series`. Two shapes, exactly as `coord/reports.py`'s
 * `ChartSpec` documents: no `group_by` (one data point per row, in the
 * report's own canonical order) or `group_by` set (a pivot: the x-axis is
 * the distinct `x` values in first-appearance order, one output series per
 * distinct group value, rows landing in the same `(group, x)` cell summed).
 * A declared series whose column yields no numeric value in ANY row is
 * dropped rather than plotted as a flat zero line — a mistyped column id
 * must look like a missing series, not like a real run of zeros. */
function reportChartSeries(result: ReportResult, spec: ChartSpec): ReportChartSeriesResult {
  const declared = spec.series.filter(
    (s) => s.column !== '' && result.rows.some((row) => reportChartValue(row, s.column) !== null),
  )
  if (declared.length === 0) return { series: [], categories: [], categoryColumnKind: 'text' }

  const xColumn = spec.x ?? ''
  const groupColumn = spec.group_by && spec.group_by !== '' ? spec.group_by : null

  if (!groupColumn) {
    const categories = result.rows.map((row) => reportChartAxisText(result, row, xColumn))
    const series = declared.map((s) => ({
      label: s.label,
      data: result.rows.map((row) => reportChartValue(row, s.column) ?? 0),
    }))
    return { series, categories, categoryColumnKind: reportColumnKind(result, xColumn) }
  }

  // The pivot. `x` absent (or naming a column no row carries) collapses
  // every row into a single x slot — a legitimate degenerate answer (one
  // bar per group), not an error.
  const xKeys: string[] = []
  const groupKeys: string[] = []
  const cells: Map<string, number>[] = declared.map(() => new Map())
  for (const row of result.rows) {
    const xText = reportChartAxisText(result, row, xColumn)
    let xIdx = xKeys.indexOf(xText)
    if (xIdx === -1) {
      xKeys.push(xText)
      xIdx = xKeys.length - 1
    }
    const groupText = reportChartAxisText(result, row, groupColumn)
    let groupIdx = groupKeys.indexOf(groupText)
    if (groupIdx === -1) {
      groupKeys.push(groupText)
      groupIdx = groupKeys.length - 1
    }
    declared.forEach((s, si) => {
      const value = reportChartValue(row, s.column)
      if (value === null) return
      const key = `${groupIdx}:${xIdx}`
      cells[si].set(key, (cells[si].get(key) ?? 0) + value)
    })
  }

  const multi = declared.length > 1
  const series: ReportChartSeriesData[] = []
  groupKeys.forEach((group, gi) => {
    declared.forEach((s, si) => {
      series.push({
        label: multi ? `${group} · ${s.label}` : group,
        data: xKeys.map((_, xi) => cells[si].get(`${gi}:${xi}`) ?? 0),
      })
    })
  })
  return { series, categories: xKeys, categoryColumnKind: reportColumnKind(result, groupColumn) }
}

/**
 * Decide what to do with `result`'s chart declaration — port of
 * `reports_chart_plan`. See this section's own header comment for the three
 * outcomes and where this deliberately diverges from the Rust source.
 */
export function reportChartPlan(result: ReportResult): ReportChartPlan {
  const spec = result.chart
  if (!spec) return { status: 'none' }
  if (result.rows.length === 0) return { status: 'none' }

  // The open-vocabulary fallback, same rule as `ColumnMeta.kind`: a kind
  // this build predates (or never supported) renders the grid, not an
  // error. Only "bar" is understood today — see this section's header
  // comment, deviation 1.
  if (spec.kind !== 'bar') {
    return {
      status: 'degrade',
      reason: `Chart not shown: this build does not understand chart kind '${spec.kind}'. The table below carries the same numbers.`,
    }
  }

  const { series, categories, categoryColumnKind } = reportChartSeries(result, spec)
  if (series.length === 0) {
    return {
      status: 'degrade',
      reason: 'Chart not shown: the declared series name no numeric column in this result.',
    }
  }
  if (series.length > REPORT_CHART_MAX_SERIES) {
    return {
      status: 'degrade',
      reason: `Chart not shown: ${series.length} series is more than a one-row legend can label. The table below has all of them.`,
    }
  }

  const xColumnMeta = spec.x ? (result.column_meta.find((m) => m.id === spec.x) ?? null) : null
  return {
    status: 'render',
    title: spec.title !== '' ? spec.title : null,
    xLabel: spec.x ? (xColumnMeta?.label || spec.x) : null,
    yLabel: spec.y_label !== '' ? spec.y_label : null,
    series,
    categories,
    categoryColumnKind,
  }
}

/** `128` -> `"128"`, `4.821` -> `"4.82"` — a chart mark's direct value
 * label (contract §8c: "every mark carries a direct, visible value label —
 * never colour alone"). Not a port of `format_money`/`formatReportDuration`
 * (a chart series can read any numeric column, not just one `kind`); this
 * is deliberately simpler than the grid's own per-`kind` cell formatting. */
export function formatReportChartValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

/** Fixed Tailwind-class fallback for a category whose column isn't
 * `enum`-kind (so there is no grid status badge to reuse a colour from) —
 * existing design tokens, reused in a fixed order, never a freshly
 * generated hue (dataviz house style). Cycles only past `brand`/`pass`/
 * `attn`/`fail`/`idle`'s own five slots, which no ms-2 report's chart
 * comes close to exercising. */
const REPORT_CHART_CATEGORICAL_FALLBACK = ['bg-brand', 'bg-pass', 'bg-attn', 'bg-fail', 'bg-idle'] as const

/** `reportEnumBadgeVariant`'s own four variants, mapped to the matching
 * solid-fill Tailwind class — `bg-pass`/`bg-attn`/`bg-fail`/`bg-idle`
 * resolve their `background-color` against the exact same `--pass`/
 * `--attn`/`--fail`/`--idle` custom properties the grid's own `<Badge
 * variant="success">`/etc. resolve their `color` against (`badge.tsx`'s
 * `text-pass`/`text-attn`/`text-fail`), so the two elements' computed
 * colours are byte-identical strings in the DOM — never merely "the same
 * intended colour", literally the same resolved value. */
const REPORT_CHART_BADGE_FILL_CLASS: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-brand',
  secondary: 'bg-brand',
  outline: 'bg-idle',
  success: 'bg-pass',
  warning: 'bg-attn',
  destructive: 'bg-fail',
}

/**
 * The Tailwind class a chart mark for `category` (at position `index` among
 * `categories`) should carry, given the axis column's own `kind`
 * (`categoryColumnKind` from a `ReportChartRenderPlan`).
 *
 * Contract §8b: category colours are the same status colours the grid's
 * own badges already use for the identical semantic value — never a
 * freshly generated categorical hue for a value that is really a status.
 * That only applies when the axis column IS the grid's `enum`-kind status
 * column (the one the grid itself renders through `<Badge
 * variant={reportEnumBadgeVariant(...)}>`); for any other column kind there
 * is no badge to reuse, so this falls back to a plain fixed-order
 * categorical palette instead.
 */
export function reportChartCategoryColorClass(category: string, categoryColumnKind: string, index: number): string {
  if (categoryColumnKind === 'enum') {
    return REPORT_CHART_BADGE_FILL_CLASS[reportEnumBadgeVariant(category) ?? 'outline']
  }
  return REPORT_CHART_CATEGORICAL_FALLBACK[index % REPORT_CHART_CATEGORICAL_FALLBACK.length]
}

/**
 * The chart region's full-text `aria-label` (contract §8a: "a full-text
 * `aria-label` summarizing every category and value" — the accessibility
 * fallback for a hand-drawn chart with no native table semantics). Every
 * category's own name is followed by its value(s) with plain whitespace
 * between them (never glued, same reasoning as the grid's own per-cell
 * trailing-space convention) so a screen reader — and a test's regex —
 * reads each category/value pair distinctly.
 */
export function buildReportChartAriaLabel(plan: ReportChartRenderPlan): string {
  const multi = plan.series.length > 1
  const parts = plan.categories.map((category, i) => {
    const values = plan.series
      .map((s) => `${multi ? `${s.label} ` : ''}${formatReportChartValue(s.data[i] ?? 0)}`)
      .join(', ')
    return `${category} ${values}`
  })
  const heading = plan.title || `${plan.series.length === 1 ? plan.series[0].label : 'Values'} by ${plan.xLabel ?? 'category'}`
  return `${heading}: ${parts.join(', ')}`
}
