/**
 * MilestoneDetailPanel — one milestone's story, at
 * `/milestones/:repo/:number` (#91, over claude-coordinator#3072's
 * `GET /api/milestones/{repo}/{number}`).
 *
 * Three sections, in the order an operator asks the questions:
 *
 *  1. **Where is this milestone** — title, state, GitHub's closed/total, the
 *     work order's own done/total (a deliberately different number — see
 *     `src/lib/milestones.ts`).
 *  2. **Gate A** — the recorded sign-off, its `contract_sha`, and whether it
 *     is stale, i.e. the contract was amended *after* someone approved it.
 *     Stale renders as a full-width `role="alert"` bar, not a badge that can
 *     be missed. The contract itself is deliberately NOT re-rendered here:
 *     #90 already ships `/gate-a/:repo/:trackingIssue` (contract markdown +
 *     every rendered mock) and this section links across to it, exactly as
 *     issue #91 asks. `MilestoneGateAWire.href` is the API-side equivalent
 *     of that same link, which is why this file uses `paths.gateA(...)` (an
 *     app route) rather than following `href` (an API route).
 *  3. **The work order** — one row per entry, in the sequence the endpoint
 *     returned it. `## Work order` order is the whole reason that endpoint
 *     exists rather than reading GitHub milestone membership, so nothing
 *     here sorts, filters, or regroups `entries`.
 *
 * Degraded states, all rendered as themselves rather than as an empty
 * screen: endpoint absent (a coord server predating #3072 — the realistic
 * case for weeks, see `MilestonesPanel`'s header), handled 404 (unknown
 * repo/milestone), invalid shape (validated, not cast — #85), a milestone
 * with **no work order** (has no tracking epic, or its epic has no parseable
 * block — `has_work_order` tells those apart from a genuinely empty one),
 * and `gate_a === null` (a repo not opted into the oracle loop: a fact, not
 * an error).
 */
import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import {
  fetchMilestoneDetail,
  type MilestoneDetail,
  type MilestoneEntryWire,
  type MilestoneGateAWire,
} from '@/api/client'
import { MilestonesUnavailable, ProgressBar, RosterWarnings } from '@/components/MilestonesPanel'
import { Badge } from '@/components/ui/badge'
import { gateAStateLabel, gateAStateTone } from '@/lib/gateA'
import {
  entryDispatched,
  entryStateLabel,
  entryStateTone,
  gateAHeadline,
  gateAStale,
  gateCells,
  milestoneRef,
  shortSha,
} from '@/lib/milestones'
import { formatRelativeTime } from '@/lib/time'
import { paths } from '@/routes/paths'
import { issueRef } from '@/lib/repoRef'

const detailShellClass = 'mx-auto w-full max-w-3xl px-4 py-5 md:px-6'

function BackHeader({ label }: { label: string }) {
  const navigate = useNavigate()
  return (
    <header className="mb-4 flex items-center gap-3">
      <button
        type="button"
        aria-label="Back"
        onClick={() => navigate(paths.milestones())}
        className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="font-mono text-[.72rem] text-faint">{label}</span>
    </header>
  )
}

