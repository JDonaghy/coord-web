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
import type { ColumnMeta, ReportParam } from '@/api/client'
import {
  buildReportParamDefaults,
  DEFAULT_REPORT_ID,
  defaultSelectedReportId,
  formatReportDuration,
  formatReportList,
  formatReportMoney,
  formatReportTimestamp,
  reportCellAlign,
  reportCellIsMono,
  reportCellText,
  reportChoiceOptions,
  reportEnumBadgeVariant,
  reportParamIsChoice,
  reportRowCountLabel,
  REPORT_EMPTY_CELL,
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
