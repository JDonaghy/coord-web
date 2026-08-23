/**
 * ReportsPanel — the Reports panel's list-slot content (#21 RPT-2, #22 RPT-3).
 *
 * `ShellLayout` owns the frame (rail, status bar) and renders this component
 * into the list slot for the `/reports` route, same convention
 * `DriveQueuePanel` documents for `/queue`.
 *
 * A tabbed **picker** built from `GET /api/report`'s catalogue (never a
 * hardcoded report list — see `src/lib/reports.ts`'s doc comment), a
 * **parameter bar** dispatching each catalogue param to a `<select>`
 * (`kind: 'choice'`) or text `<input>` (everything else), a **Run** action
 * that fetches `GET /api/report/{id}` on demand (deliberately not a
 * `useQuery` — running a report is a user action, not a subscribed
 * resource, same posture `pipelineAction`/`driveQueueAction` already take
 * for a POST-shaped mutation), and a **grid** keyed on each result's
 * `ColumnMeta.kind` for cell formatting (`reportCellText` in
 * `src/lib/reports.ts`, a port of `reports_cell_text` /
 * `tui/src/app/reports.rs`) with client-side header-click sort.
 *
 * #21 (RPT-2) proved this pipe end-to-end against exactly one report
 * (`drive-queue-status`); the picker/param-bar/grid above are entirely
 * catalogue-driven, so #22 (RPT-3) lighting up the other five
 * (`issue-activity`, `completed`, `decisions`, `usage`, `queue-outcomes`)
 * needed no new rendering code here beyond one thing the abstraction hadn't
 * yet exercised: a `list`-kind column whose cells are `{label,
 * command_or_action, recommended}` dicts rather than scalars (`decisions`'
 * `options` column). `reportListOptions` in `src/lib/reports.ts` detects
 * that shape structurally — off the cell VALUE, never the report id or
 * column id — so the branch below applies to any future dict-shaped `list`
 * column too, not just this one.
 *
 * #24 (RPT-5) adds `reports-export-action`: disabled-with-tooltip until a
 * report has run this session (same posture `reports_export_action`/
 * `DriveQueuePanel`'s row-action guards already use), then a real `<a
 * download>` hitting `GET /api/report/{id}?...&format=csv` directly —
 * code-coordinator#2492's server sets `Content-Disposition`, so there is
 * deliberately no client-side CSV generation here (contract.md §5c). The
 * href is built from the *params the running report actually used*
 * (`exportParams`, captured at the moment `handleRun` resolves), not
 * whatever is currently sitting in the param inputs — otherwise editing a
 * param after a run without re-running would silently export a result the
 * grid never actually showed.
 *
 * #23 (RPT-4) adds row navigation: on a `row_identity`-declaring report
 * (`issue-activity`, `completed`, `decisions` today — contract §7a), the
 * identifying cell (the column named by `RowIdentity.issue_column`) renders
 * as a `<Link to={paths.pipelineItem(repo, issue)}>` plus the same
 * secondary open-in-new-tab `<a target="_blank">` affordance
 * `DriveQueuePanel`'s own Issue column already uses (#9) — `reports.ts`'s
 * `isReportRowIdentityColumn`/`reportRowIdentityKey`/
 * `reportRowIdentityRepoIssue` do the (structural, catalogue-driven, never
 * report-id-keyed) detection and composition. A report with no
 * `row_identity` (§7c — `usage`, `queue-outcomes`, and, per §7.1,
 * `drive-queue-status` today) renders every cell exactly as before.
 *
 * Explicitly out of scope here (each is its own later RPT-N issue, see
 * `tests/acceptance/ms-2/contract.md`'s issue table):
 *  - Chart rendering (RPT-6, #25) — no `chart` region; `ReportResult.chart`
 *    is read by nothing here, matching the "additive, ignorable" contract
 *    `ChartSpec`'s own doc comment states for a client that doesn't render it.
 */
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

import { fetchReport, fetchReportCatalogue, type ReportDef, type ReportResult } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { PanelHeader } from '@/components/PanelHeader'
import { toast } from '@/components/ui/use-toast'
import { paths } from '@/routes/paths'
import { cn } from '@/lib/utils'
import {
  buildReportParamDefaults,
  defaultSelectedReportId,
  isReportRowIdentityColumn,
  reportCellAlign,
  reportCellIsMono,
  reportCellText,
  reportChoiceOptions,
  reportEnumBadgeVariant,
  reportListOptions,
  reportParamIsChoice,
  reportRowCountLabel,
  reportRowIdentityFor,
  reportRowIdentityKey,
  reportRowIdentityRepoIssue,
  sortReportRows,
  toggleSortDirection,
  type SortDirection,
} from '@/lib/reports'

