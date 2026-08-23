/**
 * Unit tests for `src/lib/reports.ts` (#21 RPT-2).
 *
 * Cell-formatting cases cite `tests/acceptance/ms-2/contract.md` §6b's exact
 * rendering rules and, where numeric, `fixtures/reports-ms2.json`'s own
 * seeded values (`age: 11520` -> `"3h 12m"`, etc.) so a future reader can
 * diff this file against that fixture directly rather than trusting a
 * hand-picked example. The param-form and sort cases cover the two other
 * pure surfaces `ReportsPanel` builds its picker/parameter-bar/grid from.
 */
import { describe, it, expect } from 'vitest'
import type { ColumnMeta, ReportParam, ReportResult } from '@/api/client'
import {
  buildReportChartAriaLabel,
  buildReportParamDefaults,
  DEFAULT_REPORT_ID,
  defaultSelectedReportId,
  formatReportChartValue,
  formatReportDuration,
  formatReportList,
  formatReportMoney,
  formatReportTimestamp,
  reportCellAlign,
  reportCellIsMono,
  reportCellText,
  reportChartCategoryColorClass,
  reportChartPlan,
  reportChoiceOptions,
  reportEnumBadgeVariant,
  reportListOptions,
  reportParamIsChoice,
  reportRowCountLabel,
  REPORT_EMPTY_CELL,
  type ReportChartRenderPlan,
  sortReportRows,
  toggleSortDirection,
} from '../reports'

// ── formatReportDuration (§6b duration) ─────────────────────────────────────

describe('formatReportDuration', () => {
  it('11520s (fixture row 1 age) -> "3h 12m"', () => {
    expect(formatReportDuration(11520)).toBe('3h 12m')
  })

  it('100800s (fixture row 2 age) -> "1d 4h"', () => {
    expect(formatReportDuration(100800)).toBe('1d 4h')
  })

  it('720s (fixture row 3 age) -> "12m", not "0h 12m"', () => {
    expect(formatReportDuration(720)).toBe('12m')
  })

  it('under a minute -> seconds', () => {
    expect(formatReportDuration(45)).toBe('45s')
  })

  it('clamps a negative span to zero rather than a negative string', () => {
    expect(formatReportDuration(-5)).toBe('0s')
  })
})

// ── formatReportTimestamp (§6b timestamp shape) ─────────────────────────────

