/**
 * Unit tests for the Milestones panel's pure helpers (#91).
 *
 * The two properties worth pinning here are the ones a well-meaning future
 * edit is most likely to break: that the two progress scopes stay *separate*
 * (milestone-wide GitHub counters vs work-order-scoped dispatch scope — they
 * are routinely different numbers and that is not a bug), and that nothing
 * reorders anything.
 */
import { describe, it, expect } from 'vitest'

import type { MilestoneEntryWire, MilestoneGateAWire, MilestoneSummaryWire } from '@/api/client'
import {
  entryDispatched,
  entryStateLabel,
  entryStateTone,
  gateAHeadline,
  gateAStale,
  gateCells,
  groupMilestonesByRepo,
  milestoneProgress,
  milestoneRef,
  shortSha,
  workOrderComplete,
  workOrderProgress,
} from '@/lib/milestones'

function summary(overrides: Partial<MilestoneSummaryWire> = {}): MilestoneSummaryWire {
  return {
    repo_name: 'coord-web',
    milestone_number: 4,
    title: 'Machines panel',
    state: 'open',
    tracking_issue: 68,
    open_issues: 1,
    closed_issues: 7,
    oracle: true,
    has_work_order: true,
    work_order_total: 7,
    work_order_done: 7,
    ready_frontier: 0,
    in_flight: 0,
    blocked: 0,
    needs_you: [],
    ...overrides,
  }
}

function entry(overrides: Partial<MilestoneEntryWire> = {}): MilestoneEntryWire {
  return {
    issue_number: 61,
    title: 'Machines API client',
    state: 'closed',
    position: 1,
    after: [],
    group: 'A',
    gates: null,
    ...overrides,
  }
}

function gateA(overrides: Partial<MilestoneGateAWire> = {}): MilestoneGateAWire {
  return {
    state: 'approved',
    ok: true,
    contract_sha: 'abcdef1234567',
    reason: null,
    verdict: 'approved',
    actor: 'john',
    recorded_at: 1_700_000_000,
    approved_contract_sha: 'abcdef1234567',
    href: '/api/gate-a/coord-web/68',
    ...overrides,
  }
}

describe('progress', () => {
  it('reports the milestone’s GitHub counters', () => {
    expect(milestoneProgress(summary())).toEqual({ done: 7, total: 8, pct: 88 })
  })

  it('reports the work order separately — a different scope, routinely a different number', () => {
    const m = summary({ open_issues: 4, closed_issues: 1, work_order_total: 2, work_order_done: 2 })
    expect(milestoneProgress(m)).toEqual({ done: 1, total: 5, pct: 20 })
    expect(workOrderProgress(m)).toEqual({ done: 2, total: 2, pct: 100 })
  })

  it('never divides by zero — an empty milestone is 0%, not NaN', () => {
    expect(milestoneProgress(summary({ open_issues: 0, closed_issues: 0 }))).toEqual({
      done: 0,
      total: 0,
      pct: 0,
    })
    expect(workOrderProgress(summary({ work_order_total: 0, work_order_done: 0 })).pct).toBe(0)
  })

  it('treats a milestone with no work order as unknown, not complete', () => {
    expect(workOrderComplete(summary({ has_work_order: false, work_order_total: 0 }))).toBe(false)
    expect(workOrderComplete(summary({ work_order_done: 3, work_order_total: 7 }))).toBe(false)
    expect(workOrderComplete(summary())).toBe(true)
  })
})

describe('groupMilestonesByRepo', () => {
  it('groups by repo in first-appearance order, preserving row order within a group', () => {
    const rows = [
      summary({ repo_name: 'vimcode', milestone_number: 9 }),
      summary({ repo_name: 'coord-web', milestone_number: 1 }),
      summary({ repo_name: 'vimcode', milestone_number: 2 }),
    ]
    const groups = groupMilestonesByRepo(rows)
    expect(groups.map((g) => g.repo)).toEqual(['vimcode', 'coord-web'])
    // Not sorted to [2, 9] — the endpoint's order is the order.
    expect(groups[0].milestones.map((m) => m.milestone_number)).toEqual([9, 2])
  })

  it('is empty for an empty roster', () => {
    expect(groupMilestonesByRepo([])).toEqual([])
  })
})

