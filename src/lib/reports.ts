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
import type { ColumnMeta, ReportDef, ReportParam, RowIdentity } from '@/api/client'
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
