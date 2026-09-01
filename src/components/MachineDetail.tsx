/**
 * MachineDetail — the detail slot for one machine, at `/machines/:name`
 * (#61, #63).
 *
 * Mirrors `SessionDetail`'s shape (panel content, not a screen; a back
 * control) for the same list -> detail addressing convention, but reads
 * several independent endpoints instead of one (`fetchMachine`/
 * `fetchMachines`/`fetchMachineHealth`/`fetchMachineWorkStats`/
 * `fetchMachineMetrics`/`fetchMachineWorkers`/`fetchMachineJobs`, all
 * `src/api/client.ts`) — state, roster, health, work stats, metrics, active
 * workers and job history are separate routes on the Machines API
 * (claude-coordinator#3027), not one payload.
 *
 * Each section degrades on its own: a coord server that doesn't serve
 * #3027's routes yet 404s every one of them, and `MachineQueryResult`'s
 * `{available: false}` renders here as an honest per-section "unavailable"
 * note rather than an empty table/chart that would misreport as "this
 * machine really has zero health checks" — issue #61's explicit acceptance
 * bar. Degrading independently (rather than one panel-wide fallback) means a
 * server that ships state+health before work-stats+metrics (or vice versa)
 * still shows whatever it actually has.
 *
 * #63 fills in the read-only half of coord-tui's `machine_detail_list`
 * (`app/mod.rs`) parity reference: identity (local-vs-remote), status +
 * last-contact age, agent-version drift, worktree disk footprint, ACTIVE
 * WORKERS (id/issue/type/repo/age + the machine's concurrency ceiling
 * alongside the count) and JOB HISTORY (recent jobs, failures visually
 * distinct). The TUI's write actions (restart/update/clean, routing-pause /
 * quiet-hours menu) are explicitly out of scope for this milestone — no
 * endpoints exist for them yet.
 */
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import {
  fetchMachine,
  fetchMachineHealth,
  fetchMachineJobs,
  fetchMachineMetrics,
  fetchMachineWorkers,
  fetchMachineWorkStats,
  fetchMachines,
} from '@/api/client'
import MachineCharts from '@/components/MachineCharts'
import MachineHealth from '@/components/MachineHealth'
import { SeverityBadge } from '@/components/MachinesList'
import { cn } from '@/lib/utils'
import { issueRef } from '@/lib/repoRef'
import { formatRelativeTime } from '@/lib/time'

const detailShellClass = 'mx-auto w-full max-w-3xl px-4 py-5 md:px-6'

/** `AssignmentStatus` values that count as a failure for JOB HISTORY's
 * "failures visually distinct" requirement (#63) -- mirrors the fail/pass
 * split `FAILED_STAGES` (`src/lib/pipeline.ts`) draws for pipeline stages,
 * but over job-level `AssignmentStatus` rather than a derived stage name. */
const FAILED_JOB_STATUSES = new Set(['failed', 'cancelled'])

function UnavailableNote({ label }: { label: string }) {
  return (
    <p role="status" className="text-xs text-muted-foreground">
      {label} unavailable — this coord server doesn't serve it yet.
    </p>
  )
}