describe('formatReportTimestamp', () => {
  it('matches the pinned YYYY-MM-DD HH:MM shape', () => {
    expect(formatReportTimestamp(1787211060)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('zero-pads single-digit month/day/hour/minute', () => {
    // 2024-01-02T03:04:00Z in UTC -- asserted loosely (local-tz dependent)
    // via the shape only, same posture the acceptance spec itself takes.
    const text = formatReportTimestamp(1704164640)
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(text).not.toMatch(/-\d-|:\d$/)
  })
})

// ── formatReportMoney (§6b money) ────────────────────────────────────────────

describe('formatReportMoney', () => {
  it('a literal zero renders as an em-dash, never $0.0000', () => {
    expect(formatReportMoney(0)).toBe(REPORT_EMPTY_CELL)
  })

  it('null/undefined also render as the empty cell', () => {
    expect(formatReportMoney(null)).toBe(REPORT_EMPTY_CELL)
    expect(formatReportMoney(undefined)).toBe(REPORT_EMPTY_CELL)
  })

  it('formats to 4 decimal places', () => {
    expect(formatReportMoney(4.821)).toBe('$4.8210')
    expect(formatReportMoney(1)).toBe('$1.0000')
  })
})

// ── formatReportList (§6b list) ──────────────────────────────────────────────

describe('formatReportList', () => {
  it('empty array -> the empty cell', () => {
    expect(formatReportList([])).toBe(REPORT_EMPTY_CELL)
  })

  it('comma-joins entries (fixture row 3 after)', () => {
    expect(formatReportList(['api#42', 'api#40'])).toBe('api#42, api#40')
  })

  it('null/undefined -> the empty cell', () => {
    expect(formatReportList(null)).toBe(REPORT_EMPTY_CELL)
    expect(formatReportList(undefined)).toBe(REPORT_EMPTY_CELL)
  })

  it('a decisions-shaped options list joins on each option\'s label, never [object Object]', () => {
    expect(
      formatReportList([
        { label: 'Release gate', command_or_action: 'coord drive release --issue 40', recommended: true },
        { label: 'Extend hold', command_or_action: 'coord drive hold --issue 40 --extend 1h', recommended: false },
      ]),
    ).toBe('Release gate, Extend hold')
  })
})

// ── reportListOptions (§6d — decisions' options column) ──────────────────────

describe('reportListOptions', () => {
  it('detects a list of {label, command_or_action, recommended} dicts', () => {
    const value = [
      { label: 'Release gate', command_or_action: 'coord drive release --issue 40', recommended: true },
      { label: 'Extend hold', command_or_action: 'coord drive hold --issue 40 --extend 1h', recommended: false },
    ]
    expect(reportListOptions(value)).toEqual([
      { label: 'Release gate', command_or_action: 'coord drive release --issue 40', recommended: true },
      { label: 'Extend hold', command_or_action: 'coord drive hold --issue 40 --extend 1h', recommended: false },
    ])
  })

  it('defaults a missing/non-boolean recommended to false rather than throwing', () => {
    expect(reportListOptions([{ label: 'Retry' }])).toEqual([
      { label: 'Retry', command_or_action: undefined, recommended: false },
    ])
  })

  it('a plain scalar list (e.g. drive-queue-status\'s "after") is not options', () => {
    expect(reportListOptions(['api#42', 'api#40'])).toBeNull()
  })

  it('empty array, null, and non-array values are not options', () => {
    expect(reportListOptions([])).toBeNull()
    expect(reportListOptions(null)).toBeNull()
    expect(reportListOptions(undefined)).toBeNull()
    expect(reportListOptions('api#42')).toBeNull()
  })

  it('a mixed array (not every item shaped like an option) is not options', () => {
    expect(reportListOptions(['api#42', { label: 'Retry' }])).toBeNull()
  })
})

// ── reportCellText dispatcher (§6b, the full kind list) ──────────────────────

describe('reportCellText', () => {
  it('text: plain stringification, empty/null -> empty cell', () => {
    expect(reportCellText('Fix the dashboard rendering', 'text')).toBe('Fix the dashboard rendering')
    expect(reportCellText(null, 'text')).toBe(REPORT_EMPTY_CELL)
    expect(reportCellText('', 'text')).toBe(REPORT_EMPTY_CELL)
  })

  it('int: truncates and stringifies, null -> empty cell', () => {
    expect(reportCellText(1, 'int')).toBe('1')
    expect(reportCellText(3.9, 'int')).toBe('3')
    expect(reportCellText(null, 'int')).toBe(REPORT_EMPTY_CELL)
  })

  it('enum: raw value passed through as text (the badge wrap is the caller\'s job)', () => {
    expect(reportCellText('running', 'enum')).toBe('running')
  })

  it('duration: delegates to formatReportDuration', () => {
    expect(reportCellText(11520, 'duration')).toBe('3h 12m')
  })

  it('timestamp: delegates to formatReportTimestamp', () => {
    expect(reportCellText(1787211060, 'timestamp')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('list: delegates to formatReportList', () => {
    expect(reportCellText([], 'list')).toBe(REPORT_EMPTY_CELL)
    expect(reportCellText(['api#42', 'api#40'], 'list')).toBe('api#42, api#40')
  })

  it('money: delegates to formatReportMoney', () => {
    expect(reportCellText(0, 'money')).toBe(REPORT_EMPTY_CELL)
    expect(reportCellText(4.821, 'money')).toBe('$4.8210')
  })

  it('money: a missing cell value renders the empty cell, not "$NaN.0000"', () => {
    // Regression: `Number(undefined)` is `NaN`, which `formatReportMoney`
    // doesn't special-case (only a literal `0` or `null`/`undefined` are
    // "empty" there) -- the dispatcher itself must catch a missing value
    // before it ever reaches that coercion.
    expect(reportCellText(undefined, 'money')).toBe(REPORT_EMPTY_CELL)
    expect(reportCellText(null, 'money')).toBe(REPORT_EMPTY_CELL)
  })

  it('an unrecognised kind falls back to plain stringification rather than throwing', () => {
    expect(reportCellText('mystery', 'future-kind')).toBe('mystery')
  })
})

// ── alignment / mono hints ───────────────────────────────────────────────────

describe('reportCellIsMono', () => {
  it('every kind except text and enum is mono', () => {
    expect(reportCellIsMono('text')).toBe(false)
    expect(reportCellIsMono('enum')).toBe(false)
    expect(reportCellIsMono('int')).toBe(true)
    expect(reportCellIsMono('timestamp')).toBe(true)
    expect(reportCellIsMono('duration')).toBe(true)
    expect(reportCellIsMono('list')).toBe(true)
    expect(reportCellIsMono('money')).toBe(true)
  })
})

describe('reportCellAlign', () => {
  it('an explicit ColumnMeta.align wins over the kind default', () => {
    expect(reportCellAlign({ kind: 'text', align: 'right' })).toBe('right')
    expect(reportCellAlign({ kind: 'int', align: 'left' })).toBe('left')
  })

  it('falls back to right for int/money and left for everything else', () => {
    expect(reportCellAlign({ kind: 'int', align: '' })).toBe('right')
    expect(reportCellAlign({ kind: 'money', align: '' })).toBe('right')
    expect(reportCellAlign({ kind: 'text', align: '' })).toBe('left')
    expect(reportCellAlign({ kind: 'enum', align: '' })).toBe('left')
  })
})

describe('reportEnumBadgeVariant', () => {
  it('maps known states to their Badge variant', () => {
    expect(reportEnumBadgeVariant('running')).toBe('success')
    expect(reportEnumBadgeVariant('blocked')).toBe('destructive')
    expect(reportEnumBadgeVariant('held')).toBe('warning')
  })

  it('an unrecognised value renders outline rather than reading as healthy', () => {
    expect(reportEnumBadgeVariant('waiting')).toBe('outline')
    expect(reportEnumBadgeVariant('some-future-state')).toBe('outline')
  })
})

// ── parameter form (contract §4) ─────────────────────────────────────────────

function makeParam(overrides: Partial<ReportParam> = {}): ReportParam {
  return {
    id: 'repo',
    label: 'Repo',
    kind: 'text',
    choices: [],
    default: '',
    help: '',
    free_form: false,
    ...overrides,
  }
}

describe('reportParamIsChoice', () => {
  it('kind "choice" -> true, anything else -> false', () => {
    expect(reportParamIsChoice(makeParam({ kind: 'choice' }))).toBe(true)
    expect(reportParamIsChoice(makeParam({ kind: 'text' }))).toBe(false)
    expect(reportParamIsChoice(makeParam({ kind: 'future-kind' }))).toBe(false)
  })
})

describe('buildReportParamDefaults', () => {
  it('reads ReportParam.default verbatim, keyed by id', () => {
    const params = [
      makeParam({ id: 'repo', kind: 'choice', choices: ['', 'api', 'coord-web'], default: '' }),
      makeParam({ id: 'search', kind: 'text', default: 'urgent' }),
    ]
    expect(buildReportParamDefaults(params)).toEqual({ repo: '', search: 'urgent' })
  })

  it('an empty param list -> an empty object', () => {
    expect(buildReportParamDefaults([])).toEqual({})
  })
})

describe('reportChoiceOptions', () => {
  it('labels the empty choice "All repos" rather than rendering it blank', () => {
    expect(reportChoiceOptions({ choices: ['', 'api', 'coord-web'] })).toEqual([
      { value: '', label: 'All repos' },
      { value: 'api', label: 'api' },
      { value: 'coord-web', label: 'coord-web' },
    ])
  })
})

// ── picker default selection (contract §3c) ──────────────────────────────────

describe('defaultSelectedReportId', () => {
  it('prefers drive-queue-status when the catalogue has it, regardless of position', () => {
    const reports = [
      { id: 'completed', title: 'Completed', description: '', params: [], row_identity: null },
      { id: DEFAULT_REPORT_ID, title: 'Drive queue status', description: '', params: [], row_identity: null },
    ]
    expect(defaultSelectedReportId(reports)).toBe(DEFAULT_REPORT_ID)
  })

  it('falls back to the first entry when drive-queue-status is absent', () => {
    const reports = [
      { id: 'usage', title: 'Usage', description: '', params: [], row_identity: null },
      { id: 'completed', title: 'Completed', description: '', params: [], row_identity: null },
    ]
    expect(defaultSelectedReportId(reports)).toBe('usage')
  })

  it('an empty catalogue -> null', () => {
    expect(defaultSelectedReportId([])).toBeNull()
  })
})

// ── header count (contract §2c) ──────────────────────────────────────────────

describe('reportRowCountLabel', () => {
  it('singularises exactly at 1', () => {
    expect(reportRowCountLabel(1)).toBe('1 row')
  })

  it('pluralises everywhere else, including zero', () => {
    expect(reportRowCountLabel(0)).toBe('0 rows')
    expect(reportRowCountLabel(3)).toBe('3 rows')
  })
})

// ── client-side sort (contract §6c) ──────────────────────────────────────────

describe('toggleSortDirection', () => {
  it('flips ascending <-> descending', () => {
    expect(toggleSortDirection('ascending')).toBe('descending')
    expect(toggleSortDirection('descending')).toBe('ascending')
  })
})

describe('sortReportRows', () => {
  const positionMeta: Pick<ColumnMeta, 'id' | 'kind'> = { id: 'position', kind: 'int' }
  const rows = [
    { position: 1, issue: 'api#42' },
    { position: 2, issue: 'api#40' },
    { position: 3, issue: 'coord-web#9' },
  ]

  it('sorts numeric kinds ascending by raw value', () => {
    const sorted = sortReportRows(rows, positionMeta.id, positionMeta.kind, 'ascending')
    expect(sorted.map((r) => r.issue)).toEqual(['api#42', 'api#40', 'coord-web#9'])
  })

  it('descending reverses the order', () => {
    const sorted = sortReportRows(rows, positionMeta.id, positionMeta.kind, 'descending')
    expect(sorted.map((r) => r.issue)).toEqual(['coord-web#9', 'api#40', 'api#42'])
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortReportRows(rows, positionMeta.id, positionMeta.kind, 'descending')
    expect(rows).toEqual(copy)
  })

  it('sorts non-numeric kinds lexicographically on their rendered cell text', () => {
    const textRows = [{ state: 'waiting' }, { state: 'blocked' }, { state: 'running' }]
    const sorted = sortReportRows(textRows, 'state', 'enum', 'ascending')
    expect(sorted.map((r) => r.state)).toEqual(['blocked', 'running', 'waiting'])
  })
})

// ── chart rendering (contract §8, RPT-6 #25) ────────────────────────────────
//
// `reportChartPlan` is the port of `ChartPlan`/`reports_chart_plan` from
// `tui/src/app/reports.rs` — these cases mirror the Rust source's own
// outcome order (unsupported kind, no numeric series, too many series,
// group_by pivot) plus the two ms-2 fixture shapes this milestone's own
// acceptance slice (`tests/acceptance/ms-2/rpt-6-chart.spec.ts`) drives
// against a live `coord web --fixture` process:
// `fixtures/reports-ms2.json`'s `queue-outcomes` (Render: `kind: 'bar'`, one
// series reading `count`, `x: 'outcome'`) and `usage` (Degrade: `kind:
// 'scatter'`, a kind this build doesn't understand).

function makeChartResult(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    report_id: 'queue-outcomes',
    generated_at: 0,
    window: [0, 0],
    columns: ['outcome', 'count', 'share'],
    column_meta: [
      { id: 'outcome', label: 'Outcome', kind: 'enum', align: 'left', weight: 1 },
      { id: 'count', label: 'Count', kind: 'int', align: 'right', weight: 1 },
      { id: 'share', label: 'Share', kind: 'text', align: 'left', weight: 1 },
    ],
    rows: [
      { outcome: 'completed', count: 128, share: '89%' },
      { outcome: 'held', count: 9, share: '6%' },
      { outcome: 'blocked', count: 4, share: '3%' },
      { outcome: 'abandoned', count: 2, share: '1%' },
    ],
    notes: [],
    totals: null,
    chart: {
      kind: 'bar',
      series: [{ label: 'Count', column: 'count', color: null }],
      x: 'outcome',
      group_by: null,
      stacked: false,
      title: '',
      y_label: '',
    },
    ...overrides,
  }
}

describe('reportChartPlan — ChartPlan::None', () => {
  it('no chart declared at all -> none', () => {
    expect(reportChartPlan(makeChartResult({ chart: null }))).toEqual({ status: 'none' })
  })

  it('a chart IS declared but the result has zero rows -> none, not degrade (the empty-window message already owns the panel)', () => {
    expect(reportChartPlan(makeChartResult({ rows: [] }))).toEqual({ status: 'none' })
  })
})

describe('reportChartPlan — ChartPlan::Render (queue-outcomes fixture shape)', () => {
  it('resolves the exact series/categories the fixture pins (128/9/4/2, completed/held/blocked/abandoned)', () => {
    const plan = reportChartPlan(makeChartResult())
    expect(plan.status).toBe('render')
    const render = plan as ReportChartRenderPlan
    expect(render.categories).toEqual(['completed', 'held', 'blocked', 'abandoned'])
    expect(render.series).toEqual([{ label: 'Count', data: [128, 9, 4, 2] }])
    expect(render.categoryColumnKind).toBe('enum')
    expect(render.xLabel).toBe('Outcome')
    expect(render.title).toBeNull()
  })

  it('a group_by pivot builds one series per distinct group value, summed per x cell', () => {
    const result = makeChartResult({
      columns: ['repo', 'state', 'count'],
      column_meta: [
        { id: 'repo', label: 'Repo', kind: 'text', align: 'left', weight: 1 },
        { id: 'state', label: 'State', kind: 'enum', align: 'left', weight: 1 },
        { id: 'count', label: 'Count', kind: 'int', align: 'right', weight: 1 },
      ],
      rows: [
        { repo: 'api', state: 'running', count: 3 },
        { repo: 'api', state: 'blocked', count: 1 },
        { repo: 'coord-web', state: 'running', count: 2 },
        { repo: 'api', state: 'running', count: 1 }, // second `api`/`running` row -- sums into the same cell
      ],
      chart: {
        kind: 'bar',
        series: [{ label: 'Count', column: 'count', color: null }],
        x: 'state',
        group_by: 'repo',
        stacked: false,
        title: 'By repo',
        y_label: '',
      },
    })
    const plan = reportChartPlan(result)
    expect(plan.status).toBe('render')
    const render = plan as ReportChartRenderPlan
    // x categories in first-appearance order across ALL rows, not per group.
    expect(render.categories).toEqual(['running', 'blocked'])
    // One series per group, single declared series -> label is the group name
    // itself (no ` · Count` suffix -- that only appears with >1 declared series).
    expect(render.series).toEqual([
      { label: 'api', data: [4, 1] }, // running: 3+1=4, blocked: 1
      { label: 'coord-web', data: [2, 0] },
    ])
    expect(render.title).toBe('By repo')
    expect(render.categoryColumnKind).toBe('text') // group_by column (`repo`) kind, not x's
  })

  it('an empty declared-series title/y_label become null, not empty strings', () => {
    const plan = reportChartPlan(makeChartResult()) as ReportChartRenderPlan
    expect(plan.title).toBeNull()
    expect(plan.yLabel).toBeNull()
  })
})

describe('reportChartPlan — ChartPlan::Degrade', () => {
  it('an unsupported chart kind degrades (usage fixture: kind "scatter")', () => {
    const plan = reportChartPlan(
      makeChartResult({
        report_id: 'usage',
        chart: {
          kind: 'scatter',
          series: [{ label: 'Total $', column: 'cost_total', color: null }],
          x: 'repo',
          group_by: null,
          stacked: false,
          title: '',
          y_label: '',
        },
      }),
    )
    expect(plan).toEqual({
      status: 'degrade',
      reason: "Chart not shown: this build does not understand chart kind 'scatter'. The table below carries the same numbers.",
    })
  })

  it('a declared series column with no numeric value in any row degrades rather than plotting a flat zero line', () => {
    const plan = reportChartPlan(
      makeChartResult({
        chart: {
          kind: 'bar',
          series: [{ label: 'Bogus', column: 'does_not_exist', color: null }],
          x: 'outcome',
          group_by: null,
          stacked: false,
          title: '',
          y_label: '',
        },
      }),
    )
    expect(plan.status).toBe('degrade')
    expect((plan as { reason: string }).reason).toMatch(/no numeric column/)
  })

  it('more series than a one-row legend can label degrades (no silent partial chart)', () => {
    const columns = Array.from({ length: 13 }, (_, i) => `s${i}`)
    const result = makeChartResult({
      columns,
      column_meta: columns.map((id) => ({ id, label: id, kind: 'int', align: 'right', weight: 1 })),
      rows: [Object.fromEntries(columns.map((id, i) => [id, i + 1]))],
      chart: {
        kind: 'bar',
        series: columns.map((id) => ({ label: id, column: id, color: null })),
        x: null,
        group_by: null,
        stacked: false,
        title: '',
        y_label: '',
      },
    })
    const plan = reportChartPlan(result)
    expect(plan.status).toBe('degrade')
    expect((plan as { reason: string }).reason).toMatch(/13 series/)
  })
})

describe('formatReportChartValue', () => {
  it('an integer renders with no decimal point', () => {
    expect(formatReportChartValue(128)).toBe('128')
  })

  it('a non-integer renders to 2 decimal places', () => {
    expect(formatReportChartValue(4.8)).toBe('4.80')
  })
})

describe('reportChartCategoryColorClass', () => {
  it('an enum-kind axis reuses the exact class the grid badge for that value resolves to', () => {
    expect(reportChartCategoryColorClass('completed', 'enum', 0)).toBe('bg-pass')
    expect(reportChartCategoryColorClass('held', 'enum', 1)).toBe('bg-attn')
    expect(reportChartCategoryColorClass('blocked', 'enum', 2)).toBe('bg-fail')
    // Matches `reportEnumBadgeVariant`'s own current mapping -- `abandoned`
    // hits its `'destructive'` case today (same as `blocked`/`failed`), not
    // a dedicated idle/gray one, so the chart mark must follow suit rather
    // than inventing a colour the grid's own badge doesn't actually show.
    expect(reportChartCategoryColorClass('abandoned', 'enum', 3)).toBe('bg-fail')
  })

  it('a non-enum axis falls back to the fixed categorical rotation, cycling past its own length', () => {
    expect(reportChartCategoryColorClass('api', 'text', 0)).toBe('bg-brand')
    expect(reportChartCategoryColorClass('coord-web', 'text', 1)).toBe('bg-pass')
    expect(reportChartCategoryColorClass('sixth', 'text', 5)).toBe('bg-brand') // wraps: 5 % 5 === 0
  })
})

describe('buildReportChartAriaLabel', () => {
  it('every category is followed by its value with real whitespace between pairs (never glued for a \\b regex)', () => {
    const plan = reportChartPlan(makeChartResult()) as ReportChartRenderPlan
    const label = buildReportChartAriaLabel(plan)
    for (const [category, value] of [
      ['completed', 128],
      ['held', 9],
      ['blocked', 4],
      ['abandoned', 2],
    ] as const) {
      expect(label).toMatch(new RegExp(`${category}[^0-9]*${value}\\b`, 'i'))
    }
  })

  it('falls back to "<series label> by <x label>" when the declaration carries no title', () => {
    const plan = reportChartPlan(makeChartResult()) as ReportChartRenderPlan
    expect(buildReportChartAriaLabel(plan).startsWith('Count by Outcome: ')).toBe(true)
  })

  it('uses the declared title verbatim when present', () => {
    const result = makeChartResult({
      chart: {
        kind: 'bar',
        series: [{ label: 'Count', column: 'count', color: null }],
        x: 'outcome',
        group_by: null,
        stacked: false,
        title: 'Outcomes this window',
        y_label: '',
      },
    })
    const plan = reportChartPlan(result) as ReportChartRenderPlan
    expect(buildReportChartAriaLabel(plan).startsWith('Outcomes this window: ')).toBe(true)
  })
})
