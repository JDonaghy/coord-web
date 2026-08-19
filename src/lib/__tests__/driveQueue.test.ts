/**
 * Unit tests for `src/lib/driveQueue.ts` (#7 QW-3).
 *
 * The summary-stat scenarios below intentionally reuse the exact fixture
 * shapes and expected counts from the TUI's own `summarize_drive_queue` unit
 * tests (`tui/src/app/drive_queue.rs`, `status_text_normal_counts_running_and_waiting`
 * / `status_text_stalled_when_nothing_is_eligible` /
 * `status_text_blocked_outranks_a_simultaneous_stall`) — each test below
 * names its TUI counterpart so a future reader can compare the two directly,
 * per the issue's own ask. `driveQueueSummaryStats` never recomputes those
 * counts itself (see the module doc comment); what's under test here is
 * purely the display formatting math layered on top of a `DriveQueueSummary`
 * a server already computed.
 */
import { describe, it, expect } from 'vitest'
import type { BoardDriveQueueEntry, DriveQueueSummary, PipelineView } from '@/api/client'
import {
  buildQueueTitleLookup,
  driveQueueRepoOptions,
  driveQueueSummaryStats,
  filterQueueEntriesByRepo,
  formatQueueAge,
  QUEUE_EMPTY_CELL,
  queueAfterCell,
  queueEntryKey,
  queueHoldCell,
  queueMachineCell,
  queueReasonCell,
  queueStateCell,
  queueTitleCell,
} from '../driveQueue'

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<BoardDriveQueueEntry> = {}): BoardDriveQueueEntry {
  return {
    id: 1,
    repo_name: 'myrepo',
    issue_number: 1,
    position: 0,
    machine: null,
    after_json: [],
    state: 'waiting',
    attempts: 0,
    deferrals: 0,
    last_reason: '',
    reason_at: null,
    session_name: null,
    launched_at: null,
    enqueued_at: 0,
    hold_after: 0,
    hold_reason: '',
    resume_when: '',
    hold_state: '',
    hold_probes: 0,
    launch_host: '',
    hold_scope: '',
    resumes: 0,
    retry_backoff_at: null,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<DriveQueueSummary> = {}): DriveQueueSummary {
  return {
    level: 'normal',
    pending: 0,
    running: 0,
    waiting: 0,
    blocked: 0,
    eligible: 0,
    held: 0,
    fleet_held: 0,
    ...overrides,
  }
}

function makeView(overrides: Partial<PipelineView> = {}): PipelineView {
  return {
    assignment_id: 'a-1',
    issue_number: 1,
    issue_title: 'Untitled',
    repo_name: 'myrepo',
    machine_name: 'laptop',
    current_stage: 'coding',
    stages: [],
    available_gates: [],
    progress_pct: 0,
    review_findings_pending: false,
    review_verdict: null,
    review_verdict_original: null,
    review_verdict_override_reason: null,
    review_findings_body: null,
    test_verdict: null,
    needs_attention: false,
    needs_attention_reason: null,
    needs_attention_detail: null,
    finished_at: null,
    ...overrides,
  }
}

// ── repo-scope dropdown / filter logic ──────────────────────────────────────

describe('driveQueueRepoOptions', () => {
  it('returns distinct repo names, alphabetical', () => {
    const entries = [
      makeEntry({ repo_name: 'zeta' }),
      makeEntry({ repo_name: 'alpha' }),
      makeEntry({ repo_name: 'alpha' }),
      makeEntry({ repo_name: 'mid' }),
    ]
    expect(driveQueueRepoOptions(entries)).toEqual(['alpha', 'mid', 'zeta'])
  })

  it('is empty for an empty queue', () => {
    expect(driveQueueRepoOptions([])).toEqual([])
  })
})

describe('filterQueueEntriesByRepo', () => {
  const entries = [
    makeEntry({ id: 1, repo_name: 'repo-a', issue_number: 1 }),
    makeEntry({ id: 2, repo_name: 'repo-b', issue_number: 2 }),
    makeEntry({ id: 3, repo_name: 'repo-a', issue_number: 3 }),
  ]

  it('returns every entry unchanged for the "All repos" scope (null)', () => {
    expect(filterQueueEntriesByRepo(entries, null)).toEqual(entries)
  })

  it('narrows to entries whose repo_name matches the scope', () => {
    const scoped = filterQueueEntriesByRepo(entries, 'repo-a')
    expect(scoped.map((e) => e.id)).toEqual([1, 3])
  })

  it('returns an empty array for a repo with no entries', () => {
    expect(filterQueueEntriesByRepo(entries, 'repo-nonexistent')).toEqual([])
  })
})

// ── summary block ────────────────────────────────────────────────────────────

describe('driveQueueSummaryStats', () => {
  // Mirrors the TUI's `status_text_normal_counts_running_and_waiting`: 1
  // running + 3 waiting entries with no `after` edges, so every waiting row
  // is eligible and the level is Normal — asserted there as
  // `"QUEUE: 1 running · 3 waiting"`.
  it('normal: running + waiting, all waiting rows eligible', () => {
    const summary = makeSummary({ level: 'normal', pending: 4, running: 1, waiting: 3, eligible: 3 })
    const stats = driveQueueSummaryStats(summary)
    expect(stats).toEqual([
      { key: 'pending', label: 'Pending', value: '4' },
      { key: 'running', label: 'Running', value: '1' },
      { key: 'waiting', label: 'Waiting', value: '3 (3 eligible)' },
      { key: 'blocked', label: 'Blocked', value: '0' },
      { key: 'held', label: 'Held', value: '0' },
    ])
  })

  // Mirrors the TUI's `status_text_stalled_when_nothing_is_eligible`: three
  // entries each waiting on the next in a cycle, so nothing is eligible —
  // asserted there as `"QUEUE: STALLED — 3 waiting, none eligible"` with
  // `s.eligible == 0`.
  it('stalled: waiting rows present but none eligible', () => {
    const summary = makeSummary({ level: 'stalled', pending: 3, waiting: 3, eligible: 0 })
    const stats = driveQueueSummaryStats(summary)
    expect(stats.find((s) => s.key === 'waiting')).toEqual({
      key: 'waiting',
      label: 'Waiting',
      value: '3 (0 eligible)',
    })
  })

  // Mirrors the TUI's `status_text_blocked_outranks_a_simultaneous_stall`: 2
  // blocked entries + 1 waiting entry blocked on a non-done pre-req (so also
  // ineligible) — asserted there as `"QUEUE: BLOCKED 2 · 1 waiting"`.
  it('blocked: blocked rows counted separately from an ineligible waiting row', () => {
    const summary = makeSummary({ level: 'blocked', pending: 3, waiting: 1, blocked: 2, eligible: 0 })
    const stats = driveQueueSummaryStats(summary)
    expect(stats.find((s) => s.key === 'blocked')).toEqual({ key: 'blocked', label: 'Blocked', value: '2' })
    expect(stats.find((s) => s.key === 'waiting')).toEqual({
      key: 'waiting',
      label: 'Waiting',
      value: '1 (0 eligible)',
    })
  })

  it('held reads straight off summary.held, independent of fleet_held', () => {
    const summary = makeSummary({ held: 2, fleet_held: 1 })
    const stats = driveQueueSummaryStats(summary)
    expect(stats.find((s) => s.key === 'held')).toEqual({ key: 'held', label: 'Held', value: '2' })
  })

  it('an empty queue renders every stat as zero, not omitted', () => {
    const stats = driveQueueSummaryStats(makeSummary({ level: 'empty' }))
    expect(stats.map((s) => s.value)).toEqual(['0', '0', '0 (0 eligible)', '0', '0'])
  })
})

// ── grid cells ───────────────────────────────────────────────────────────────

describe('queueEntryKey', () => {
  it('joins repo_name and issue_number with #', () => {
    expect(queueEntryKey(makeEntry({ repo_name: 'coord-web', issue_number: 7 }))).toBe('coord-web#7')
  })
})

describe('queueStateCell / queueMachineCell / queueAfterCell', () => {
  it('renders the raw state', () => {
    expect(queueStateCell(makeEntry({ state: 'running' }))).toBe('running')
  })

  it('dashes out a null machine', () => {
    expect(queueMachineCell(makeEntry({ machine: null }))).toBe(QUEUE_EMPTY_CELL)
    expect(queueMachineCell(makeEntry({ machine: 'laptop' }))).toBe('laptop')
  })

  it('dashes out an empty after_json and joins a populated one', () => {
    expect(queueAfterCell(makeEntry({ after_json: [] }))).toBe(QUEUE_EMPTY_CELL)
    expect(queueAfterCell(makeEntry({ after_json: ['repo#1', 'repo#2'] }))).toBe('repo#1, repo#2')
  })
})

describe('queueHoldCell', () => {
  it('is the empty cell when the entry carries no gate at all', () => {
    expect(queueHoldCell(makeEntry({ hold_after: 0, hold_state: '' }))).toBe(QUEUE_EMPTY_CELL)
  })

  it('names an armed-but-not-fired gate by its hold_state, or "gate" if blank', () => {
    expect(queueHoldCell(makeEntry({ hold_after: 1, hold_state: 'armed' }))).toBe('armed')
    expect(queueHoldCell(makeEntry({ hold_after: 1, hold_state: '' }))).toBe('gate')
  })

  it('renders FIRED for an entry-scoped fired gate, scope silent', () => {
    expect(
      queueHoldCell(makeEntry({ hold_after: 1, hold_state: 'fired', hold_scope: 'entry' })),
    ).toBe('FIRED')
  })

  it('renders FIRED [fleet] for a fleet-scoped fired gate', () => {
    expect(
      queueHoldCell(makeEntry({ hold_after: 1, hold_state: 'fired', hold_scope: 'fleet' })),
    ).toBe('FIRED [fleet]')
  })
})

describe('formatQueueAge', () => {
  const now = 1_700_000_000_000 // ms

  it('is empty for a missing or non-positive timestamp', () => {
    expect(formatQueueAge(null, now)).toBe('')
    expect(formatQueueAge(0, now)).toBe('')
  })

  it('formats sub-minute ages in seconds', () => {
    expect(formatQueueAge(now / 1000 - 30, now)).toBe('30s ago')
  })

  it('formats sub-hour ages in minutes', () => {
    expect(formatQueueAge(now / 1000 - 5 * 60, now)).toBe('5m ago')
  })

  it('formats sub-day ages in hours', () => {
    expect(formatQueueAge(now / 1000 - 3 * 3600, now)).toBe('3h ago')
  })

  it('formats ages of a day or more in days', () => {
    expect(formatQueueAge(now / 1000 - 2 * 86400, now)).toBe('2d ago')
  })
})

describe('queueReasonCell', () => {
  const now = 1_700_000_000_000

  it('is the empty cell for a blank last_reason', () => {
    expect(queueReasonCell(makeEntry({ last_reason: '' }), now)).toBe(QUEUE_EMPTY_CELL)
  })

  it('age-stamps a present reason_at', () => {
    expect(
      queueReasonCell(
        makeEntry({ last_reason: 'checks_failed', reason_at: now / 1000 - 3 * 3600 }),
        now,
      ),
    ).toBe('checks_failed (3h ago)')
  })

  it('renders the bare reason when reason_at is absent', () => {
    expect(queueReasonCell(makeEntry({ last_reason: 'checks_failed', reason_at: null }), now)).toBe(
      'checks_failed',
    )
  })
})

describe('buildQueueTitleLookup / queueTitleCell', () => {
  it('resolves a title from the pipeline roster by repo#issue', () => {
    const views = [makeView({ repo_name: 'coord-web', issue_number: 7, issue_title: 'Grid + dropdown' })]
    const titleByKey = buildQueueTitleLookup(views)
    expect(queueTitleCell(makeEntry({ repo_name: 'coord-web', issue_number: 7 }), titleByKey)).toBe(
      'Grid + dropdown',
    )
  })

  it('dashes out an entry with no matching pipeline row', () => {
    const titleByKey = buildQueueTitleLookup([])
    expect(queueTitleCell(makeEntry({ repo_name: 'coord-web', issue_number: 999 }), titleByKey)).toBe(
      QUEUE_EMPTY_CELL,
    )
  })
})
