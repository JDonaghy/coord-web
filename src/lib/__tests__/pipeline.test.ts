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

describe('latestPerIssue', () => {
  it('collapses N assignment rows for one issue into a single entry', () => {
    const views = [
      makeView({ assignment_id: 'a1', issue_number: 370, repo_name: 'r' }),
      makeView({ assignment_id: 'a2', issue_number: 370, repo_name: 'r' }),
      makeView({ assignment_id: 'a3', issue_number: 370, repo_name: 'r' }),
    ]
    const result = latestPerIssue(views)
    expect(result).toHaveLength(1)
    expect(result[0].assignment_id).toBe('a3')
  })

  it('keeps the latest attempt of a rework cycle (request-changes, then approve fix-1)', () => {
    const requestChanges = makeView({
      assignment_id: 'review-1',
      issue_number: 1930,
      repo_name: 'r',
      current_stage: 'review_failed',
    })
    const approveFix = makeView({
      assignment_id: 'review-2',
      issue_number: 1930,
      repo_name: 'r',
      current_stage: 'merge_ready',
    })
    const result = latestPerIssue([requestChanges, approveFix])
    expect(result).toHaveLength(1)
    expect(result[0].assignment_id).toBe('review-2')
  })

  it('preserves each surviving issue at the position of its LAST occurrence', () => {
    const older = makeView({ assignment_id: 'a1', issue_number: 1, repo_name: 'r' })
    const newest = makeView({ assignment_id: 'b1', issue_number: 2, repo_name: 'r' })
    const olderAgain = makeView({ assignment_id: 'a2', issue_number: 1, repo_name: 'r' })
    // Issue 1's last row (a2) comes after issue 2's only row (b1) — so issue
    // 1 should end up second in the result, not first.
    const result = latestPerIssue([older, newest, olderAgain])
    expect(result.map((v) => v.assignment_id)).toEqual(['b1', 'a2'])
  })

  it('leaves distinct issues untouched', () => {
    const a = makeView({ assignment_id: 'a', issue_number: 1, repo_name: 'r' })
    const b = makeView({ assignment_id: 'b', issue_number: 2, repo_name: 'r' })
    expect(latestPerIssue([a, b])).toEqual([a, b])
  })
})

describe('findLatestForIssue', () => {
  it('returns the last matching row for a (repo, issue) pair', () => {
    const first = makeView({ assignment_id: 'w1', issue_number: 1930, repo_name: 'r' })
    const second = makeView({ assignment_id: 'w2', issue_number: 1930, repo_name: 'r' })
    expect(findLatestForIssue([first, second], 'r', 1930)?.assignment_id).toBe('w2')
    expect(findLatestForIssue([first, second], 'r', '1930')?.assignment_id).toBe('w2')
  })

  it('returns null when nothing matches', () => {
    const view = makeView({ issue_number: 1, repo_name: 'r' })
    expect(findLatestForIssue([view], 'other-repo', 1)).toBeNull()
    expect(findLatestForIssue([view], 'r', 999)).toBeNull()
  })
})