function GateASection({ detail }: { detail: MilestoneDetail }) {
  const gate: MilestoneGateAWire | null = detail.gate_a
  if (gate === null) {
    return (
      <section className="mb-5 rounded-lg border border-border bg-card px-3.5 py-3">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Gate A</h2>
        <p data-testid="gate-a-none" className="text-xs text-muted-foreground">
          {detail.repo_name} is not opted into the oracle loop, so this milestone has no Gate A.
        </p>
      </section>
    )
  }

  const stale = gateAStale(gate)
  return (
    <section className="mb-5 rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Gate A</h2>
        <Badge variant={gateAStateTone(gate.state)} data-testid="gate-a-state">
          {gateAStateLabel(gate.state)}
        </Badge>
        <span data-testid="gate-a-sha" className="font-mono text-[.7rem] text-faint">
          contract {shortSha(gate.contract_sha)}
        </span>
      </div>

      {/* Stale is the one state where a recorded approval and the current
          contract disagree — a full-width alert, never a badge alone. */}
      {stale && (
        <p
          role="alert"
          data-testid="gate-a-stale"
          className="mb-2 flex items-start gap-2 rounded-md border border-fail/40 bg-fail-wash px-3 py-2 text-xs text-foreground"
        >
          <AlertTriangle className="mt-px h-4 w-4 flex-none text-fail" aria-hidden="true" />
          <span>
            Sign-off is stale — approved against{' '}
            <code className="font-mono">{shortSha(gate.approved_contract_sha ?? '')}</code>, the
            contract is now <code className="font-mono">{shortSha(gate.contract_sha)}</code>.
          </span>
        </p>
      )}

      <p className="text-xs text-muted-foreground" data-testid="gate-a-headline">
        {gateAHeadline(gate)}
        {gate.verdict !== null && gate.actor !== null && (
          <>
            {' — '}
            {gate.verdict} by {gate.actor}
            {gate.recorded_at !== null && <> {formatRelativeTime(gate.recorded_at)}</>}
          </>
        )}
      </p>

      {gate.reason !== null && gate.verdict === null && (
        <p className="mt-1 text-xs text-faint" data-testid="gate-a-reason">
          {gate.reason}
        </p>
      )}

      {/* Link across to #90's panel rather than re-rendering the contract
          here — issue #91 asks for exactly this. Only possible when the
          milestone actually resolved a tracking epic; without one there is
          no `/gate-a/:repo/:trackingIssue` address to link to. */}
      {detail.tracking_issue !== null && (
        <Link
          to={paths.gateA(detail.repo_name, detail.tracking_issue)}
          data-testid="gate-a-link"
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
        >
          Open the Gate-A packet
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </section>
  )
}

function WorkOrderRow({ repo, entry }: { repo: string; entry: MilestoneEntryWire }) {
  const cells = gateCells(entry)
  const dispatched = entryDispatched(entry)
  return (
    <li
      data-testid={`work-order-entry-${String(entry.issue_number)}`}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2.5"
    >
      <div className="flex items-start gap-2">
        <span className="w-5 flex-none font-mono text-[.7rem] text-faint" data-testid="entry-position">
          {entry.position}
        </span>
        <span className="font-mono text-[.7rem] text-faint">{issueRef(repo, entry.issue_number)}</span>
        <span className="flex-1 text-sm text-foreground">{entry.title}</span>
        <Badge variant={entryStateTone(entry.state)} data-testid="entry-state">
          {entryStateLabel(entry.state)}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 font-mono text-[.68rem]">
        {cells.map((cell) => (
          <span key={cell.key} data-testid={`gate-${cell.key}`} className="text-muted-foreground">
            {cell.label}{' '}
            <span
              className={
                cell.value === null
                  ? 'text-faint'
                  : cell.tone === 'success'
                    ? 'text-pass'
                    : cell.tone === 'destructive'
                      ? 'text-fail'
                      : cell.tone === 'warning'
                        ? 'text-attn'
                        : 'text-foreground'
              }
            >
              {cell.value ?? '—'}
            </span>
          </span>
        ))}
        {!dispatched && (
          <span data-testid="entry-never-dispatched" className="text-faint">
            never dispatched
          </span>
        )}
        {entry.group !== null && <span className="text-faint">group {entry.group}</span>}
        {entry.after.length > 0 && (
          <span className="text-faint">after {entry.after.map((n) => `#${String(n)}`).join(', ')}</span>
        )}
      </div>
    </li>
  )
}

export default function MilestoneDetailPanel() {
  const params = useParams<{ repo: string; number: string }>()
  const repo = params.repo ?? ''
  const parsedNumber = Number(params.number)
  const number = Number.isInteger(parsedNumber) ? parsedNumber : Number.NaN

  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['milestone-detail', repo, number],
    queryFn: () => fetchMilestoneDetail(repo, number),
    enabled: repo !== '' && Number.isInteger(number),
  })

  if (!Number.isInteger(number)) {
    return (
      <div className={detailShellClass}>
        <BackHeader label={repo} />
        <MilestonesUnavailable
          kind="not-found"
          error={`"${String(params.number)}" is not a milestone number.`}
          testId="milestone-detail-unavailable"
        />
      </div>
    )
  }

  return (
    <div className={detailShellClass}>
      <BackHeader label={milestoneRef(repo, number)} />

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading milestone…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load milestone</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {result && !result.ok && (
        <MilestonesUnavailable
          kind={result.kind}
          error={result.kind === 'absent' ? undefined : result.error}
          testId="milestone-detail-unavailable"
        />
      )}

      {result?.ok && (
        <>
          <section className="mb-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="text-step-1 font-semibold text-foreground">{result.data.title}</h1>
              {result.data.oracle && <Badge variant="outline">oracle</Badge>}
              {result.data.state === 'closed' && <Badge variant="secondary">closed</Badge>}
            </div>
            <ProgressBar
              pct={
                result.data.open_issues + result.data.closed_issues === 0
                  ? 0
                  : Math.round(
                      (result.data.closed_issues /
                        (result.data.open_issues + result.data.closed_issues)) *
                        100,
                    )
              }
              tone="brand"
            />
            <p className="mt-2 font-mono text-[.7rem] text-muted-foreground" data-testid="detail-progress">
              {result.data.closed_issues}/{result.data.open_issues + result.data.closed_issues} issues
              closed
              {result.data.tracking_issue !== null && (
                <> · epic {issueRef(result.data.repo_name, result.data.tracking_issue)}</>
              )}
            </p>
          </section>

          <RosterWarnings warnings={result.data.warnings} />

          <GateASection detail={result.data} />

          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground">
              Work order{' '}
              <span className="font-mono text-[.7rem] font-normal text-faint">
                {result.data.entries.length} entries, in declared order
              </span>
            </h2>
            {result.data.entries.length === 0 ? (
              <div
                data-testid="work-order-empty"
                role="status"
                className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center"
              >
                <p className="text-sm font-medium text-foreground">No work order</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  {result.data.has_work_order
                    ? 'This milestone declares a work order, but it has no entries yet.'
                    : result.data.tracking_issue === null
                      ? 'No tracking epic was found for this milestone, so there is no ## Work order block to read.'
                      : "The tracking epic has no parseable ## Work order block, so there is no declared sequence to show."}
                </p>
              </div>
            ) : (
              <ol className="space-y-2">
                {result.data.entries.map((entry) => (
                  <WorkOrderRow
                    key={`${String(entry.position)}-${String(entry.issue_number)}`}
                    repo={result.data.repo_name}
                    entry={entry}
                  />
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}
