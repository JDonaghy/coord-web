/**
 * MachineDetail — the detail slot for one machine, at `/machines/:name`
 * (#61).
 *
 * Mirrors `SessionDetail`'s shape (panel content, not a screen; a back
 * control) for the same list -> detail addressing convention, but reads four
 * independent endpoints instead of one (`fetchMachine`/`fetchMachineHealth`/
 * `fetchMachineWorkStats`/`fetchMachineMetrics`, all `src/api/client.ts`) —
 * state, health, work stats and metrics are separate routes on the Machines
 * API (claude-coordinator#3027), not one payload.
 *
 * Each section degrades on its own: a coord server that doesn't serve
 * #3027's routes yet 404s every one of them, and `MachineQueryResult`'s
 * `{available: false}` renders here as an honest per-section "unavailable"
 * note rather than an empty table/chart that would misreport as "this
 * machine really has zero health checks" — issue #61's explicit acceptance
 * bar. Degrading independently (rather than one panel-wide fallback) means a
 * server that ships state+health before work-stats+metrics (or vice versa)
 * still shows whatever it actually has.
 */
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import {
  fetchMachine,
  fetchMachineHealth,
  fetchMachineMetrics,
  fetchMachineWorkStats,
} from '@/api/client'

const detailShellClass = 'mx-auto w-full max-w-3xl px-4 py-5 md:px-6'

function UnavailableNote({ label }: { label: string }) {
  return (
    <p role="status" className="text-xs text-muted-foreground">
      {label} unavailable — this coord server doesn't serve it yet.
    </p>
  )
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
      <h1 className="text-step-1 font-semibold text-foreground">
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
  const health = healthQuery.data?.available ? healthQuery.data.data : null
  const workStats = workStatsQuery.data?.available ? workStatsQuery.data.data : null
  const metrics = metricsQuery.data?.available ? metricsQuery.data.data : null

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
          <div className="flex items-center gap-2 text-sm">
            <span className={state.reachable ? 'font-medium text-pass' : 'font-medium text-muted-foreground'}>
              {state.reachable ? 'online' : 'offline'}
            </span>
            {state.host && <span className="font-mono text-xs text-muted-foreground">{state.host}</span>}
          </div>
        ) : (
          <p className="text-sm text-destructive">Failed to load machine state</p>
        )}
      </section>

      <section className="mb-6" aria-label="Health">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">Health</h2>
        {healthQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : healthQuery.data && !healthQuery.data.available ? (
          <UnavailableNote label="Health checks" />
        ) : health && health.length > 0 ? (
          <ul className="space-y-1">
            {health.map((row) => (
              <li key={row.check} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{row.check}</span>
                <span className="font-mono text-xs text-muted-foreground">{row.status}</span>
              </li>
            ))}
          </ul>
        ) : health ? (
          <p className="text-sm text-muted-foreground">No health checks reported.</p>
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
        ) : metrics && metrics.length > 0 ? (
          // Series listing only -- charting the points themselves is later
          // M-4 scope (this story is the data plumbing, not the chart).
          <ul className="space-y-1">
            {metrics.map((series) => (
              <li key={series.metric} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{series.metric}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {series.points.length} points
                </span>
              </li>
            ))}
          </ul>
        ) : metrics ? (
          <p className="text-sm text-muted-foreground">No metrics reported.</p>
        ) : (
          <p className="text-sm text-destructive">Failed to load metrics</p>
        )}
      </section>
    </div>
  )
}