describe('gateCells', () => {
  it('always yields the same four columns, in the same order', () => {
    expect(gateCells(entry()).map((c) => c.key)).toEqual(['status', 'test', 'smoke', 'review'])
  })

  it('renders an undispatched entry as four empty cells, not a collapsed row', () => {
    // "never dispatched" and "dispatched, no verdict yet" are different
    // facts; a row that loses its columns conflates them.
    const cells = gateCells(entry({ gates: null }))
    expect(cells.every((c) => c.value === null)).toBe(true)
    expect(entryDispatched(entry({ gates: null }))).toBe(false)
  })

  it('shows a verdict when there is one, and progress only when there isn’t', () => {
    const gates = {
      assignment_id: 'work-1',
      status: 'running' as const,
      branch: 'issue-61',
      machine_name: 'dellserver',
      test_state: 'passed' as const,
      smoke_test: null,
      review_state: 'dispatched' as const,
      review_verdict: null,
    }
    const withoutVerdict = gateCells(entry({ gates }))
    expect(withoutVerdict.find((c) => c.key === 'review')?.value).toBe('dispatched')

    const withVerdict = gateCells(entry({ gates: { ...gates, review_verdict: 'request-changes' } }))
    const review = withVerdict.find((c) => c.key === 'review')
    expect(review?.value).toBe('request-changes')
    expect(review?.tone).toBe('destructive')
  })

  it('tones a failed test destructively and a passed one as success', () => {
    const base = {
      assignment_id: 'a',
      status: null,
      branch: null,
      machine_name: null,
      smoke_test: null,
      review_state: null,
      review_verdict: null,
    }
    const failed = gateCells(entry({ gates: { ...base, test_state: 'failed' } }))
    expect(failed.find((c) => c.key === 'test')?.tone).toBe('destructive')
    const passed = gateCells(entry({ gates: { ...base, test_state: 'passed' } }))
    expect(passed.find((c) => c.key === 'test')?.tone).toBe('success')
  })
})

describe('entry state', () => {
  it('labels an unresolved node as unresolved rather than guessing closed', () => {
    expect(entryStateLabel(null)).toBe('unresolved')
    expect(entryStateTone(null)).toBe('warning')
    expect(entryStateLabel('closed')).toBe('closed')
    expect(entryStateTone('closed')).toBe('success')
    expect(entryStateTone('open')).toBe('outline')
  })
})

describe('gate A summary', () => {
  it('headlines each state in the panel’s own vocabulary', () => {
    expect(gateAHeadline(gateA())).toBe('Signed off')
    expect(gateAHeadline(gateA({ state: 'missing' }))).toMatch(/No verdict/)
    expect(gateAHeadline(gateA({ state: 'changes' }))).toMatch(/Changes requested/)
    expect(gateAHeadline(gateA({ state: 'exempt' }))).toMatch(/Exempt/)
    expect(gateAHeadline(gateA({ state: 'stale' }))).toMatch(/stale/)
  })

  it('detects staleness from the state OR from the shas disagreeing', () => {
    expect(gateAStale(gateA())).toBe(false)
    expect(gateAStale(gateA({ state: 'stale' }))).toBe(true)
    expect(gateAStale(gateA({ approved_contract_sha: 'older99' }))).toBe(true)
  })

  it('never claims staleness when the server reported no contract sha at all', () => {
    expect(gateAStale(gateA({ state: 'missing', contract_sha: '', approved_contract_sha: null }))).toBe(
      false,
    )
  })

  it('shortens a sha and shows an em dash when there is none', () => {
    expect(shortSha('abcdef1234567')).toBe('abcdef1')
    expect(shortSha('')).toBe('—')
  })
})

describe('milestoneRef', () => {
  it('is ms-N, never issue-N — different namespaces', () => {
    expect(milestoneRef('coord-web', 4)).toBe('CW ms-4')
    expect(milestoneRef('JDonaghy/claude-coordinator', 12)).toBe('CC ms-12')
  })
})
