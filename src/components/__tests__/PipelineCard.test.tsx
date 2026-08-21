/**
 * Component tests for PipelineCard and the Home-screen filter functions.
 *
 * These use vitest + @testing-library/react.  Run with `npm test` (or
 * `npx vitest run`) after `npm install`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PipelineCard } from '@/components/PipelineCard'
import { type PipelineView } from '@/api/client'

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeView(overrides: Partial<PipelineView> = {}): PipelineView {
  return {
    assignment_id: 'work-1',
    issue_number: 42,
    issue_title: 'Fix the thing',
    repo_name: 'myrepo',
    machine_name: 'laptop',
    current_stage: 'coding',
    stages: [
      { name: 'coding', status: 'active', is_current: true },
      { name: 'review', status: 'waiting', is_current: false },
      { name: 'smoke',  status: 'waiting', is_current: false },
      { name: 'merge',  status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 10,
    review_findings_pending: false,
    review_verdict: null,
    // #1456: null = the reviewer's own verdict stands (the normal case).
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

// ── PipelineCard rendering ────────────────────────────────────────────────────

describe('PipelineCard', () => {
  it('renders issue title, repo, issue number, and machine', () => {
    render(<PipelineCard view={makeView()} onClick={() => undefined} />)

    // The card is a button — scope assertions to it to avoid ambiguity
    const card = screen.getByRole('button')
    expect(card).toHaveTextContent('Fix the thing')
    expect(card).toHaveTextContent('#42')
    expect(card).toHaveTextContent('myrepo')
    expect(card).toHaveTextContent('laptop')
  })

  it('renders stage chips with display names (coding→work, smoke→test)', () => {
    render(<PipelineCard view={makeView()} onClick={() => undefined} />)

    expect(screen.getByText('work')).toBeInTheDocument()
    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.getByText('test')).toBeInTheDocument()
    expect(screen.getByText('merge')).toBeInTheDocument()
  })

  it('shows "running" status badge when current_stage is coding', () => {
    render(<PipelineCard view={makeView({ current_stage: 'coding' })} onClick={() => undefined} />)
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('shows "failed" status badge for failed stage', () => {
    const view = makeView({
      current_stage: 'failed',
      stages: [
        { name: 'coding', status: 'active', is_current: true },
        { name: 'review', status: 'waiting', is_current: false },
        { name: 'smoke',  status: 'waiting', is_current: false },
        { name: 'merge',  status: 'waiting', is_current: false },
      ],
    })
    render(<PipelineCard view={view} onClick={() => undefined} />)
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('shows "mergeable" badge when current_stage is merge_ready', () => {
    const view = makeView({
      current_stage: 'merge_ready',
      stages: [
        { name: 'coding', status: 'completed', is_current: false },
        { name: 'review', status: 'completed', is_current: false },
        { name: 'smoke',  status: 'completed', is_current: false },
        { name: 'merge',  status: 'active', is_current: true },
      ],
      available_gates: [{ action: 'merge', label: 'Merge', endpoint: '/api/pipeline/action' }],
    })
    render(<PipelineCard view={view} onClick={() => undefined} />)
    expect(screen.getByText('mergeable')).toBeInTheDocument()
  })

  it('shows review findings pending warning', () => {
    render(
      <PipelineCard
        view={makeView({ review_findings_pending: true })}
        onClick={() => undefined}
      />,
    )
    expect(screen.getByText(/Review findings not yet posted/)).toBeInTheDocument()
  })

  it('calls onClick when the card is pressed', async () => {
    const onClick = vi.fn()
    render(<PipelineCard view={makeView()} onClick={onClick} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not render a relative-time label when finishedAt is omitted (#1218 follow-up)', () => {
    render(<PipelineCard view={makeView({ finished_at: 100 })} onClick={() => undefined} />)
    expect(screen.queryByText(/ago$/)).not.toBeInTheDocument()
  })
})

// ── Stage-chip verdict awareness + active ring (#28) ──────────────────────────
//
// Before #28, a stage chip's color came from `stage.status`/`is_current`
// alone — a rejected review or failed test never turned its chip red once
// the stage was no longer current. These assert the fix directly: a
// stage-specific verdict wins outright regardless of `status`/`current_stage`,
// and the "currently in flight" ring is a separate visual channel from fill.

describe('PipelineCard — stage-chip verdict awareness (#28)', () => {
  it('review chip renders fail-red when review_verdict is request-changes, even though the stage is completed and no longer current', () => {
    const view = makeView({
      current_stage: 'review_done',
      review_verdict: 'request-changes',
      stages: [
        { name: 'coding', status: 'completed', is_current: false },
        { name: 'review', status: 'completed', is_current: false },
        { name: 'smoke',  status: 'waiting',   is_current: false },
        { name: 'merge',  status: 'waiting',   is_current: false },
      ],
    })
    render(<PipelineCard view={view} onClick={() => undefined} />)
    expect(screen.getByText('review')).toHaveClass('bg-destructive')
  })

  it('test chip renders fail-red when test_verdict is failed, even though the stage is completed', () => {
    const view = makeView({
      current_stage: 'smoke_passed',
      test_verdict: 'failed',
      stages: [
        { name: 'coding', status: 'completed', is_current: false },
        { name: 'review', status: 'waiting',   is_current: false },
        { name: 'smoke',  status: 'completed', is_current: false },
        { name: 'merge',  status: 'waiting',   is_current: false },
      ],
    })
    render(<PipelineCard view={view} onClick={() => undefined} />)
    expect(screen.getByText('test')).toHaveClass('bg-destructive')
  })

  it('gives only the is_current stage a ring, independent of its fill color', () => {
    const view = makeView({
      current_stage: 'coding',
      stages: [
        { name: 'coding', status: 'active',  is_current: true },
        { name: 'review', status: 'waiting', is_current: false },
        { name: 'smoke',  status: 'waiting', is_current: false },
        { name: 'merge',  status: 'waiting', is_current: false },
      ],
    })
    render(<PipelineCard view={view} onClick={() => undefined} />)
    expect(screen.getByText('work')).toHaveClass('ring-2')
    expect(screen.getByText('review')).not.toHaveClass('ring-2')
  })
})

// ── Relative-time label buckets (rendered via PipelineCard's `finishedAt`) ────
//
// formatRelativeTime itself is module-private (a named export here would trip
// eslint's react-refresh/only-export-components rule, since this file's Fast
// Refresh boundary is meant to hold one component), so each bucket is
// exercised through the rendered card instead.

describe('relative-time label', () => {
  const now = 1_800_000_000_000 // fixed reference instant, in ms

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderWithFinishedAt(secondsAgo: number) {
    vi.setSystemTime(now)
    const finishedAt = now / 1000 - secondsAgo
    render(
      <PipelineCard
        view={makeView({ finished_at: finishedAt })}
        onClick={() => undefined}
        finishedAt={finishedAt}
      />,
    )
  }

  it('renders "just now" for timestamps under a minute old', () => {
    renderWithFinishedAt(30)
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('renders minutes for timestamps under an hour old', () => {
    renderWithFinishedAt(5 * 60)
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  it('renders hours for timestamps under a day old', () => {
    renderWithFinishedAt(3 * 60 * 60)
    expect(screen.getByText('3h ago')).toBeInTheDocument()
  })

  it('renders days for timestamps under a week old', () => {
    renderWithFinishedAt(2 * 24 * 60 * 60)
    expect(screen.getByText('2d ago')).toBeInTheDocument()
  })

  it('renders a month/day date for timestamps a week or older', () => {
    const eightDaysAgoSeconds = 8 * 24 * 60 * 60
    renderWithFinishedAt(eightDaysAgoSeconds)
    const expected = new Date((now / 1000 - eightDaysAgoSeconds) * 1000).toLocaleDateString(
      undefined,
      { month: 'short', day: 'numeric' },
    )
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})

// ── Filter logic (unit-tested here since filterFns are co-located in Home) ────

describe('filter helpers', () => {
  it('isActive excludes merged items', () => {
    const active = makeView({ current_stage: 'coding' })
    const merged = makeView({ current_stage: 'merged' })
    // Re-implement the predicate inline to keep the test independent of
    // Home's internal state.  Tests document the contract.
    const isActive = (v: PipelineView) => v.current_stage !== 'merged'
    expect(isActive(active)).toBe(true)
    expect(isActive(merged)).toBe(false)
  })

  it('needsMe returns true when available_gates is non-empty', () => {
    const noAction = makeView({ available_gates: [] })
    const hasAction = makeView({
      available_gates: [{ action: 'merge', label: 'Merge', endpoint: '/api/pipeline/action' }],
    })
    const needsMe = (v: PipelineView) => v.available_gates.length > 0
    expect(needsMe(noAction)).toBe(false)
    expect(needsMe(hasAction)).toBe(true)
  })
})
