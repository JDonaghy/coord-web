/**
 * MachinesList — per-row rendering for the Machines list panel (#62).
 *
 * Parity reference is coord-tui's `machines_list` (`coord-tui/src/app/mod.rs`):
 * each row surfaces reachability, the rolled-up health severity, agent
 * version drift against the local machine, and the quiet-hours / hand-pause
 * / release-cordon badge set. `MachinesPanel` (#61) owns fetching + the
 * loading/error/honest-unavailable/empty-roster states; this component is
 * purely presentational (`machines` in, `onSelect` out) so it can be
 * unit-tested per row without a `QueryClientProvider` — the same split
 * `SessionsList`/`SessionCard` already establish.
 *
 * Two things this file exists to get right, both called out explicitly in
 * #62:
 *
 *  - `severity: 'unknown'` is a first-class state, not a styling variant of
 *    `'ok'` — a machine the daemon can't currently vouch for must never read
 *    as healthy (the same rule `_effective_severity` enforces server-side).
 *  - quiet-hours pause, hand pause, and release cordon are three
 *    independent badges, never collapsed into one "paused" pill — a machine
 *    can be in any combination of the three at once (e.g. hand-paused
 *    *and* cordoned for a release).
 */
import { cn } from '@/lib/utils'
import type { MachineState } from '@/api/client'

export type Severity = MachineState['severity']

const SEVERITY_INFO: Record<Severity, { label: string; className: string }> = {
  ok: { label: 'ok', className: 'bg-pass-wash text-pass' },
  warn: { label: 'warn', className: 'bg-attn-wash text-attn' },
  crit: { label: 'crit', className: 'bg-fail-wash text-fail' },
  // Deliberately its own colour (idle, not pass/attn/fail) -- see this
  // file's header re: the honesty rule.
  unknown: { label: 'unknown', className: 'bg-idle-wash text-idle' },
}

/** Exported for `MachineDetail` (#63), which needs the identical severity
 * badge in its own status line -- one visual vocabulary for "how healthy is
 * this machine" across the list and detail views. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const info = SEVERITY_INFO[severity]
  return (
    <span
      data-testid="severity-badge"
      className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', info.className)}
    >
      {info.label}
    </span>
  )
}

/** The three pause/cordon badges, each independently shown -- never merged
 * into a single "paused" label (#62). */
function PauseBadges({ machine }: { machine: MachineState }) {
  return (
    <>
      {machine.quiet_hours_paused && (
        <span
          data-testid="badge-quiet-hours"
          className="rounded-full bg-idle-wash px-2 py-0.5 text-xs font-medium text-idle"
        >
          quiet hours
        </span>
      )}
      {machine.hand_paused && (
        <span
          data-testid="badge-hand-pause"
          className="rounded-full bg-attn-wash px-2 py-0.5 text-xs font-medium text-attn"
        >
          paused
        </span>
      )}
      {machine.release_cordoned && (
        <span
          data-testid="badge-release-cordon"
          className="rounded-full bg-fail-wash px-2 py-0.5 text-xs font-medium text-fail"
        >
          cordoned
        </span>
      )}
    </>
  )
}

export interface MachinesListProps {
  machines: MachineState[]
  onSelect: (name: string) => void
}

export function MachinesList({ machines, onSelect }: MachinesListProps) {
  // The version-drift reference point: the machine hosting this coord
  // daemon itself, not some separately-tracked "latest release" value (see
  // `MachineState.is_local`'s doc comment, api/generated.ts).
  const localVersion = machines.find((m) => m.is_local)?.agent_version ?? null

  return (
    <section className="space-y-2" aria-label="Machines">
      {machines.map((machine) => {
        const drift =
          !machine.is_local &&
          localVersion !== null &&
          machine.agent_version !== null &&
          machine.agent_version !== localVersion

        return (
          <button
            key={machine.name}
            type="button"
            data-testid={`machine-row-${machine.name}`}
            onClick={() => onSelect(machine.name)}
            className="flex w-full flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-secondary/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-card-foreground">{machine.name}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <SeverityBadge severity={machine.severity} />
                <span
                  className={
                    machine.reachable ? 'text-xs text-pass' : 'text-xs text-muted-foreground'
                  }
                >
                  {machine.reachable ? 'online' : 'offline'}
                </span>
              </div>
            </div>

            {(machine.quiet_hours_paused ||
              machine.hand_paused ||
              machine.release_cordoned ||
              machine.agent_version) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <PauseBadges machine={machine} />
                {machine.agent_version && (
                  <span
                    data-testid="agent-version"
                    className={cn(
                      'font-mono text-xs',
                      drift ? 'font-semibold text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {machine.agent_version}
                  </span>
                )}
              </div>
            )}
          </button>
        )
      })}
    </section>
  )
}
