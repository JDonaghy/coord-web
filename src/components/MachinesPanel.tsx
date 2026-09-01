/**
 * MachinesPanel — the Machines panel's list-slot content (#61).
 *
 * `ShellLayout` owns the frame (rail, status bar) and renders this component
 * into the list slot for the `/machines` route, same convention
 * `DriveQueuePanel`/`ReportsPanel`/`AnswersPanel` document for their own
 * routes. Rows navigate to `/machines/:name` (`MachineDetail`) — the same
 * list -> detail convention `SessionsList` -> `SessionDetail` already
 * establishes.
 *
 * This is the scaffolding story for milestone #4 (Machines panel): the API
 * client, wire types, route and rail entry — not the metrics/health grid
 * itself, which lands in later M-4 stories once `fetchMachines()`
 * (`src/api/client.ts`) has a real `claude-coordinator#3027` route to call.
 * Every coord server running today 404s that call, so the honest-degrade
 * path below (`result.available === false`) is this component's *normal*
 * rendering today, not an edge case — see `fetchMachines`'s and
 * `MachineQueryResult`'s doc comments for why that's a distinct state from
 * "loaded, zero machines" rather than an empty list indistinguishable from
 * a real empty roster.
 */
import { ServerOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { fetchMachines } from '@/api/client'
import { PanelHeader } from '@/components/PanelHeader'
import { paths } from '@/routes/paths'

export default function MachinesPanel() {
  const navigate = useNavigate()
  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['machines'],
    queryFn: fetchMachines,
  })

  const machines = result?.available ? result.data : []

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4">
      <PanelHeader
        title="Machines"
        count={result?.available ? machines.length : undefined}
        countLabel="known"
      />

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading machines…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load machines</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {/* Honest "unavailable" — never rendered the same as a real empty
          roster (see this file's doc comment / issue #61's version-skew
          note). */}
      {result && !result.available && (
        <div
          data-testid="machines-unavailable"
          role="status"
          className="flex flex-col items-center gap-3 px-6 py-14 text-center"
        >
          <ServerOff className="h-7 w-7 text-faint" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Machines panel unavailable</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            This coord server doesn't serve the machines API yet — nothing to
            show until it's upgraded.
          </p>
        </div>
      )}

      {result?.available && machines.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-foreground">No machines</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Machines coord knows about show up here.
          </p>
        </div>
      )}

      {result?.available && machines.length > 0 && (
        <section className="space-y-2" aria-label="Machines">
          {machines.map((machine) => (
            <button
              key={machine.name}
              type="button"
              data-testid={`machine-row-${machine.name}`}
              onClick={() => navigate(paths.machineItem(machine.name))}
              className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-secondary/40"
            >
              <span className="font-mono text-sm text-card-foreground">{machine.name}</span>
              <span
                className={
                  machine.reachable ? 'text-xs text-pass' : 'text-xs text-muted-foreground'
                }
              >
                {machine.reachable ? 'online' : 'offline'}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}