/** Bytes -> "1.2 GB" style label, binary (1024) units, for the worktree
 * disk-footprint line (#63). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

function BackHeader({ name, isLocal }: { name: string; isLocal: boolean | null }) {
  const navigate = useNavigate()
  return (
    <header className="mb-5 flex items-center gap-3">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Back"
        className="-ml-1 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ←
      </button>
      <h1 className="flex items-center gap-2 text-step-1 font-semibold text-foreground">
        <span className="font-mono">{name}</span>
        {isLocal !== null && (
          <span
            data-testid="locality-badge"
            className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
          >
            {isLocal ? 'this machine' : 'remote'}
          </span>
        )}
      </h1>
    </header>
  )
}

export default function MachineDetail() {
  const { name = '' } = useParams<{ name: string }>()

  const machineQuery = useQuery({
    queryKey: ['machine', name],
    queryFn: () => fetchMachine(name),
    enabled: !!name,
  })
  // Same `queryKey` `MachinesPanel` (`src/components/MachinesPanel.tsx`)
  // uses for the roster fetch -- react-query serves this from that cache
  // when the user arrived via the machines list, rather than a second
  // network round trip. Needed here only for the version-drift reference
  // point: the roster entry with `is_local: true` (#62/#63).
  const machinesQuery = useQuery({
    queryKey: ['machines'],
    queryFn: fetchMachines,
  })
  const workersQuery = useQuery({
    queryKey: ['machine-workers', name],
    queryFn: () => fetchMachineWorkers(name),
    enabled: !!name,
  })
  const jobsQuery = useQuery({
    queryKey: ['machine-jobs', name],
    queryFn: () => fetchMachineJobs(name),
    enabled: !!name,
  })
  const healthQuery = useQuery({
    queryKey: ['machine-health', name],
    queryFn: () => fetchMachineHealth(name),
    enabled: !!name,
  })
  const workStatsQuery = useQuery({
    queryKey: ['machine-work-stats', name],
    queryFn: () => fetchMachineWorkStats(name),
    enabled: !!name,
  })
  const metricsQuery = useQuery({
    queryKey: ['machine-metrics', name],
    queryFn: () => fetchMachineMetrics(name),
    enabled: !!name,
  })

  const state = machineQuery.data?.available ? machineQuery.data.data : null
  const roster = machinesQuery.data?.available ? machinesQuery.data.data : null
  const workers = workersQuery.data?.available ? workersQuery.data.data : null
  const jobs = jobsQuery.data?.available ? jobsQuery.data.data : null
  const health = healthQuery.data?.available ? healthQuery.data.data : null
  const workStats = workStatsQuery.data?.available ? workStatsQuery.data.data : null
  const metrics = metricsQuery.data?.available ? metricsQuery.data.data : null

  // Version-drift reference point, same rule `MachinesList` applies (#62):
  // compare against the roster's own `is_local: true` entry, never a
  // separately-tracked "latest release" value, and never flag the local
  // machine (or an unknown version on either side) as drifted.
  const localVersion = roster?.find((m) => m.is_local)?.agent_version ?? null
  const versionDrift =
    !!state &&
    !state.is_local &&
    localVersion !== null &&
    state.agent_version !== null &&
    state.agent_version !== localVersion

  // Prefer this section's own fetched list for the live count -- falls back
  // to the roster row's `headless_workers` only while the workers endpoint
  // itself hasn't resolved (or 404s), so the header line still shows a
  // number rather than nothing.
  const workerCount = workers ? workers.length : (state?.headless_workers ?? null)

  if (!name) {
    return (
      <div className={detailShellClass}>
        <BackHeader name="Not found" isLocal={null} />
        <p className="text-sm text-muted-foreground">No machine name given.</p>
      </div>
    )
  }

  return (
    <div className={detailShellClass}>
      <BackHeader name={name} isLocal={state?.is_local ?? null} />

      <section className="mb-6" aria-label="State">
        {machineQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : machineQuery.data && !machineQuery.data.available ? (
          <UnavailableNote label="Machine state" />
        ) : state ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <SeverityBadge severity={state.severity} />
              <span
                className={
                  state.reachable ? 'font-medium text-pass' : 'font-medium text-muted-foreground'
                }
              >
                {state.reachable ? 'online' : 'offline'}
              </span>
              {state.host && (
                <span className="font-mono text-xs text-muted-foreground">{state.host}</span>
              )}
              {state.last_seen !== null && (
                <span className="text-xs text-muted-foreground">
                  last contact {formatRelativeTime(state.last_seen)}
                </span>
              )}
            </div>
            {(state.agent_version || state.worktree_bytes !== null) && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {state.agent_version && (
                  <span
                    data-testid="agent-version"
                    className={cn('font-mono', versionDrift && 'font-semibold text-destructive')}
                  >
                    agent {state.agent_version}
                    {versionDrift && ' (drift)'}
                  </span>
                )}
                {state.worktree_bytes !== null && (
                  <span data-testid="worktree-footprint">
                    worktrees {formatBytes(state.worktree_bytes)}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-destructive">Failed to load machine state</p>
        )}
      </section>

      <section className="mb-6" aria-label="Active workers">
        <h2 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-faint">
          <span>Active workers</span>
          {workerCount !== null && (
            <span data-testid="worker-ceiling" className="font-mono normal-case text-muted-foreground">
              {workerCount}
              {state?.concurrency_limit !== null && state?.concurrency_limit !== undefined
                ? ` / ${state.concurrency_limit}`
                : ''}
            </span>
          )}
        </h2>
        {workersQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : workersQuery.data && !workersQuery.data.available ? (
          <UnavailableNote label="Active workers" />
        ) : workers && workers.length > 0 ? (
          <ul className="space-y-1.5">
            {workers.map((worker) => (
              <li
                key={worker.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {worker.id}
                  </span>
                  <span className="text-foreground">{worker.type}</span>
                  {worker.repo && worker.issue !== null && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {issueRef(worker.repo, worker.issue)}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(worker.started_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : workers ? (
          <p className="text-sm text-muted-foreground">No active workers.</p>
        ) : (
          <p className="text-sm text-destructive">Failed to load active workers</p>
        )}
      </section>

      <section className="mb-6" aria-label="Job history">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
          Job history
        </h2>
        {jobsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : jobsQuery.data && !jobsQuery.data.available ? (
          <UnavailableNote label="Job history" />
        ) : jobs && jobs.length > 0 ? (
          <ul className="space-y-1.5">
            {jobs.map((job) => {
              const failed = FAILED_JOB_STATUSES.has(job.status)
              return (
                <li
                  key={job.id}
                  data-testid={failed ? 'job-row-failed' : 'job-row'}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded px-2 py-1 text-sm',
                    failed && 'bg-fail-wash',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {job.repo && job.issue !== null && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {issueRef(job.repo, job.issue)}
                      </span>
                    )}
                    <span
                      className={cn(
                        'text-xs font-medium',
                        failed ? 'text-fail' : 'text-muted-foreground',
                      )}
                    >
                      {job.status}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {job.finished_at !== null ? formatRelativeTime(job.finished_at) : 'in progress'}
                  </span>
                </li>
              )
            })}
          </ul>
        ) : jobs ? (
          <p className="text-sm text-muted-foreground">No job history.</p>
        ) : (
          <p className="text-sm text-destructive">Failed to load job history</p>
        )}
      </section>

      <section className="mb-6" aria-label="Health">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Health</h2>
        {healthQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : healthQuery.data && !healthQuery.data.available ? (
          <UnavailableNote label="Health checks" />
        ) : health ? (
          <MachineHealth snapshot={health} />
        ) : (
          <p className="text-sm text-destructive">Failed to load health checks</p>
        )}
      </section>

      <section className="mb-6" aria-label="Work stats">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Work stats</h2>
        {workStatsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : workStatsQuery.data && !workStatsQuery.data.available ? (
          <UnavailableNote label="Work stats" />
        ) : workStats ? (
          <p className="text-sm text-foreground">
            {workStats.assignments_completed} completed · {workStats.assignments_failed} failed
          </p>
        ) : (
          <p className="text-sm text-destructive">Failed to load work stats</p>
        )}
      </section>

      <section aria-label="Metrics">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Metrics</h2>
        {metricsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : metricsQuery.data && !metricsQuery.data.available ? (
          <UnavailableNote label="Metrics" />
        ) : metrics ? (
          // CPU/memory/disk/throughput time-series charts (#65, M-4) --
          // each degrades on its own (`MachineCharts`'s own per-metric
          // `machineChartPlan`/`machineChartMultiPlan`) when this machine
          // hasn't reported a given metric yet, rather than one panel-wide
          // fallback.
          <MachineCharts metrics={metrics} concurrencyLimit={state?.concurrency_limit ?? null} />
        ) : (
          <p className="text-sm text-destructive">Failed to load metrics</p>
        )}
      </section>
    </div>
  )
}
