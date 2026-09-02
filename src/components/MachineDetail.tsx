/**
 * MachineDetail — the detail slot for one machine, at `/machines/:name`
 * (#61, #63, re-wired by #76).
 *
 * Mirrors `SessionDetail`'s shape (panel content, not a screen; a back
 * control) for the same list -> detail addressing convention, but reads
 * several independent pieces of derived data instead of one
 * (`fetchMachine`/`fetchMachineHealth`/`fetchMachineWorkStats`/
 * `fetchMachineMetrics`/`fetchMachineWorkers`/`fetchMachineJobs`, all
 * `src/api/client.ts`) — state, health, work stats, metrics, active workers
 * and job history read from four different fleet-wide endpoints
 * (`/api/machines`, `/api/machines/health`, `/api/machines/metrics`,
 * `/api/machines/stats`), each already filtered/joined to this one machine
 * by `src/api/client.ts`'s convenience wrappers, not five separate
 * per-machine routes -- see that file's Machines-section header for the
 * full #76 mapping.
 *
 * Each section still degrades on its own: `MachineQueryResult`'s
 * `{available: false}` renders here as an honest per-section "unavailable"
 * note rather than an empty table/chart that would misreport as "this
 * machine really has zero health checks" -- issue #61's original acceptance
 * bar, unchanged by #76's re-wire. Degrading independently (rather than one
 * panel-wide fallback) means a coord server that's missing just one of the
 * four real endpoints still shows whatever it actually has.
 *
 * #76 dropped two things #63 built against fields the real API never had:
 * the "this machine" / "remote" locality badge and agent-version drift
 * highlighting (both needed `MachineState.is_local`, which doesn't exist —
 * there is no confirmed way to identify "the machine coord-web is served
 * from" from the roster alone) and the active-workers "N / ceiling" count
 * (needed a per-machine `concurrency_limit`, which also doesn't exist; only
 * a fleet-wide capacity total does, `FleetSummary`'s own job). The TUI's
 * write actions (restart/update/clean, routing-pause / quiet-hours menu)
 * remain explicitly out of scope — no endpoints exist for them either.
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
} from '@/api/client'
import MachineCharts from '@/components/MachineCharts'
import MachineHealth from '@/components/MachineHealth'
import { SeverityBadge } from '@/components/MachinesList'
import { issueRef } from '@/lib/repoRef'
import { formatRelativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'

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

function BackHeader({ name }: { name: string }) {
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
  const workers = workersQuery.data?.available ? workersQuery.data.data : null
  const jobs = jobsQuery.data?.available ? jobsQuery.data.data : null
  const health = healthQuery.data?.available ? healthQuery.data.data : null
  const workStats = workStatsQuery.data?.available ? workStatsQuery.data.data : null
  const metrics = metricsQuery.data?.available ? metricsQuery.data.data : null

  const workerCount = workers ? workers.length : null

  if (!name) {
    return (
      <div className={detailShellClass}>
        <BackHeader name="Not found" />
        <p className="text-sm text-muted-foreground">No machine name given.</p>
      </div>
    )
  }

  return (
    <div className={detailShellClass}>
      <BackHeader name={name} />

      <section className="mb-6" aria-label="State">
        {machineQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : machineQuery.data && !machineQuery.data.available ? (
          <UnavailableNote label="Machine state" />
        ) : state ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <SeverityBadge severity={health?.severity} />
              <span className="font-medium text-foreground">{state.state}</span>
              {state.host && (
                <span className="font-mono text-xs text-muted-foreground">{state.host}</span>
              )}
              {state.latency_ms !== null && (
                <span className="text-xs text-muted-foreground">{state.latency_ms} ms</span>
              )}
              {state.reason && (
                <span className="text-xs text-muted-foreground">{state.reason}</span>
              )}
            </div>
            {(state.agent_version || state.worktree_bytes !== null) && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {state.agent_version && (
                  <span data-testid="agent-version" className="font-mono">
                    agent {state.agent_version}
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
                key={worker.assignment_id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {worker.assignment_id}
                  </span>
                  {worker.spec?.repo_name && worker.spec.issue_number !== undefined && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {issueRef(worker.spec.repo_name, worker.spec.issue_number)}
                    </span>
                  )}
                </div>
                {/* No dispatch timestamp travels on this row (the real
                    `/api/machines` schema, unlike the pre-#76 invented one,
                    carries no `started_at`) -- status is the only live
                    signal available per assignment. */}
                <span className="shrink-0 text-xs text-muted-foreground">{worker.status}</span>
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
                  key={job.assignment_id}
                  data-testid={failed ? 'job-row-failed' : 'job-row'}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded px-2 py-1 text-sm',
                    failed && 'bg-fail-wash',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {job.issue_number !== null && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {issueRef(job.repo_name, job.issue_number)}
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
          // CPU/memory time-series charts (#65, M-4, trimmed to what the
          // real endpoint actually reports by #76) -- each degrades on its
          // own (`MachineCharts`'s own per-metric `machineChartPlan`) when
          // this machine hasn't reported a given metric yet, rather than one
          // panel-wide fallback.
          <MachineCharts metrics={metrics} />
        ) : (
          <p className="text-sm text-destructive">Failed to load metrics</p>
        )}
      </section>
    </div>
  )
}
