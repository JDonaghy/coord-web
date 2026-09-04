/**
 * Pure view-model helpers for the Milestones panel (#91, over
 * claude-coordinator#3072).
 *
 * Everything here is a *projection* of what `GET /api/milestones{,/…}`
 * already said — nothing re-derives a number the endpoint reports. That is
 * the same rule the endpoint itself follows against `coord plans` /
 * `coord gates` (see `MilestoneSummaryWire`'s doc comment in
 * `src/api/generated.ts`): a second computation would drift, and the drift
 * would be silent because both halves would look plausible.
 *
 * The one thing worth stating out loud, because it is easy to "fix" by
 * accident: **`MilestoneDetail.entries` is never sorted here.** It arrives in
 * the tracking epic's `## Work order` sequence, which is the whole reason
 * that endpoint reads the work order instead of GitHub milestone membership
 * (membership is a set; GitHub returns it in whatever order it likes). A
 * `.sort()` anywhere on that array destroys the only ordering signal the
 * response carries. `groupMilestonesByRepo` below is likewise
 * order-preserving for the same reason.
 */
import type {
  MilestoneEntryWire,
  MilestoneGateAWire,
  MilestoneSummaryWire,
} from '@/api/client'
import { repoAlias } from '@/lib/repoRef'

/**
 * `CW ms-4` — the repo's two-letter alias (`src/lib/repoRef.ts`, shared
 * verbatim with the TUI) plus the milestone number in the `ms-N` form
 * `coord gate-a`, `tests/acceptance/ms-N/` and the endpoint's own Gate-A
 * `reason` strings already use. Deliberately NOT `issueRef`'s `CW#4`: a
 * milestone number and an issue number live in different namespaces, and
 * `CW#4` would read as issue 4.
 */
export function milestoneRef(repo: string, number: number): string {
  return `${repoAlias(repo)} ms-${String(number)}`
}

/** Milestone-scoped progress: GitHub's own closed/total issue counters for
 * everything filed under the milestone. Deliberately distinct from
 * {@link workOrderProgress} — see that function. `total === 0` yields
 * `pct === 0` rather than `NaN`. */
export interface Progress {
  done: number
  total: number
  /** 0–100, rounded — for a bar's width, never rendered as a number. */
  pct: number
}

function progress(done: number, total: number): Progress {
  const safeTotal = Math.max(0, total)
  const safeDone = Math.min(Math.max(0, done), safeTotal)
  return {
    done: safeDone,
    total: safeTotal,
    pct: safeTotal === 0 ? 0 : Math.round((safeDone / safeTotal) * 100),
  }
}

/** Closed / (open + closed) — the milestone's own GitHub counters. */
export function milestoneProgress(m: MilestoneSummaryWire): Progress {
  return progress(m.closed_issues, m.open_issues + m.closed_issues)
}

/**
 * `work_order_done` / `work_order_total` — the *declared scope of automated
 * dispatch*, which is routinely a different number from
 * {@link milestoneProgress} and is not a bug when it is. A milestone can
 * carry issues nobody put in the work order (they count in the GitHub
 * numbers, not here), and a work order can name issues filed under no
 * milestone at all (the reverse).
 */
export function workOrderProgress(m: MilestoneSummaryWire): Progress {
  return progress(m.work_order_done, m.work_order_total)
}

/** True when every work-order node is done and there is at least one — the
 * "4 of 6 merged" story reaching its end. `false` for a milestone with no
 * work order, which is unknown, not complete. */
export function workOrderComplete(m: MilestoneSummaryWire): boolean {
  return m.has_work_order && m.work_order_total > 0 && m.work_order_done >= m.work_order_total
}

/**
 * Roster rows grouped by repo, **in first-appearance order** — both the
 * groups and the rows inside each group. The endpoint walks `config.repos`
 * in declaration order and `aggregate_repo_plans` orders each repo's
 * milestones; re-sorting here would replace an intentional order with an
 * alphabetical one.
 */
export function groupMilestonesByRepo(
  rows: readonly MilestoneSummaryWire[],
): Array<{ repo: string; milestones: MilestoneSummaryWire[] }> {
  const groups: Array<{ repo: string; milestones: MilestoneSummaryWire[] }> = []
  const index = new Map<string, number>()
  for (const row of rows) {
    const at = index.get(row.repo_name)
    if (at === undefined) {
      index.set(row.repo_name, groups.length)
      groups.push({ repo: row.repo_name, milestones: [row] })
    } else {
      groups[at].milestones.push(row)
    }
  }
  return groups
}

export type MilestoneTone = 'success' | 'warning' | 'destructive' | 'secondary' | 'outline'