interface SortState {
  columnId: string
  direction: SortDirection
}

/**
 * `GET /api/report/{id}` (`fetchReport`'s own route, `src/api/client.ts`)
 * with `format=csv` appended — never a separate base path, and never a
 * `fetch()`/blob/`URL.createObjectURL` construction (contract §5c: a plain
 * same-origin `<a download>` navigation, server-rendered file). Mirrors
 * `fetchReport`'s own query-building rule: an empty/absent param value is
 * omitted so the server falls back to that param's own default.
 */
function reportExportHref(reportId: string, params: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  query.set('format', 'csv')
  return `/api/report/${encodeURIComponent(reportId)}?${query.toString()}`
}

export default function ReportsPanel() {
  const {
    data: catalogue,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['report-catalogue'],
    queryFn: fetchReportCatalogue,
  })
  const reports = useMemo<ReportDef[]>(() => catalogue?.reports ?? [], [catalogue])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ReportResult | null>(null)
  const [hasRun, setHasRun] = useState(false)
  const [running, setRunning] = useState(false)
  const [sort, setSort] = useState<SortState | null>(null)
  // The param values a successful run actually used (#24 RPT-5) -- distinct
  // from the live `paramValues` state, which the user may keep editing
  // after a run without hitting Run report again. The export link must
  // always match what the grid is currently showing, not the param bar's
  // current (possibly since-edited) contents.
  const [exportParams, setExportParams] = useState<Record<string, string> | null>(null)

  // Staleness guard for `handleRun` below: a monotonically-increasing token,
  // bumped on every run *and* every tab switch. A resolved `fetchReport`
  // promise only commits to state if this ref still holds the token it was
  // issued -- otherwise the user has since switched tabs (or fired another
  // run) and the response belongs to a report that's no longer selected.
  // Plain `useRef`, not a second render-triggering `useState`: nothing here
  // needs to be painted, it only needs to be read synchronously inside the
  // async continuation below.
  const runTokenRef = useRef(0)

  // Cold-load selection (contract §3c: drive-queue-status pre-selected) —
  // deferred until the catalogue actually arrives, since there's nothing to
  // select before then.
  useEffect(() => {
    if (selectedId !== null || reports.length === 0) return
    const id = defaultSelectedReportId(reports)
    if (!id) return
    setSelectedId(id)
    const report = reports.find((r) => r.id === id)
    setParamValues(report ? buildReportParamDefaults(report.params) : {})
  }, [reports, selectedId])

  const selectedReport = reports.find((r) => r.id === selectedId) ?? null

  const handleSelectTab = (report: ReportDef) => {
    // Bump the run token first: any run still in flight for the *previous*
    // selection is now stale and must not land on this tab's state when it
    // resolves (review finding: switching tabs mid-run silently overwrote
    // the grid with the abandoned report's data).
    runTokenRef.current += 1
    setSelectedId(report.id)
    setParamValues(buildReportParamDefaults(report.params))
    setResult(null)
    setHasRun(false)
    setSort(null)
    setRunning(false)
    setExportParams(null)
  }

  const handleParamChange = (paramId: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [paramId]: value }))
  }

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedReport || running) return
    const reportId = selectedReport.id
    const runToken = ++runTokenRef.current
    setRunning(true)
    try {
      const next = await fetchReport(reportId, paramValues)
      // Staleness guard: if the tablist has moved on (or another run started)
      // since this request went out, drop the response on the floor rather
      // than painting it under whatever tab is now selected.
      if (runTokenRef.current !== runToken) return
      setResult(next)
      setHasRun(true)
      setExportParams({ ...paramValues })
      setSort(next.column_meta[0] ? { columnId: next.column_meta[0].id, direction: 'ascending' } : null)
    } catch (e) {
      if (runTokenRef.current !== runToken) return
      toast({
        variant: 'destructive',
        title: 'Report run failed',
        description: e instanceof Error ? e.message : reportId,
      })
    } finally {
      if (runTokenRef.current === runToken) setRunning(false)
    }
  }

  // #23 RPT-4 — the RowIdentity of the report `result` came from, looked up
  // by `result.report_id` rather than trusting `selectedReport` (which can
  // momentarily lag a just-landed result during the tab-switch race
  // `runTokenRef` guards above). `null` for most reports (contract §7c).
  const rowIdentity = useMemo(
    () => (result ? reportRowIdentityFor(reports, result.report_id) : null),
    [result, reports],
  )

  const sortedRows = useMemo(() => {
    if (!result) return []
    if (!sort) return result.rows
    const meta = result.column_meta.find((m) => m.id === sort.columnId)
    if (!meta) return result.rows
    return sortReportRows(result.rows, sort.columnId, meta.kind, sort.direction)
  }, [result, sort])

  const handleHeaderClick = (columnId: string) => {
    setSort((prev) =>
      prev && prev.columnId === columnId
        ? { columnId, direction: toggleSortDirection(prev.direction) }
        : { columnId, direction: 'ascending' },
    )
  }

  return (
    <div className="mx-auto w-full px-4 py-4">
      <PanelHeader title="Reports">
        {/* No count element until a report has actually been run this
            session — contract §2b. */}
        {hasRun && (
          <span data-testid="reports-header-count" className="font-mono text-[.75rem] text-faint">
            {reportRowCountLabel(sortedRows.length)}
          </span>
        )}
      </PanelHeader>

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading reports…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load the report catalogue</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div
            role="tablist"
            aria-label="Reports catalogue"
            data-testid="reports-tablist"
            className="mb-2.5 flex flex-wrap gap-1.5"
          >
            {reports.map((report) => {
              const selected = report.id === selectedId
              return (
                <button
                  key={report.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`reports-tab-${report.id}`}
                  onClick={() => handleSelectTab(report)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium',
                    selected
                      ? 'border-transparent bg-brand font-semibold text-[#08161a]'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {report.title}
                </button>
              )
            })}
          </div>

          {selectedReport && (
            <>
              <p data-testid="reports-description" className="mb-3.5 text-xs text-muted-foreground">
                {selectedReport.description}
              </p>

              <form
                aria-label="Report parameters"
                data-testid="reports-param-bar"
                onSubmit={(e) => void handleRun(e)}
                className="mb-4 flex flex-wrap items-end gap-3"
              >
                {selectedReport.params.map((param) => {
                  const fieldId = `reports-param-${param.id}`
                  const value = paramValues[param.id] ?? ''
                  return (
                    <div key={param.id} className="flex flex-col gap-1">
                      <label htmlFor={fieldId} className="text-[.7rem] text-faint">
                        {param.label}
                      </label>
                      {reportParamIsChoice(param) ? (
                        <select
                          id={fieldId}
                          data-testid={fieldId}
                          value={value}
                          onChange={(e) => handleParamChange(param.id, e.target.value)}
                          className="min-w-[140px] rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground"
                        >
                          {reportChoiceOptions(param).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={fieldId}
                          data-testid={fieldId}
                          type="text"
                          value={value}
                          onChange={(e) => handleParamChange(param.id, e.target.value)}
                          placeholder={param.help}
                          className="min-w-[140px] rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground"
                        />
                      )}
                    </div>
                  )
                })}
                <button
                  type="submit"
                  data-testid="reports-run-button"
                  disabled={running}
                  className="rounded-md bg-brand px-3.5 py-1.5 text-xs font-semibold text-[#08161a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Run report
                </button>
                {/* #24 RPT-5: disabled-with-tooltip until a report has run
                    this session, same posture DriveQueuePanel's row-action
                    guards use, then a real download link -- never a second
                    interactive element swapped for a different one, an `<a>`
                    replacing a `<button>` under the same data-testid and
                    accessible name (contract §5a/§5b). */}
                {hasRun && result && exportParams ? (
                  <a
                    href={reportExportHref(selectedReport.id, exportParams)}
                    download
                    data-testid="reports-export-action"
                    aria-label="Export CSV"
                    className="rounded-md border border-border px-3.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"
                  >
                    Export CSV
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    data-testid="reports-export-action"
                    aria-label="Export CSV"
                    title="Run a report to enable CSV export"
                    className="rounded-md border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Export CSV
                  </button>
                )}
              </form>
            </>
          )}

          {hasRun && result ? (
            sortedRows.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table
                  data-testid="reports-grid"
                  className="w-full min-w-[720px] border-collapse text-left text-xs"
                >
                  <thead>
                    <tr className="border-b border-border bg-secondary/40 text-muted-foreground">
                      {result.column_meta.map((meta) => {
                        const active = sort?.columnId === meta.id
                        const align = reportCellAlign(meta)
                        return (
                          <th
                            key={meta.id}
                            scope="col"
                            data-testid={`reports-col-${meta.id}`}
                            aria-sort={active ? sort.direction : undefined}
                            onClick={() => handleHeaderClick(meta.id)}
                            className={cn(
                              'cursor-pointer select-none px-3 py-2 font-medium',
                              align === 'right' && 'text-right',
                            )}
                          >
                            {meta.label}
                            {active && (
                              <span aria-hidden="true"> {sort.direction === 'ascending' ? '▲' : '▼'}</span>
                            )}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, index) => (
                      <tr key={index} className="border-b border-border/60 last:border-0">
                        {result.column_meta.map((meta) => {
                          const align = reportCellAlign(meta)
                          const cellValue = row[meta.id]
                          // Structural, not report-id-keyed: any `list`-kind
                          // cell whose items are `{label, ...}` dicts (§6d —
                          // `decisions`' `options` column is the one this
                          // milestone ships) renders as its own option list
                          // instead of falling through to the plain-text/
                          // comma-join path every other `list` column uses.
                          const options = meta.kind === 'list' ? reportListOptions(cellValue) : null
                          const text = reportCellText(cellValue, meta.kind)
                          // #23 RPT-4 — this report's identifying cell (the
                          // one column `RowIdentity.issue_column` names, §7b)
                          // renders as a Link + open-in-new-tab affordance
                          // instead of plain text. `null` on every other
                          // column, and on every column of a report with no
                          // `row_identity` at all (§7c).
                          const isIdentityCell = isReportRowIdentityColumn(meta.id, rowIdentity)
                          const identityKey =
                            isIdentityCell && rowIdentity ? reportRowIdentityKey(row, rowIdentity) : null
                          const identityRepoIssue =
                            isIdentityCell && rowIdentity
                              ? reportRowIdentityRepoIssue(row, rowIdentity)
                              : null
                          return (
                            <td
                              key={meta.id}
                              data-testid={options ? `reports-options-cell-${index}` : undefined}
                              className={cn(
                                'px-3 py-2',
                                align === 'right' && 'text-right',
                                (reportCellIsMono(meta.kind) || isIdentityCell) && !options && 'font-mono',
                              )}
                            >
                              {identityKey && identityRepoIssue ? (
                                <div className="flex items-center gap-1">
                                  <Link
                                    to={paths.pipelineItem(identityRepoIssue.repo, identityRepoIssue.issue)}
                                    className="hover:underline"
                                  >
                                    {identityKey}
                                  </Link>
                                  <a
                                    href={paths.pipelineItem(identityRepoIssue.repo, identityRepoIssue.issue)}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`Open ${identityKey} in a new tab`}
                                    title="Open in new tab"
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                  </a>
                                </div>
                              ) : options ? (
                                <ul className="flex flex-col gap-1">
                                  {options.map((opt, optIndex) => (
                                    <li
                                      key={optIndex}
                                      title={opt.command_or_action}
                                      className="inline-flex items-center gap-1"
                                    >
                                      {opt.label}
                                      {opt.recommended && (
                                        <>
                                          <span aria-hidden="true" className="text-attn">
                                            ★
                                          </span>
                                          <span className="sr-only">(recommended)</span>
                                        </>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              ) : meta.kind === 'enum' ? (
                                <Badge variant={reportEnumBadgeVariant(String(row[meta.id] ?? ''))}>
                                  {text}
                                </Badge>
                              ) : (
                                text
                              )}
                              {/* A trailing space text node — `<td>`s render with
                                  no inherent whitespace between them (raw DOM
                                  `textContent`, unlike layout-aware `innerText`),
                                  so two adjacent cells' text can glue together
                                  word-boundary-defeating-ly (`"...12m" +
                                  "2026-08-20..."` reads as one token to a `\b`
                                  regex). A trailing space per cell is invisible
                                  (every text assertion here normalizes
                                  whitespace) and keeps every cell a distinct
                                  word for a caller matching across the row. */}
                              {' '}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-14 text-center text-sm text-muted-foreground">
                <p>No rows for this report and parameter set.</p>
              </div>
            )
          ) : (
            <div
              data-testid="reports-empty-state"
              className="py-14 text-center text-sm text-muted-foreground"
            >
              <p>Run a report to see results.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
