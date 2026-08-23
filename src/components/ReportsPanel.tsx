/**
 * ReportsPanel — the Reports panel's list-slot content (#21 RPT-2).
 *
 * `ShellLayout` owns the frame (rail, status bar) and renders this component
 * into the list slot for the `/reports` route, same convention
 * `DriveQueuePanel` documents for `/queue`.
 *
 * Ships the whole pipe against exactly one report — `drive-queue-status` —
 * to prove it end-to-end before RPT-3 lights up the other five
 * (`issue-activity`, `completed`, `decisions`, `usage`, `queue-outcomes`):
 * a tabbed **picker** built from `GET /api/report`'s catalogue (never a
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
 * Explicitly out of scope here (each is its own later RPT-N issue, see
 * `tests/acceptance/ms-2/contract.md`'s issue table):
 *  - Row navigation via `row_identity` (RPT-4, #23) — `drive-queue-status`
 *    itself declares none (contract §7.1), so every cell here is plain text.
 *  - CSV export (RPT-5, #24) — no `reports-export-action` control yet.
 *  - Chart rendering (RPT-6, #25) — no `chart` region; `ReportResult.chart`
 *    is read by nothing here, matching the "additive, ignorable" contract
 *    `ChartSpec`'s own doc comment states for a client that doesn't render it.
 */
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { fetchReport, fetchReportCatalogue, type ReportDef, type ReportResult } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
  buildReportParamDefaults,
  defaultSelectedReportId,
  reportCellAlign,
  reportCellIsMono,
  reportCellText,
  reportChoiceOptions,
  reportEnumBadgeVariant,
  reportParamIsChoice,
  reportRowCountLabel,
  sortReportRows,
  toggleSortDirection,
  type SortDirection,
} from '@/lib/reports'

interface SortState {
  columnId: string
  direction: SortDirection
}

export default function ReportsPanel() {
  const { data: catalogue } = useQuery({
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
    setSelectedId(report.id)
    setParamValues(buildReportParamDefaults(report.params))
    setResult(null)
    setHasRun(false)
    setSort(null)
  }

  const handleParamChange = (paramId: string, value: string) => {
    setParamValues((prev) => ({ ...prev, [paramId]: value }))
  }

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedReport || running) return
    setRunning(true)
    try {
      const next = await fetchReport(selectedReport.id, paramValues)
      setResult(next)
      setHasRun(true)
      setSort(next.column_meta[0] ? { columnId: next.column_meta[0].id, direction: 'ascending' } : null)
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Report run failed',
        description: e instanceof Error ? e.message : selectedReport.id,
      })
    } finally {
      setRunning(false)
    }
  }

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
      <header className="mb-4 flex items-center gap-2.5">
        <h1 className="text-step-1 font-semibold tracking-[-.01em] text-foreground">Reports</h1>
        {/* No count element until a report has actually been run this
            session — contract §2b. */}
        {hasRun && (
          <span data-testid="reports-header-count" className="font-mono text-[.75rem] text-faint">
            {reportRowCountLabel(sortedRows.length)}
          </span>
        )}
      </header>

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
          </form>
        </>
      )}

      {hasRun && result ? (
        sortedRows.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table data-testid="reports-grid" className="w-full min-w-[720px] border-collapse text-left text-xs">
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
                      const text = reportCellText(row[meta.id], meta.kind)
                      return (
                        <td
                          key={meta.id}
                          className={cn(
                            'px-3 py-2',
                            align === 'right' && 'text-right',
                            reportCellIsMono(meta.kind) && 'font-mono',
                          )}
                        >
                          {meta.kind === 'enum' ? (
                            <Badge variant={reportEnumBadgeVariant(String(row[meta.id] ?? ''))}>{text}</Badge>
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
        <div data-testid="reports-empty-state" className="py-14 text-center text-sm text-muted-foreground">
          <p>Run a report to see results.</p>
        </div>
      )}
    </div>
  )
}