/** One rendered gate cell of a work-order row. `value === null` means the
 * column has nothing to say for this entry (no verdict yet) and renders as a
 * dash — never as a pass, and never omitted, so the columns stay aligned
 * across rows. */
export interface GateCell {
  key: string
  label: string
  value: string | null
  tone: MilestoneTone
}

const TEST_TONES: Record<string, MilestoneTone> = {
  passed: 'success',
  failed: 'destructive',
  running: 'warning',
  skipped: 'secondary',
}

const REVIEW_VERDICT_TONES: Record<string, MilestoneTone> = {
  approve: 'success',
  'request-changes': 'destructive',
}

const STATUS_TONES: Record<string, MilestoneTone> = {
  merged: 'success',
  done: 'success',
  running: 'warning',
  pending: 'secondary',
  failed: 'destructive',
  cancelled: 'secondary',
  advisory: 'secondary',
}

/**
 * The four gate columns a work-order row shows, always in this order and
 * always all four — `entry.gates === null` (the board has no work-like row
 * for this issue at all: never dispatched) yields four empty cells rather
 * than a collapsed row, because "never dispatched" and "dispatched, no
 * verdict yet" are different facts and a row that silently loses its columns
 * conflates them. The *caller* distinguishes the two via
 * {@link entryDispatched}.
 */
export function gateCells(entry: MilestoneEntryWire): GateCell[] {
  const g = entry.gates
  return [
    {
      key: 'status',
      label: 'Status',
      value: g?.status ?? null,
      tone: (g?.status && STATUS_TONES[g.status]) || 'secondary',
    },
    {
      key: 'test',
      label: 'Test',
      value: g?.test_state ?? null,
      tone: (g?.test_state && TEST_TONES[g.test_state]) || 'secondary',
    },
    {
      key: 'smoke',
      label: 'Smoke',
      value: g?.smoke_test ?? null,
      tone: g?.smoke_test === 'pass' ? 'success' : g?.smoke_test === 'fail' ? 'destructive' : 'secondary',
    },
    {
      key: 'review',
      label: 'Review',
      // The verdict is the fact worth a column; `review_state` alone
      // ('dispatched') is progress, not an outcome, so it only shows when
      // there is no verdict yet.
      value: g?.review_verdict ?? g?.review_state ?? null,
      tone: (g?.review_verdict && REVIEW_VERDICT_TONES[g.review_verdict]) || 'secondary',
    },
  ]
}

/** Whether the board has any work-like row for this entry — see
 * `MilestoneGateColumnsWire`'s doc comment for why this is not the same
 * question as "does it have a verdict". */
export function entryDispatched(entry: MilestoneEntryWire): boolean {
  return entry.gates !== null
}

/** How a work-order entry's own issue state renders. `null` is a declared
 * node that could not be resolved to a live issue — shown as "unknown", not
 * guessed closed (the endpoint refuses to guess and so does this). */
export function entryStateLabel(state: MilestoneEntryWire['state']): string {
  if (state === null) return 'unresolved'
  return state
}

export function entryStateTone(state: MilestoneEntryWire['state']): MilestoneTone {
  if (state === 'closed') return 'success'
  if (state === 'open') return 'outline'
  return 'warning'
}

/**
 * The Gate-A summary's one-line headline, or `null` when there is nothing to
 * say. `stale` is called out explicitly because it is the only state where
 * a *recorded approval* and the *current contract* disagree — the sign-off
 * exists but no longer covers what is on the branch.
 */
export function gateAHeadline(gate: MilestoneGateAWire): string {
  switch (gate.state) {
    case 'approved':
      return 'Signed off'
    case 'stale':
      return 'Sign-off is stale — the contract changed after it was recorded'
    case 'changes':
      return 'Changes requested'
    case 'exempt':
      return 'Exempt from Gate A'
    default:
      return 'No verdict recorded'
  }
}

/** `true` exactly when the recorded verdict was keyed to a contract sha that
 * is no longer the current one. Read off the endpoint's own `state`, with
 * the sha comparison as a second, independent signal — either one being true
 * is enough to warn, since a server that reports `stale` without shas (or
 * differing shas without the state) is still telling us the same thing. */
export function gateAStale(gate: MilestoneGateAWire): boolean {
  if (gate.state === 'stale') return true
  return (
    gate.approved_contract_sha !== null &&
    gate.contract_sha !== '' &&
    gate.approved_contract_sha !== gate.contract_sha
  )
}

/** First 7 chars of a contract sha, or an em dash when the server reported
 * none (a contract it could not read at all). */
export function shortSha(sha: string): string {
  return sha === '' ? '—' : sha.slice(0, 7)
}
