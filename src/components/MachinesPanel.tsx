/**
 * MachinesPanel — the Machines panel's list-slot content (#61, re-wired by
 * #76).
 *
 * `ShellLayout` owns the frame (rail, status bar) and renders this component
 * into the list slot for the `/machines` route, same convention
 * `DriveQueuePanel`/`ReportsPanel`/`AnswersPanel` document for their own
 * routes. Rows navigate to `/machines/:name` (`MachineDetail`) — the same
 * list -> detail convention `SessionsList` -> `SessionDetail` already
 * establishes.
 *
 * #61 was the scaffolding story for milestone #4 (Machines panel): the API
 * client, wire types, route and rail entry, plus the honest-degrade shell
 * below (`result.available === false`) for a coord server old enough to
 * predate the Machines API entirely.
 *
 * #62 filled in the roster row content; #66 added the fleet-level aggregate
 * (`FleetSummary`, `src/components/FleetSummary.tsx`) above it. #76 found
 * both had been built against a `/api/machines` shape and a
 * `MachineState.severity` field that claude-coordinator never shipped --
 * this file now fetches the roster (`fetchMachines`) and the real
 * `GET /api/machines/health` fleet-wide response (`fetchMachinesHealth`) in
 * parallel, joins severity onto the roster by name (`joinMachineSeverity`),
 * and fetches fleet worker capacity (`fetchFleetCapacity`,
 * `GET /api/machines/stats`) separately -- three real, fleet-wide endpoints,
 * each fetched once, rather than the never-built per-machine surface the
 * pre-#76 version assumed.
 */
import { ServerOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { fetchFleetCapacity, fetchMachines, fetchMachinesHealth, joinMachineSeverity } from '@/api/client'
import FleetSummary from '@/components/FleetSummary'
import { MachinesList } from '@/components/MachinesList'
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
  const { data: healthResult } = useQuery({
    queryKey: ['machines-health'],
    queryFn: fetchMachinesHealth,
  })
  const { data: capacityResult } = useQuery({
    queryKey: ['fleet-capacity'],
    queryFn: fetchFleetCapacity,
  })

  const machines = result?.available ? result.data : []
  const health = healthResult?.available ? healthResult.data : null
  const severityMap = joinMachineSeverity(machines, health)
  const fleetChecks = health?.fleet_checks ?? []
  const capacity = capacityResult?.available ? capacityResult.data : null

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-4">
      <PanelHeader
        title="Machines"
        count={result?.available ? machines.length : undefined}
        countLabel="known"
      />

      {result?.available && machines.length > 0 && (
        <FleetSummary
          machines={machines}
          severityMap={severityMap}
          fleetChecks={fleetChecks}
          capacity={capacity}
        />
      )}

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
        <MachinesList
          machines={machines}
          severityMap={severityMap}
          onSelect={(name) => navigate(paths.machineItem(name))}
        />
      )}
    </div>
  )
}
