/**
 * MachinesList — per-row rendering for the Machines list panel (#62, re-wired
 * by #76).
 *
 * #76 found the roster this component renders never carried the fields the
 * original #62 parity pass assumed (`severity`/`reachable`/`is_local`/the
 * three pause flags/`concurrency_limit` — none of them exist on a real
 * `GET /api/machines` response). What a live roster row actually carries is
 * `name`/`host`/`state`/`reason`/`latency_ms`/`agent_version`/`repos`/
 * `assignments`/`worktree_bytes` (`MachineState`, `src/api/client.ts`).
 * Severity is real, but lives on `GET /api/machines/health` instead, joined
 * onto a roster row by name (`joinMachineSeverity`) — `MachinesPanel` does
 * that join once and passes the result down as `severityMap` rather than
 * this component reading a field that was never there.
 *
 * The honesty rule #62 called out survives the re-wire unchanged: a missing
 * `severityMap` entry (a machine the health endpoint hasn't reported on)
 * reads as `'unknown'`, never silently as `'ok'` — enforced here via
 * `SeverityBadge`'s own fallback (see that function's doc comment) rather
 * than trusting every caller to pre-fill the map.
 */
import { cn } from '@/lib/utils'
import type { MachineState, Severity } from '@/api/client'

const SEVERITY_INFO: Record<Severity, { label: string; className: string }> = {
  ok: { label: 'ok', className: 'bg-pass-wash text-pass' },
  warn: { label: 'warn', className: 'bg-attn-wash text-attn' },
  crit: { label: 'crit', className: 'bg-fail-wash text-fail' },
  // Deliberately its own colour (idle, not pass/attn/fail) -- see this
  // file's header re: the honesty rule.
  unknown: { label: 'unknown', className: 'bg-idle-wash text-idle' },
}

/**
 * Exported for `MachineDetail` (#63), which needs the identical severity
 * badge in its own status line -- one visual vocabulary for "how healthy is
 * this machine" across the list and detail views.
 *
 * Falls back to `'unknown'` for any value this build doesn't recognize --
 * including `undefined`/`null` from a version-skewed or malformed response
 * -- rather than indexing `SEVERITY_INFO` with a key it doesn't have
 * (issue #76's actual crash: `SEVERITY_INFO[undefined]` was `undefined`,
 * and `.className` on that threw, white-screening the whole app). Epic
 * #68's standing rule applies verbatim: "unknown is never ok" and "Version
 * skew is real … Degrade, don't crash."
 */
export function SeverityBadge({ severity }: { severity: Severity | null | undefined }) {
  const info = SEVERITY_INFO[severity as Severity] ?? SEVERITY_INFO.unknown
  return (
    <span
      data-testid="severity-badge"
      className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', info.className)}
    >
      {info.label}
    </span>
  )
}

export interface MachinesListProps {
  machines: MachineState[]
  /** This machine's joined severity, keyed by name (`joinMachineSeverity`,
   * `src/api/client.ts`) — the server's own `_effective_severity` verdict
   * from `GET /api/machines/health`, never re-derived here. A name absent
   * from this map (the health endpoint hasn't reported on it) renders via
   * `SeverityBadge`'s own `'unknown'` fallback. */
  severityMap: Record<string, Severity>
  onSelect: (name: string) => void
}

export function MachinesList({ machines, severityMap, onSelect }: MachinesListProps) {
  return (
    <section className="space-y-2" aria-label="Machines">
      {machines.map((machine) => (
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
              <SeverityBadge severity={severityMap[machine.name]} />
              {/* `state` is an open-vocabulary string straight off the wire
                  (`MachineState.state`'s doc comment) -- rendered verbatim
                  rather than mapped through an assumed "online"/"offline"
                  enum this repo has never had a confirmed value set for. */}
              <span className="text-xs text-muted-foreground">{machine.state}</span>
            </div>
          </div>

          {(machine.agent_version || machine.reason) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {machine.agent_version && (
                <span data-testid="agent-version" className="font-mono">
                  {machine.agent_version}
                </span>
              )}
              {machine.reason && <span>{machine.reason}</span>}
            </div>
          )}
        </button>
      ))}
    </section>
  )
}
