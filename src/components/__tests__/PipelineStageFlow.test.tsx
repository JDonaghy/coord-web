/**
 * Component tests for `PipelineStageFlow` (#100) — the per-issue stage-flow
 * view: connected `Work → Test → Review → Uat → Merge` boxes each carrying
 * a leg count, plus the leg list below naming the machine each leg ran on.
 *
 * Mocks `fetchPipelineLegs`, same posture `MilestonesPanel.test.tsx` uses
 * for its own fetchers — the wire-shape contract itself is covered
 * separately by `src/api/__tests__/pipelineLegs.test.ts` against a verbatim
 * real-server capture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { PipelineStageFlow } from '@/components/PipelineStageFlow'
import type { MilestoneQueryResult, PipelineLegsResponse, PipelineView } from '@/api/client'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, fetchPipelineLegs: vi.fn() }
})

import { fetchPipelineLegs } from '@/api/client'

beforeEach(() => {
  vi.clearAllMocks()
})

function makeView(overrides: Partial<PipelineView> = {}): PipelineView {
  return {
    assignment_id: 'work-review-approved',
    issue_number: 4104,
    issue_title: 'stage: review approved',
    repo_name: 'claude-coordinator',
    machine_name: 'dellserver',
    current_stage: 'review_done',
    stages: [
      { name: 'coding', status: 'completed', is_current: false },
      { name: 'smoke', status: 'completed', is_current: false },
      { name: 'review', status: 'completed', is_current: true },
      { name: 'uat', status: 'skipped', is_current: false },
      { name: 'merge', status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 50,
    review_findings_pending: false,
    review_verdict: 'approve',
    review_verdict_original: null,
    review_verdict_override_reason: null,
    review_findings_body: null,
    test_verdict: 'passed',
    needs_attention: false,
    needs_attention_reason: null,
    needs_attention_detail: null,
    finished_at: 1749971600,
    ...overrides,
  }
}

const LEGS: PipelineLegsResponse = {
  repo_name: 'claude-coordinator',
  issue_number: 4104,
  legs: [
    {
      assignment_id: 'rev-review-approved',
      stage: 'review',
      status: 'done',
      machine_name: 'precision',
      dispatched_at: 1749971100,
      finished_at: 1749971600,
    },
    {
      assignment_id: 'work-review-approved',
      stage: 'work',
      status: 'done',
      machine_name: 'dellserver',
      dispatched_at: 1749970000,
      finished_at: 1749971000,
    },
  ],
}

function mockLegs(result: MilestoneQueryResult<PipelineLegsResponse>) {
  vi.mocked(fetchPipelineLegs).mockResolvedValue(result)
}

function renderFlow(view: PipelineView = makeView()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PipelineStageFlow view={view} />
    </QueryClientProvider>,
  )
}

describe('PipelineStageFlow', () => {
  it('renders the five connected stage boxes in order, each with its own leg count', async () => {
    mockLegs({ ok: true, data: LEGS })
    renderFlow()

    const list = await screen.findByRole('list', { name: 'Stage boxes' })
    const boxes = Array.from(list.querySelectorAll('[data-testid^="stage-box-"]'))
    expect(boxes.map((b) => b.getAttribute('data-testid'))).toEqual([
      'stage-box-coding',
      'stage-box-smoke',
      'stage-box-review',
      'stage-box-uat',
      'stage-box-merge',
    ])

    // Wait for the leg fetch to resolve and the boxes to re-render with
    // their real counts before asserting on them.
    await screen.findAllByTestId('leg-row')

    // Work leg (stage: 'work') maps onto the coding box; review leg onto review.
    expect(screen.getByTestId('stage-box-coding')).toHaveTextContent('Work')
    expect(screen.getByTestId('stage-box-coding')).toHaveTextContent('(1)')
    expect(screen.getByTestId('stage-box-review')).toHaveTextContent('Review')
    expect(screen.getByTestId('stage-box-review')).toHaveTextContent('(1)')
    // No leg type dispatches as 'uat' or 'merge' today (#100's own mapping
    // note) -- an honest zero, not a missing box.
    expect(screen.getByTestId('stage-box-uat')).toHaveTextContent('(0)')
    expect(screen.getByTestId('stage-box-merge')).toHaveTextContent('(0)')
  })

  it('names the machine each leg ran on, in the leg list below the boxes', async () => {
    mockLegs({ ok: true, data: LEGS })
    renderFlow()

    const rows = await screen.findAllByTestId('leg-row')
    expect(rows).toHaveLength(2)
    // Newest-dispatch-first, per the server's own promise -- review before work.
    expect(rows[0]).toHaveTextContent('Review')
    expect(rows[0]).toHaveTextContent('precision')
    expect(rows[1]).toHaveTextContent('Work')
    expect(rows[1]).toHaveTextContent('dellserver')
  })

  it('shows a live elapsed duration for an in-flight leg', async () => {
    mockLegs({
      ok: true,
      data: {
        repo_name: 'claude-coordinator',
        issue_number: 4101,
        legs: [
          {
            assignment_id: 'work-running',
            stage: 'work',
            status: 'running',
            machine_name: 'precision',
            dispatched_at: Date.now() / 1000 - 90,
            finished_at: null,
          },
        ],
      },
    })
    renderFlow(makeView({ issue_number: 4101 }))

    const row = await screen.findByTestId('leg-row')
    expect(row).toHaveTextContent('running')
    // ~90s elapsed, rendered as `Xm` via formatCompactDuration once past 60s.
    expect(row).toHaveTextContent(/\d+m\d+s|\d+s/)
    expect(screen.getByTestId('stage-box-coding')).toHaveTextContent(/\d+m\d+s|\d+s/)
  })

  it('renders an empty leg list as "no legs dispatched yet", not blank', async () => {
    mockLegs({ ok: true, data: { repo_name: 'r', issue_number: 1, legs: [] } })
    renderFlow(makeView({ repo_name: 'r', issue_number: 1 }))

    expect(await screen.findByText('No legs dispatched yet.')).toBeInTheDocument()
  })

  it('degrades to an explanatory note when the route is absent (older coord server)', async () => {
    mockLegs({ ok: false, kind: 'absent' })
    renderFlow()

    expect(
      await screen.findByText(/isn't available from this coord server yet/),
    ).toBeInTheDocument()
  })

  it('surfaces a handled not-found as a legible error', async () => {
    mockLegs({ ok: false, kind: 'not-found', error: "unknown repo 'nope'" })
    renderFlow(makeView({ repo_name: 'nope' }))

    expect(await screen.findByText("unknown repo 'nope'")).toBeInTheDocument()
  })
})
