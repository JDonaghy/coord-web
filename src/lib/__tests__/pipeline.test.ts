/**
 * Unit tests for `src/lib/pipeline.ts`'s predicates and grouping helpers —
 * #2's three defects: a stale terminal item counted as "Active", assignment
 * rows not collapsed to one card per issue, and the resulting count drift.
 */
import { describe, it, expect } from 'vitest'
import { isActive, isStaleFailure, needsMe, latestPerIssue, findLatestForIssue } from '@/lib/pipeline'
import { type PipelineView } from '@/api/client'

function makeView(overrides: Partial<PipelineView> = {}): PipelineView {
  return {
    assignment_id: 'work-1',
    issue_number: 42,
    issue_title: 'Fix the thing',
    repo_name: 'myrepo',
    machine_name: 'laptop',
    current_stage: 'coding',
    stages: [],
    available_gates: [],
    progress_pct: 10,
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

const NOW_MS = 1_783_200_000_000 // an arbitrary "now" the pinned tests below use

describe('isStaleFailure', () => {
  it('is true for a failed item finished more than the staleness window before "now"', () => {
    // #2's repro: current_stage "failed", finished_at 34 days before "now".
    const thirtyFourDaysAgoSec = NOW_MS / 1000 - 34 * 24 * 60 * 60
    const view = makeView({ current_stage: 'failed', finished_at: thirtyFourDaysAgoSec })
    expect(isStaleFailure(view, NOW_MS)).toBe(true)
  })

  it('is false for a failed item finished inside the staleness window', () => {
    const oneHourAgoSec = NOW_MS / 1000 - 60 * 60
    const view = makeView({ current_stage: 'failed', finished_at: oneHourAgoSec })
    expect(isStaleFailure(view, NOW_MS)).toBe(false)
  })

  it('is false for a non-failed stage, however old', () => {
    const thirtyFourDaysAgoSec = NOW_MS / 1000 - 34 * 24 * 60 * 60
    const view = makeView({ current_stage: 'done', finished_at: thirtyFourDaysAgoSec })
    expect(isStaleFailure(view, NOW_MS)).toBe(false)
  })

  it('is false when finished_at is null (not finished yet)', () => {
    const view = makeView({ current_stage: 'failed', finished_at: null })
    expect(isStaleFailure(view, NOW_MS)).toBe(false)
  })
})

describe('isActive', () => {
  it('excludes merged items', () => {
    const view = makeView({ current_stage: 'merged', finished_at: Date.now() / 1000 })
    expect(isActive(view)).toBe(false)
  })

  it('excludes a failed item whose run finished more than the staleness window ago', () => {
    const thirtyFourDaysAgoSec = Date.now() / 1000 - 34 * 24 * 60 * 60
    const view = makeView({ current_stage: 'failed', finished_at: thirtyFourDaysAgoSec })
    expect(isActive(view)).toBe(false)
  })

  it('keeps a failed item that finished inside the staleness window', () => {
    const oneHourAgoSec = Date.now() / 1000 - 60 * 60
    const view = makeView({ current_stage: 'failed', finished_at: oneHourAgoSec })
    expect(isActive(view)).toBe(true)
  })

  it('keeps a running item with no finished_at', () => {
    const view = makeView({ current_stage: 'coding', finished_at: null })
    expect(isActive(view)).toBe(true)
  })

  it('is safe to pass directly to Array.prototype.filter (element, index, array callback shape)', () => {
    // Regression: `filter` calls its callback with (element, index, array).
    // An `isActive(view, now = Date.now())` two-arg form would silently
    // receive `index` as `now`, making every item look "not stale" (index
    // is always far smaller than any real epoch-ms `finished_at`).
    const thirtyFourDaysAgoSec = Date.now() / 1000 - 34 * 24 * 60 * 60
    const staleFailed = makeView({ current_stage: 'failed', finished_at: thirtyFourDaysAgoSec })
    const live = makeView({ current_stage: 'coding', finished_at: null })
    expect([staleFailed, live].filter(isActive)).toEqual([live])
  })
})

describe('needsMe', () => {
  it('has no recency check — a stale failure with a retry gate still needs me', () => {
    const thirtyFourDaysAgoSec = NOW_MS / 1000 - 34 * 24 * 60 * 60
    const view = makeView({
      current_stage: 'failed',
      finished_at: thirtyFourDaysAgoSec,
      available_gates: [{ action: 'retry', label: 'Retry', endpoint: '/api/pipeline/action' }],
    })
    expect(needsMe(view)).toBe(true)
  })
})

// `/api/pipeline` sorts rows NEWEST-FIRST (claude-coordinator
// `coord/dashboard/server.py`, `reverse=True`, #2066 step 3). Every
// multi-row fixture below is written in that real order — newest row first —
// because #19 was exactly the bug of assuming the opposite.
describe('latestPerIssue', () => {
  it('collapses N assignment rows for one issue into a single entry, keeping the newest', () => {
    // Newest-first, as the API returns them: a3 is the current attempt.
    const views = [
      makeView({ assignment_id: 'a3', issue_number: 370, repo_name: 'r' }),
      makeView({ assignment_id: 'a2', issue_number: 370, repo_name: 'r' }),
      makeView({ assignment_id: 'a1', issue_number: 370, repo_name: 'r' }),
    ]
    const result = latestPerIssue(views)
    expect(result).toHaveLength(1)
    expect(result[0].assignment_id).toBe('a3')
  })

  it('keeps the latest attempt of a rework cycle (request-changes, then approve fix-1)', () => {
    const approveFix = makeView({
      assignment_id: 'review-2',
      issue_number: 1930,
      repo_name: 'r',
      current_stage: 'merge_ready',
    })
    const requestChanges = makeView({
      assignment_id: 'review-1',
      issue_number: 1930,
      repo_name: 'r',
      current_stage: 'review_failed',
    })
    const result = latestPerIssue([approveFix, requestChanges])
    expect(result).toHaveLength(1)
    expect(result[0].assignment_id).toBe('review-2')
  })

  // #19's reported defect, verbatim: claude-coordinator#2472 rendered a red
  // "failed" badge forever, because the collapse kept the row with the
  // highest array index — which, against the API's newest-first order, is the
  // OLDEST attempt. The merged row could never win.
  it('keeps a merged row over an earlier review_failed row for the same issue (#19)', () => {
    const merged = makeView({
      assignment_id: 'merge-2472',
      issue_number: 2472,
      repo_name: 'claude-coordinator',
      current_stage: 'merged',
      finished_at: NOW_MS / 1000 - 60 * 60,
    })
    const reviewFailed = makeView({
      assignment_id: 'review-2472',
      issue_number: 2472,
      repo_name: 'claude-coordinator',
      current_stage: 'review_failed',
      finished_at: NOW_MS / 1000 - 6 * 60 * 60,
    })
    const result = latestPerIssue([merged, reviewFailed])
    expect(result).toHaveLength(1)
    expect(result[0].assignment_id).toBe('merge-2472')
    expect(result[0].current_stage).toBe('merged')
  })

  it('drops that issue from the Active tab, since the surviving row is merged (#19)', () => {
    // The stale-row bug also pinned the card in Active forever: `isActive` was
    // evaluated against the collapsed (non-merged) row, so it never read as
    // finished. Same fixture, one filter further down Home's pipeline.
    const merged = makeView({
      assignment_id: 'merge-2472',
      issue_number: 2472,
      repo_name: 'claude-coordinator',
      current_stage: 'merged',
      finished_at: Date.now() / 1000 - 60 * 60,
    })
    const reviewFailed = makeView({
      assignment_id: 'review-2472',
      issue_number: 2472,
      repo_name: 'claude-coordinator',
      current_stage: 'review_failed',
      finished_at: Date.now() / 1000 - 6 * 60 * 60,
    })
    expect(latestPerIssue([merged, reviewFailed]).filter(isActive)).toEqual([])
  })

  it('prefers the greater finished_at even if the rows arrive oldest-first', () => {
    // Robustness, not the current server contract: comparing `finished_at`
    // directly (the same signal the server sorts by) means the collapse can't
    // silently invert again if that ordering ever changes.
    const older = makeView({
      assignment_id: 'review-1',
      issue_number: 2472,
      repo_name: 'r',
      current_stage: 'review_failed',
      finished_at: NOW_MS / 1000 - 6 * 60 * 60,
    })
    const newer = makeView({
      assignment_id: 'merge-1',
      issue_number: 2472,
      repo_name: 'r',
      current_stage: 'merged',
      finished_at: NOW_MS / 1000 - 60 * 60,
    })
    const result = latestPerIssue([older, newer])
    expect(result).toHaveLength(1)
    expect(result[0].assignment_id).toBe('merge-1')
  })

  it('does not let an unfinished row outrank a newer finished one', () => {
    // A limbo/abandoned attempt has finished_at === null. Ranking null as
    // "newest" would reintroduce #19 with the roles swapped: the dead row
    // would permanently shadow the real merged one. Newest-first order says
    // the merged row leads, and it wins.
    const merged = makeView({
      assignment_id: 'merge-1',
      issue_number: 2472,
      repo_name: 'r',
      current_stage: 'merged',
      finished_at: NOW_MS / 1000 - 60 * 60,
    })
    const abandoned = makeView({
      assignment_id: 'work-limbo',
      issue_number: 2472,
      repo_name: 'r',
      current_stage: 'coding',
      finished_at: null,
    })
    const result = latestPerIssue([merged, abandoned])
    expect(result).toHaveLength(1)
    expect(result[0].assignment_id).toBe('merge-1')
  })

  it('preserves each surviving issue at the position of its winning row', () => {
    const newestForIssue1 = makeView({ assignment_id: 'a2', issue_number: 1, repo_name: 'r' })
    const onlyRowForIssue2 = makeView({ assignment_id: 'b1', issue_number: 2, repo_name: 'r' })
    const olderForIssue1 = makeView({ assignment_id: 'a1', issue_number: 1, repo_name: 'r' })
    // Issue 1's winning (first, newest) row leads the API response, so issue 1
    // keeps that leading position — it does not slide down to the superseded
    // row's index.
    const result = latestPerIssue([newestForIssue1, onlyRowForIssue2, olderForIssue1])
    expect(result.map((v) => v.assignment_id)).toEqual(['a2', 'b1'])
  })

  it('leaves distinct issues untouched', () => {
    const a = makeView({ assignment_id: 'a', issue_number: 1, repo_name: 'r' })
    const b = makeView({ assignment_id: 'b', issue_number: 2, repo_name: 'r' })
    expect(latestPerIssue([a, b])).toEqual([a, b])
  })

  it('does not collapse the same issue number across different repos', () => {
    const a = makeView({ assignment_id: 'a', issue_number: 19, repo_name: 'coord-web' })
    const b = makeView({ assignment_id: 'b', issue_number: 19, repo_name: 'claude-coordinator' })
    expect(latestPerIssue([a, b]).map((v) => v.assignment_id)).toEqual(['a', 'b'])
  })
})

describe('findLatestForIssue', () => {
  it('returns the newest matching row for a (repo, issue) pair', () => {
    // Newest-first API order: the current attempt leads.
    const newest = makeView({ assignment_id: 'w2', issue_number: 1930, repo_name: 'r' })
    const older = makeView({ assignment_id: 'w1', issue_number: 1930, repo_name: 'r' })
    expect(findLatestForIssue([newest, older], 'r', 1930)?.assignment_id).toBe('w2')
    expect(findLatestForIssue([newest, older], 'r', '1930')?.assignment_id).toBe('w2')
  })

  it('agrees with latestPerIssue on which row an issue is currently at (#19)', () => {
    // Detail.tsx looks the issue up with this; Home.tsx renders the card with
    // `latestPerIssue`. If the two disagreed, tapping a card would open a
    // detail view for a different attempt than the card that led there.
    const merged = makeView({
      assignment_id: 'merge-2472',
      issue_number: 2472,
      repo_name: 'claude-coordinator',
      current_stage: 'merged',
      finished_at: NOW_MS / 1000 - 60 * 60,
    })
    const reviewFailed = makeView({
      assignment_id: 'review-2472',
      issue_number: 2472,
      repo_name: 'claude-coordinator',
      current_stage: 'review_failed',
      finished_at: NOW_MS / 1000 - 6 * 60 * 60,
    })
    const rows = [merged, reviewFailed]
    expect(findLatestForIssue(rows, 'claude-coordinator', 2472)).toBe(latestPerIssue(rows)[0])
  })

  it('prefers the greater finished_at even if the rows arrive oldest-first', () => {
    const older = makeView({
      assignment_id: 'w1',
      issue_number: 1930,
      repo_name: 'r',
      finished_at: NOW_MS / 1000 - 6 * 60 * 60,
    })
    const newer = makeView({
      assignment_id: 'w2',
      issue_number: 1930,
      repo_name: 'r',
      finished_at: NOW_MS / 1000 - 60 * 60,
    })
    expect(findLatestForIssue([older, newer], 'r', 1930)?.assignment_id).toBe('w2')
  })

  it('returns null when nothing matches', () => {
    const view = makeView({ issue_number: 1, repo_name: 'r' })
    expect(findLatestForIssue([view], 'other-repo', 1)).toBeNull()
    expect(findLatestForIssue([view], 'r', 999)).toBeNull()
  })
})
