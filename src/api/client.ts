/**
 * Typed API client for coord/dashboard/server.py.
 *
 * The wire types themselves (`Assignment`, `PipelineStage`, `PipelineGate`,
 * `PipelineView`, `AssignmentStatus`, `AssignmentType`, `TestVerdict`,
 * `PipelineAction`) are generated from the dashboard's OpenAPI spec — see
 * `./generated.ts` and `scripts/codegen.py` (#750, moved onto the OpenAPI
 * spec by #1550). Regenerate with `.venv/bin/python scripts/codegen.py`
 * after any Python dataclass field change; do not hand-edit the generated
 * file.
 *
 * Actions marked "(forthcoming)" in `PipelineAction`'s doc comment are
 * defined ahead of their backend implementation so TypeScript callers can
 * reference them; they will return HTTP 501 once the route exists but the
 * action isn't implemented, or 404 if the route itself isn't registered yet.
 * `DriveQueueAction` below follows the same convention ahead of DQW-2.
 */

import type {
  Assignment,
  AssignmentStatus,
  AssignmentType,
  BoardDriveQueueEntry,
  ChartSeries,
  ChartSpec,
  ColumnMeta,
  DriveQueueSummary,
  FleetCapacity,
  FleetChecks,
  GateAApprovalWire,
  GateAMockWire,
  GateAPacket,
  MachineActiveWorker,
  MachineAssignmentSpec,
  MachineAssignments,
  MachineCapacity,
  MachineHealthCheckResult,
  MachineHealthRow,
  MachineHealthSnapshot,
  MachineJobCounts,
  MachineJobHistoryEntry,
  MachineMetricPoint,
  MachineMetricsSample,
  MachineMetricsSeries,
  MachinesHealthResponse,
  MachinesMetricsResponse,
  MachineState,
  MachineStatsRow,
  MachineWorkStats,
  MilestoneDetail,
  MilestoneEntryWire,
  MilestoneGateAWire,
  MilestoneGateColumnsWire,
  MilestoneListResponse,
  MilestoneSummaryWire,
  PipelineAction,
  PipelineGate,
  PipelineStage,
  PipelineView,
  ReportCatalogue,
  ReportDef,
  ReportParam,
  ReportResult,
  RowIdentity,
  Severity,
  TestVerdict,
} from './generated'

export type {
  Assignment,
  AssignmentStatus,
  AssignmentType,
  BoardDriveQueueEntry,
  ChartSeries,
  ChartSpec,
  ColumnMeta,
  DriveQueueSummary,
  FleetCapacity,
  FleetChecks,
  GateAApprovalWire,
  GateAMockWire,
  GateAPacket,
  MachineActiveWorker,
  MachineAssignmentSpec,
  MachineAssignments,
  MachineCapacity,
  MachineHealthCheckResult,
  MachineHealthRow,
  MachineHealthSnapshot,
  MachineJobCounts,
  MachineJobHistoryEntry,
  MachineMetricPoint,
  MachineMetricsSample,
  MachineMetricsSeries,
  MachinesHealthResponse,
  MachinesMetricsResponse,
  MachineState,
  MachineStatsRow,
  MachineWorkStats,
  MilestoneDetail,
  MilestoneEntryWire,
  MilestoneGateAWire,
  MilestoneGateColumnsWire,
  MilestoneListResponse,
  MilestoneSummaryWire,
  PipelineAction,
  PipelineGate,
  PipelineStage,
  PipelineView,
  ReportCatalogue,
  ReportDef,
  ReportParam,
  ReportResult,
  RowIdentity,
  Severity,
  TestVerdict,
}

// ── GET /api/board ────────────────────────────────────────────────────────────

export interface BoardData {
  round_number: number
  active: Assignment[]
  /** Last 20 completed assignments. */
  completed: Assignment[]
}

// ── GET /api/sessions ────────────────────────────────────────────────────────

/**
 * One live `coord-*` interactive tmux session the phone can attach to via
 * `GET /ws/terminal/{session_id}` (#1066). Hand-written rather than
 * generated: the server builds this as a plain dict in `api_sessions`
 * (`coord/dashboard/server.py`), not from a Python dataclass, so it isn't a
 * `scripts/codegen.py` (#750) target — keep this in sync with the
 * `session_response` OpenAPI schema in `_openapi_spec()` by hand.
 */
export interface SessionInfo {
  /** == the assignment_id; also the `/ws/terminal/{session_id}` path param. */
  session_id: string
  /** The tmux session name, `coord-<session_id>`. */
  session_name: string
  machine: string | null
  /** The machine's Tailscale host. */
  host: string | null
  repo: string | null
  issue: number | null
  issue_title: string | null
  /** Assignment type — see `AssignmentType` in `./generated` for the real value set. */
  stage: string | null
  /** Assignment status — running/done/failed/advisory/... */
  status: string | null
  /** Is a client currently attached to the tmux session. */
  attached: boolean
  /** claude has exited but the tmux session is still up. */
  pane_dead: boolean
}

// ── GET /api/diff/{id} ────────────────────────────────────────────────────────

export interface DiffResult {
  diff: string
  /** "pr" when fetched from a GitHub PR; "compare" when fetched from the compare API. */
  source: 'pr' | 'compare'
}

// ── POST /api/pipeline/action ─────────────────────────────────────────────────

export interface PipelineActionRequest {
  assignment_id: string
  action: PipelineAction
  /** Additional payload fields for specific actions (e.g. verdict for test-verdict). */
  [key: string]: unknown
}

export interface PipelineActionResult {
  ok: boolean
  error?: string
  /** Machine that accepted the dispatched assignment (dispatch_review / dispatch_smoke). */
  machine_name?: string
  /** Assignment ID created by a dispatch action. */
  assignment_id?: string
  /** Events produced by a merge action. */
  events?: Array<{ kind: string; message: string }>
  /** Human-readable detail (post_findings). */
  detail?: string
}

// ── GET /api/drive-queue ─────────────────────────────────────────────────────

/** `GET /api/drive-queue`'s response shape — see `BoardDriveQueueEntry`/`DriveQueueSummary` in `./generated`. */
export interface DriveQueueData {
  entries: BoardDriveQueueEntry[]
  summary: DriveQueueSummary
}

// ── POST /api/drive-queue/action (forthcoming — DQW-2) ──────────────────────

/**
 * Actions supported by POST /api/drive-queue/action.
 *
 * Defined ahead of DQW-2's backend implementation landing on
 * claude-coordinator's `main` — same "(forthcoming)" convention as
 * `PipelineAction` above. Matches DQW-2's actual (currently in-review) server
 * implementation, `coord/dashboard/server.py`'s `api_drive_queue_action` on
 * branch `issue-2429-dqw-2-post-api-drive-queue-action-move-r`: this mirrors
 * the TUI's queue-mutation actions (`queue_unblock_selected` /
 * `queue_resume_selected` / move / remove), not `coord drive-queue`'s CLI
 * verb set (`coord/commands/drive_queue.py`) — the two don't share a verb
 * list, and in particular there is no `add` action here since queueing
 * happens elsewhere. Not yet a registered route on claude-coordinator main,
 * so calling this today 404s rather than 501s until DQW-2 merges.
 */
export type DriveQueueAction = 'move' | 'remove' | 'unblock' | 'resume'

export interface DriveQueueActionRequest {
  repo_name: string
  issue_number: number
  action: DriveQueueAction
  /** Additional payload fields for specific actions (e.g. to_position for move). */
  [key: string]: unknown
}

export interface DriveQueueActionResult {
  ok: boolean
  error?: string
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/** Same-origin base — webapp is served by coord/dashboard/server.py. */
const API_BASE = ''

/**
 * Every path this client fetches, in the served OpenAPI spec's own template
 * form (`{param}`, not an interpolated value) — the single source of truth
 * both the fetch helpers below build concrete URLs from AND
 * `e2e/api-routes.spec.ts` diffs against a real `GET /openapi.json` (#78).
 *
 * coord-web#76 shipped the Machines panel calling **eight** paths of which
 * **seven had never been built**, and every gate was green because nothing
 * checked a path literal against the real server at all. The fix isn't a
 * smarter check bolted on after the fact — it's that a path literal now
 * exists in exactly one place. A checker that parsed `fetch()` calls out of
 * source could always drift from what the helpers actually request; a
 * checker that imports this same map the helpers are built from cannot.
 *
 * Not included: `/ws/terminal/{session_id}` (`terminalWebSocketUrl` below) —
 * a WebSocket upgrade route, not a REST path, and absent from
 * `_openapi_spec()`'s own `paths` for the same reason.
 */
export const API_ROUTES = {
  board: '/api/board',
  pipeline: '/api/pipeline',
  driveQueue: '/api/drive-queue',
  driveQueueAction: '/api/drive-queue/action',
  sessions: '/api/sessions',
  machines: '/api/machines',
  machinesHealth: '/api/machines/health',
  machinesMetrics: '/api/machines/metrics',
  machinesStats: '/api/machines/stats',
  reportCatalogue: '/api/report',
  report: '/api/report/{report_id}',
  diff: '/api/diff/{id}',
  pipelineAction: '/api/pipeline/action',
  portalNeedsInput: '/api/portal/needs-input',
  portalAnswer: '/api/portal/answer',
  gateA: '/api/gate-a/{repo}/{tracking_issue}',
  milestones: '/api/milestones',
  milestoneDetail: '/api/milestones/{repo}/{number}',
} as const satisfies Record<string, string>

/**
 * Substitute `{param}` placeholders in an `API_ROUTES` template with
 * URI-encoded values — the one place a templated route turns into a
 * concrete URL, so `API_ROUTES` itself always stays in the spec's exact
 * `{name}` form for `e2e/api-routes.spec.ts` to diff against verbatim.
 */
function buildPath(template: string, params: Readonly<Record<string, string>>): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`{${key}}`, encodeURIComponent(value)),
    template,
  )
}

/**
 * A minimal runtime check on an `apiFetch`/`apiFetchOptional` response,
 * applied before it's handed to the caller as `T` — the guardrail issue #85
 * asks for, in response to #76 and #84 each shipping a declared shape that
 * disagreed with what the server actually sent (a bare array declared where
 * the wire sent an object envelope, or vice versa) and reaching a
 * component's render as a `TypeError` instead of a legible error.
 *
 * Deliberately narrow: this distinguishes "array" from "object carrying key
 * `k`", nothing finer — not a schema validator, not a replacement for
 * `generated.ts` staying in sync with the server by hand (see this file's
 * header). "Object with key k" rather than "object with exactly these
 * keys" is intentional: the server is free to add fields (or this client to
 * lag reading one) without every call site's guard going stale.
 */
export type ShapeGuard = { kind: 'array' } | { kind: 'object'; key: string }

/** Describe an actual response value for an `assertShape` error — `typeof`/
 * top-level keys only, per issue #85's acceptance bar: never the whole body,
 * which can be large and, for endpoints like the portal ones, may carry
 * user-entered issue text. */
function describeShape(data: unknown): string {
  if (Array.isArray(data)) return `array(length ${data.length})`
  if (data === null) return 'null'
  if (typeof data !== 'object') return typeof data
  return `object with keys [${Object.keys(data).join(', ')}]`
}

function describeExpectedShape(shape: ShapeGuard): string {
  return shape.kind === 'array' ? 'an array' : `an object with key "${shape.key}"`
}

/** Throws a descriptive `Error` — naming the request, the expected shape,
 * and the actual shape — when `data` doesn't match `shape`. A no-op when
 * `shape` is omitted: not every response has a guard defined yet, and an
 * absent guard must stay silent rather than reject. */
function assertShape(label: string, data: unknown, shape: ShapeGuard | undefined): void {
  if (!shape) return
  const matches =
    shape.kind === 'array'
      ? Array.isArray(data)
      : typeof data === 'object' && data !== null && !Array.isArray(data) && shape.key in data
  if (!matches) {
    throw new Error(
      `${label} → expected ${describeExpectedShape(shape)}, got ${describeShape(data)}`,
    )
  }
}

async function apiFetch<T>(path: string, init?: RequestInit, shape?: ShapeGuard): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  const label = `${init?.method ?? 'GET'} ${path}`
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${label} → HTTP ${res.status}: ${text}`)
  }
  const data = await res.json()
  assertShape(label, data, shape)
  return data as T
}

/**
 * The result of a query against an endpoint that may genuinely not exist on
 * the coord server answering this request — as opposed to `apiFetch`'s
 * posture (any non-2xx is a bug-shaped `Error`), used for endpoints where a
 * 404 is an *expected*, honest outcome rather than a failure to surface as
 * one. See `apiFetchOptional`'s doc comment for why this exists.
 */
export type MachineQueryResult<T> = { available: true; data: T } | { available: false }

/**
 * Like `apiFetch`, but a `404` resolves to `{available: false}` instead of
 * throwing — the version-skew case this repo's CLAUDE.md calls out:
 * `coord-web` auto-deploys to the live tool on its own timer, decoupled from
 * any `claude-coordinator` release, so the bundle **will** at some point be
 * newer than the API serving it. Every low-level `fetchMachines*` function
 * below is built on this rather than `apiFetch` for exactly that reason
 * (issue #61: "must degrade to an honest 'unavailable' state when an
 * endpoint 404s, not crash the panel or render an empty chart as zero") —
 * the real Machines API (`/api/machines`, `/api/machines/health`,
 * `/api/machines/metrics`, `/api/machines/stats`, verified by #76) is a
 * recent addition, so this 404 path is what keeps this client working
 * against any coord server old enough to predate it.
 *
 * Any other non-2xx is still a real error and still throws — a 404 here is
 * "this route doesn't exist," not "the machine doesn't exist," a distinction
 * a 5xx or a malformed request can't claim.
 */
async function apiFetchOptional<T>(path: string, shape?: ShapeGuard): Promise<MachineQueryResult<T>> {
  const res = await fetch(`${API_BASE}${path}`)
  if (res.status === 404) {
    return { available: false }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET ${path} → HTTP ${res.status}: ${text}`)
  }
  const data = await res.json()
  assertShape(`GET ${path}`, data, shape)
  return { available: true, data: data as T }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch the full board state (active + last-20 completed assignments). */
export async function fetchBoard(): Promise<BoardData> {
  return apiFetch<BoardData>(API_ROUTES.board, undefined, { kind: 'object', key: 'active' })
}

/** Fetch pipeline views for all work-type assignments. */
export async function fetchPipeline(): Promise<PipelineView[]> {
  return apiFetch<PipelineView[]>(API_ROUTES.pipeline, undefined, { kind: 'array' })
}

/**
 * Fetch the `coord drive` work queue in run order, plus a server-computed
 * aggregate summary (#2428 DQW-1). Pass `repo` to narrow `entries` to one
 * repo — `summary` is always computed over the full, unfiltered queue (see
 * `BoardDriveQueueEntry`'s doc comment for why).
 */
export async function fetchDriveQueue(repo?: string): Promise<DriveQueueData> {
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return apiFetch<DriveQueueData>(`${API_ROUTES.driveQueue}${query}`, undefined, {
    kind: 'object',
    key: 'entries',
  })
}

/** Fetch live coord-* interactive sessions the phone can take over (#1066). */
export async function fetchSessions(): Promise<SessionInfo[]> {
  return apiFetch<SessionInfo[]>(API_ROUTES.sessions, undefined, { kind: 'array' })
}

// ── GET /api/machines, /api/machines/health, /api/machines/metrics, ────────
// ── GET /api/machines/stats (#76) ───────────────────────────────────────────
//
// The real Machines API is exactly these four fleet-*wide* collection
// endpoints — there is no `/api/machines/{name}/...` route anywhere in
// claude-coordinator. Verified against a real server's own `GET
// /openapi.json` (a local `coord web --fixture` on the exact `coord==0.5.341`
// #76 cites), not the issue text alone — see `./generated.ts`'s "Machines
// panel" section header. The low-level `fetchMachines*`/`fetchMachinesStats`
// functions below each hit one of the four, once; every per-machine
// `fetchMachine*` function is a client-side filter/join over one of those
// four responses, not a fifth network call. All of them stay on
// `apiFetchOptional`, not `apiFetch`: a coord server old enough to predate
// even the real #76 routes still 404s them, and this panel must degrade to
// an honest "unavailable" note per section rather than crash or render an
// empty list/chart that would misreport as "zero machines" / "zero of this
// metric" (issue #61's original acceptance bar, unchanged by #76's re-wire).

/** Fetch the machine roster — every machine coord knows about, exactly the
 * fields a live server actually returns (see `MachineState`'s doc comment,
 * `./generated.ts`). Carries no `severity` — join `fetchMachinesHealth()`
 * onto this by name (`joinMachineSeverity`) for that. */
export async function fetchMachines(): Promise<MachineQueryResult<MachineState[]>> {
  return apiFetchOptional<MachineState[]>(API_ROUTES.machines, { kind: 'array' })
}

/** Fetch one machine's roster entry by name — filters `fetchMachines()`'s
 * result client-side; there is no real per-machine route to call instead
 * (#76's mapping table: "filter the roster client-side"). */
export async function fetchMachine(name: string): Promise<MachineQueryResult<MachineState>> {
  const result = await fetchMachines()
  if (!result.available) return result
  const machine = result.data.find((m) => m.name === name)
  return machine ? { available: true, data: machine } : { available: false }
}

/** Fetch every machine's health rollup + fleet-scope checks in one call —
 * `GET /api/machines/health`'s real response shape (`MachinesHealthResponse`,
 * `./generated.ts`). Low-level: `fetchMachineHealth`/`fetchFleetChecks`
 * below both build on this rather than issuing their own requests. */
export async function fetchMachinesHealth(): Promise<MachineQueryResult<MachinesHealthResponse>> {
  return apiFetchOptional<MachinesHealthResponse>(API_ROUTES.machinesHealth, {
    kind: 'object',
    key: 'machine_health',
  })
}

/** Fetch one machine's current health-check snapshot (severity/stale +
 * per-check results — see `MachineHealthSnapshot`'s doc comment for why
 * both pairs travel together, #64) by finding its row in
 * `fetchMachinesHealth()`'s `machine_health[]`. A machine present in the
 * roster but absent from `machine_health` (never reported) resolves to an
 * explicit "never polled" snapshot — the same shape `MachineHealth.tsx`
 * already renders as "No health data reported" — rather than
 * `{available: false}`, which is reserved for the *route* being missing,
 * not this one machine's data. */
export async function fetchMachineHealth(
  name: string,
): Promise<MachineQueryResult<MachineHealthSnapshot>> {
  const result = await fetchMachinesHealth()
  if (!result.available) return result
  const row = result.data.machine_health.find((r) => r.machine === name)
  if (!row) {
    return { available: true, data: { severity: 'unknown', stale: false, checked_at: null, results: [] } }
  }
  return {
    available: true,
    data: {
      severity: row.severity,
      stale: row.stale,
      checked_at: row.checked_at ?? null,
      results: row.results,
    },
  }
}

/** Fetch fleet-*scope* health checks (#66) — facts about the fleet as a
 * whole, not any one machine's (`FleetChecks`'s doc comment, `./generated.ts`).
 * `FleetSummary` folds these into the same severity rollup as every
 * machine's joined severity, per `coord.health.aggregate`'s counting rule. */
export async function fetchFleetChecks(): Promise<MachineQueryResult<FleetChecks>> {
  const result = await fetchMachinesHealth()
  if (!result.available) return result
  return { available: true, data: result.data.fleet_checks }
}

/** Join a roster onto a severity-per-machine map, `unknown` for any roster
 * entry `machineHealth` has no row for -- the one place `MachineState.severity`
 * gets synthesized, always from the server's own `_effective_severity`
 * verdict (`MachineHealthRow.severity`), never re-derived from raw roster
 * fields (#76's honesty requirement, mirroring #3023's contract). */
export function joinMachineSeverity(
  machines: readonly MachineState[],
  health: MachinesHealthResponse | null,
): Record<string, Severity> {
  const byName = new Map<string, MachineHealthRow>(
    (health?.machine_health ?? []).map((row) => [row.machine, row]),
  )
  const out: Record<string, Severity> = {}
  for (const m of machines) {
    out[m.name] = byName.get(m.name)?.severity ?? 'unknown'
  }
  return out
}

/** Fetch every machine's raw metrics samples in one call — `GET /api/
 * machines/metrics`'s real response shape (`MachinesMetricsResponse`,
 * `./generated.ts`), `machines{}` keyed by name, each an oldest-first
 * `MachineMetricsSample[]`. Low-level: `fetchMachineMetrics` below is the
 * per-machine convenience wrapper that also reshapes this into the named
 * series `MachineCharts.tsx` renders. */
export async function fetchMachinesMetrics(): Promise<MachineQueryResult<MachinesMetricsResponse>> {
  return apiFetchOptional<MachinesMetricsResponse>(API_ROUTES.machinesMetrics, {
    kind: 'object',
    key: 'machines',
  })
}

/** Reshape one machine's raw `MachineMetricsSample[]` into the two named
 * `MachineMetricsSeries` `MachineCharts.tsx`/`src/lib/machineCharts.ts`
 * chart (`cpu_pct`, `mem_pct`) — the real endpoint reports a fixed sample
 * shape per timestamp, not an open set of named series, so this is where
 * that reshaping happens once rather than in every chart consumer.
 * `status !== 'ok'` maps to an explicit `value: null` gap on both series for
 * that timestamp (#65's honesty rule: a failed poll is a gap, never
 * interpolated or plotted as `0`), independent of `cpu_percent`/
 * `mem_percent` already being individually nullable. */
function toMachineMetricsSeries(samples: readonly MachineMetricsSample[]): MachineMetricsSeries[] {
  return [
    {
      metric: 'cpu_pct',
      unit: '%',
      points: samples.map((s) => ({ t: s.timestamp, value: s.status === 'ok' ? s.cpu_percent : null })),
    },
    {
      metric: 'mem_pct',
      unit: '%',
      points: samples.map((s) => ({ t: s.timestamp, value: s.status === 'ok' ? s.mem_percent : null })),
    },
  ]
}

/** Fetch a machine's CPU/memory metrics series (`cpu_pct`/`mem_pct` — the
 * only two the real endpoint reports; see `toMachineMetricsSeries`'s doc
 * comment) by key-lookup into `fetchMachinesMetrics()`'s `machines{}`. A
 * machine this build's fleet-wide response doesn't mention resolves to `[]`
 * (available, just nothing to chart) — `machineChartPlan`
 * (`src/lib/machineCharts.ts`) already renders an empty series as its own
 * honest "hasn't reported this metric" degrade, so there is no separate
 * 404-shaped state to invent here. */
export async function fetchMachineMetrics(
  name: string,
): Promise<MachineQueryResult<MachineMetricsSeries[]>> {
  const result = await fetchMachinesMetrics()
  if (!result.available) return result
  return { available: true, data: toMachineMetricsSeries(result.data.machines[name] ?? []) }
}

/** Fetch every machine's stats row in one call — `GET /api/machines/stats`'s
 * real response shape (`MachineStatsRow[]`, `./generated.ts`): an array, one
 * row per machine, each carrying its own `capacity`/`counts`/`job_history` —
 * NOT the fleet-wide `{capacity, counts, job_history}` object earlier
 * (pre-verification) versions of this file guessed at. Low-level:
 * `fetchMachineWorkStats`/`fetchMachineJobs`/`fetchFleetCapacity` below all
 * build on this. */
export async function fetchMachinesStats(): Promise<MachineQueryResult<MachineStatsRow[]>> {
  return apiFetchOptional<MachineStatsRow[]>(API_ROUTES.machinesStats, { kind: 'array' })
}

/** Fetch a machine's completed/failed assignment counts, by name-lookup into
 * `fetchMachinesStats()`'s rows. A machine absent from the response (no
 * stats row at all) resolves to an explicit zero row, not
 * `{available: false}` — same "route missing vs this machine has nothing to
 * report" distinction `fetchMachineHealth` draws. */
export async function fetchMachineWorkStats(
  name: string,
): Promise<MachineQueryResult<MachineWorkStats>> {
  const result = await fetchMachinesStats()
  if (!result.available) return result
  const row = result.data.find((r) => r.name === name)
  return {
    available: true,
    data: {
      machine: name,
      assignments_completed: row?.counts.completed ?? 0,
      assignments_failed: row?.counts.failed ?? 0,
    },
  }
}

/** Fetch a machine's recent job history (#63's JOB HISTORY section —
 * status + age per row, most recent first) — already scoped to one machine
 * on the wire (`MachineStatsRow.job_history`), so this is a name-lookup, not
 * a filter over a flat fleet-wide array. */
export async function fetchMachineJobs(
  name: string,
): Promise<MachineQueryResult<MachineJobHistoryEntry[]>> {
  const result = await fetchMachinesStats()
  if (!result.available) return result
  const row = result.data.find((r) => r.name === name)
  return { available: true, data: row?.job_history ?? [] }
}

/** Fetch a machine's currently active assignments (#63's ACTIVE WORKERS
 * section) — lives on the roster row itself (`MachineState.assignments.
 * active`, #76's mapping table), so this is a plain field read off
 * `fetchMachine(name)`, not a separate request. `assignments` is absent/null
 * on the wire whenever a machine has no running work (per the live schema's
 * own description), normalized to `[]` here rather than leaking that
 * optionality to every caller. */
export async function fetchMachineWorkers(
  name: string,
): Promise<MachineQueryResult<MachineActiveWorker[]>> {
  const result = await fetchMachine(name)
  if (!result.available) return result
  return { available: true, data: result.data.assignments?.active ?? [] }
}

/** Fetch fleet-wide worker capacity (used vs total ceiling), summed
 * client-side across every `fetchMachinesStats()` row's own `capacity` --
 * there is no fleet-wide capacity total on the wire, only a per-machine
 * `{active, max}` each (`MachineCapacity`, `./generated.ts`). Mirrors the
 * pre-#76 `summarizeFleetCapacity`'s summation, just sourced from the real
 * endpoint instead of invented roster fields. */
export async function fetchFleetCapacity(): Promise<MachineQueryResult<FleetCapacity>> {
  const result = await fetchMachinesStats()
  if (!result.available) return result
  const used = result.data.reduce((sum, r) => sum + r.capacity.active, 0)
  const total = result.data.length > 0 ? result.data.reduce((sum, r) => sum + r.capacity.max, 0) : null
  return { available: true, data: { used, total } }
}

// ── GET /api/report, GET /api/report/{report_id} (#2492 RPT-1 / #21 RPT-2) ──

/** Fetch the report catalogue — ids, titles, descriptions and full parameter
 * metadata (kind/choices/default), so a client builds its picker and
 * parameter form from here rather than hardcoding a per-report field list. */
export async function fetchReportCatalogue(): Promise<ReportCatalogue> {
  return apiFetch<ReportCatalogue>(API_ROUTES.reportCatalogue, undefined, {
    kind: 'object',
    key: 'reports',
  })
}

/**
 * Run a report and return its `ReportResult`. `params` are the report's own
 * parameters (from its catalogue entry) — an empty/absent value is omitted
 * from the query string entirely so the server falls back to that param's
 * own `default` rather than an explicit empty override.
 *
 * `?format=csv` (#1765, RPT-5/#24) is deliberately not plumbed through this
 * function — that route is a navigation/download target
 * (`<a href download>`), never a `fetch()`+JSON parse, so it has no place in
 * a function that returns `Promise<ReportResult>`.
 */
export async function fetchReport(
  reportId: string,
  params?: Readonly<Record<string, string>>,
): Promise<ReportResult> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) query.set(key, value)
  }
  const qs = query.toString()
  const path = buildPath(API_ROUTES.report, { report_id: reportId })
  return apiFetch<ReportResult>(`${path}${qs ? `?${qs}` : ''}`, undefined, {
    kind: 'object',
    key: 'columns',
  })
}

/**
 * Fetch the diff for a completed work assignment.
 * Prefers the GitHub PR diff; falls back to the compare API.
 */
export async function fetchDiff(assignmentId: string): Promise<DiffResult> {
  return apiFetch<DiffResult>(buildPath(API_ROUTES.diff, { id: assignmentId }), undefined, {
    kind: 'object',
    key: 'diff',
  })
}

/** Advance an assignment through a pipeline gate. */
export async function pipelineAction(
  body: PipelineActionRequest,
): Promise<PipelineActionResult> {
  const res = await fetch(`${API_BASE}${API_ROUTES.pipelineAction}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as PipelineActionResult
  if (!res.ok) {
    return { ok: false, error: data.error ?? `HTTP ${res.status}` }
  }
  return data
}

/** Act on a drive-queue entry (forthcoming — DQW-2, unmerged; see `DriveQueueAction`'s doc comment). */
export async function driveQueueAction(
  body: DriveQueueActionRequest,
): Promise<DriveQueueActionResult> {
  const res = await fetch(`${API_BASE}${API_ROUTES.driveQueueAction}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as DriveQueueActionResult
  if (!res.ok) {
    return { ok: false, error: data.error ?? `HTTP ${res.status}` }
  }
  return data
}

// ── GET /api/portal/needs-input, POST /api/portal/answer (#59) ─────────────

/**
 * One submission sitting in `needs-input`, with its currently open
 * (unanswered) question attached — `GET /api/portal/needs-input`'s response
 * shape.
 *
 * Hand-written, same convention as `SessionInfo` above: issue #59
 * (claude-coordinator#2990) documents this endpoint's existence, and gives
 * `POST /api/portal/answer`'s request body verbatim, but not this GET's
 * response schema. The fields below are the minimum this screen needs — an
 * id to answer against, the open question's text (shown in full, never
 * truncated), and the `revision` that must round-trip unchanged into the
 * POST (a stale one is a 409, not a silent overwrite — see
 * `submitPortalAnswer`). The rest are optional display context a richer
 * server response may or may not carry; treat an absent one as "unknown",
 * never as a reason to hide the row. Confirm this still matches
 * `coord/dashboard/server.py`'s actual response before relying on a field
 * not listed here (see this file's own header re: generated-type drift).
 */
export interface PortalNeedsInputItem {
  submission_id: string
  /** The open question's text — rendered in full on this screen. */
  question: string
  /** The `question_revision` this answer must be paired to. */
  revision: number
  /** Display context, when the server has it. */
  repo_name?: string | null
  issue_number?: number | null
  title?: string | null
  /** ISO 8601 timestamp the question was opened, when known. */
  opened_at?: string | null
}

/** The provenance an operator-recorded answer must carry — mandatory on
 * every `POST /api/portal/answer` (issue #59's acceptance bar: "an answer
 * with no stated provenance cannot be submitted"). */
export type PortalAnswerSource = 'verbal' | 'phone' | 'email'

/** `POST /api/portal/answer`'s request body, given verbatim by issue #59 —
 * see `src/lib/portal.ts` for why there is no separate client-supplied
 * "date" field: the landed contract doesn't have one, and this screen is a
 * thin client over exactly this shape, not a second contract. */
export interface PortalAnswerRequest {
  submission_id: string
  text: string
  source: PortalAnswerSource
  revision: number
  actor?: string
}

/** The recorded portal ledger entry — `POST /api/portal/answer`'s `200` body
 * is `{ entry: PortalLedgerEntry }`. Hand-written like `PortalNeedsInputItem`
 * above: issue #59 confirms this exists and wraps it, not its full shape. */
export interface PortalLedgerEntry {
  submission_id: string
  text: string
  source: PortalAnswerSource
  revision: number
  [key: string]: unknown
}

export interface PortalAnswerResult {
  ok: boolean
  entry?: PortalLedgerEntry
  /** Human-readable failure detail; set only when `ok` is `false`. */
  error?: string
  /** The response's HTTP status, so a caller can tell a `409` (the question
   * moved on since it was listed — issue #59: "surface as a re-read prompt,
   * not a generic error") apart from a `400`/`404`, without re-parsing
   * `error` text. */
  status?: number
}

/**
 * `GET /api/portal/needs-input`'s actual response shape — an object
 * envelope, not a bare array (issue #84). `coord/dashboard/server.py`
 * returns `JSONResponse({"submissions": submissions})`, and the daemon's
 * `/portal-needs-input` (`coord/serve_app.py`) mirrors it — this is the
 * landed contract on both sides of the thin-client seam, not a shape to
 * "fix" server-side.
 */
interface PortalNeedsInputResponse {
  submissions: PortalNeedsInputItem[]
}

/**
 * Fetch the submissions currently sitting in `needs-input`, each with its
 * open question attached (#59).
 *
 * Unwraps the server's `{submissions: [...]}` envelope into the bare array
 * `AnswersPanel` wants (#84: the previous version cast the envelope directly
 * to `PortalNeedsInputItem[]`, which `apiFetch` never validated against —
 * TypeScript believed it, react-query handed the object straight to
 * `.map()`, and the panel white-screened on every render, including the
 * empty-list case). The `{kind: 'object', key: 'submissions'}` guard passed
 * to `apiFetch` below is #85's general top-level shape check (array vs.
 * object-with-key) applied at this one boundary; the `Array.isArray` check
 * that follows it is the one thing that guard doesn't cover — that
 * `submissions` itself is an array, not just present — kept so this
 * endpoint's protection is no weaker than #84's original bespoke check.
 */
export async function fetchPortalNeedsInput(): Promise<PortalNeedsInputItem[]> {
  const data = await apiFetch<PortalNeedsInputResponse>(API_ROUTES.portalNeedsInput, undefined, {
    kind: 'object',
    key: 'submissions',
  })
  if (!Array.isArray(data.submissions)) {
    throw new Error(
      `GET ${API_ROUTES.portalNeedsInput} → expected {submissions: [...]}, got ${describeShape(data)}`,
    )
  }
  return data.submissions
}

/**
 * Record an out-of-band client answer against a submission's open question
 * (#59). Never throws on a non-2xx response — mirrors `pipelineAction`/
 * `driveQueueAction` above: the caller (`AnswersPanel`) needs the structured
 * `{ok, status, error}` shape to tell a `409` (stale revision) apart from a
 * `400`/`404`, which a thrown `Error` (`apiFetch`'s posture) would collapse
 * into one generic failure string.
 *
 * A `200` on an exact duplicate retry (double-submit) is the server's own
 * idempotent-convergence behaviour (`portal_store.answer_question`) — this
 * function does no client-side dedupe of its own, per issue #59's explicit
 * instruction not to second-guess it.
 */
export async function submitPortalAnswer(body: PortalAnswerRequest): Promise<PortalAnswerResult> {
  const res = await fetch(`${API_BASE}${API_ROUTES.portalAnswer}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: { entry?: PortalLedgerEntry; error?: string } = {}
  try {
    data = await res.json()
  } catch {
    // No/invalid JSON body — fall through with an empty `data`, the status
    // code alone is still enough to report failure below.
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` }
  }
  return { ok: true, status: res.status, entry: data.entry }
}

// ── GET /api/gate-a/{repo}/{tracking_issue} (claude-coordinator#3069 / #90) ─

/**
 * The result of fetching a Gate-A packet — a `404` (unknown repo/issue, or
 * the tracking issue has no milestone: `coord/dashboard/server.py`'s
 * `api_gate_a`) is a real, legible outcome to show, not a thrown error, so
 * this mirrors `submitPortalAnswer`'s `{ok, status, error}` shape rather than
 * `apiFetch`'s throw-on-non-2xx posture.
 */
export type GateAFetchResult =
  | { ok: true; data: GateAPacket }
  | { ok: false; status: number; error: string }

/**
 * Fetch a milestone's Gate-A packet — live verdict/stale state, the
 * contract, and every rendered mock, self-contained (#90). No local
 * checkout, no further fetches: `data.mocks[*].html` already has every
 * relatively-linked stylesheet inlined server-side.
 */
export async function fetchGateA(repo: string, trackingIssue: number): Promise<GateAFetchResult> {
  const path = buildPath(API_ROUTES.gateA, { repo, tracking_issue: String(trackingIssue) })
  const res = await fetch(`${API_BASE}${path}`)
  let data: Partial<GateAPacket> & { error?: string } = {}
  try {
    data = await res.json()
  } catch {
    // No/invalid JSON body — fall through, the status code alone still
    // reports failure below.
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: data.error ?? `HTTP ${res.status}` }
  }
  return { ok: true, data: data as GateAPacket }
}

// ── GET /api/milestones{,/{repo}/{number}} (claude-coordinator#3072 / #91) ──
//
// The Milestones panel's whole data layer. Three things this section does
// differently from every other endpoint above, each of them a direct
// response to a real incident this repo has already had:
//
//  1. **Nothing is cast.** `#85` (and `#76`/`#84` before it) shipped a panel
//     that took `res.json()` and asserted it into the declared type; a wrong
//     shape then reached render as a blank screen. `parseMilestoneList` /
//     `parseMilestoneDetail` below walk the response field by field and
//     return a *value* built from what was actually there — a bad field is a
//     legible `{ok: false, kind: 'invalid'}` state the panel renders as a
//     message, never a `TypeError` 3 components deep.
//  2. **"Route absent" is a first-class outcome, not an error.** coord-web
//     auto-deploys on its own timer (CLAUDE.md "Deploy"), decoupled from any
//     claude-coordinator release, so this bundle *will* run against a coord
//     server that predates claude-coordinator#3072 — for weeks, realistically.
//     That case must render an explanatory empty state. The two 404s are told
//     apart by their body, verified by curling a real `coord==0.5.368`
//     server: a *handled* 404 (unknown repo / unknown milestone) answers
//     `application/json` `{"error": "..."}`, an unrouted path answers
//     Starlette's default `text/plain` "Not Found".
//  3. **Order is preserved verbatim.** `MilestoneDetail.entries` arrives in
//     the tracking epic's `## Work order` sequence, which GitHub milestone
//     membership cannot express. Nothing in this client or the panel sorts
//     it.

/**
 * The outcome of a milestone query. Four states, all of them things that
 * genuinely happen against a real fleet — see this section's header:
 *
 *  - `ok`         — a validated response.
 *  - `absent`     — this coord server has no such route (pre-#3072).
 *  - `not-found`  — the route exists and answered a handled 404 (unknown
 *                   repo, unknown milestone number).
 *  - `invalid`    — the route answered 2xx with a body that isn't the
 *                   declared shape (#85). `error` names the offending field.
 *
 * Anything else (5xx, a network failure) still throws, so react-query's
 * `isError` keeps its usual meaning: "something is broken", as distinct from
 * these four, which are all "the server told us something true".
 */
export type MilestoneQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'absent' }
  | { ok: false; kind: 'not-found'; error: string }
  | { ok: false; kind: 'invalid'; error: string }

/** Thrown internally by the parsers below and converted to an `invalid`
 * result by the fetchers — never escapes this module. */
class WireShapeError extends Error {}

function fail(path: string, expected: string): never {
  throw new WireShapeError(`${path}: expected ${expected}`)
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'an object')
  }
  return value as Record<string, unknown>
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'an array')
  return value
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'a string')
  return value
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a number')
  return value
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'a boolean')
  return value
}

function nullableStr(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : str(value, path)
}

function nullableNum(value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : num(value, path)
}

/** A nullable string constrained to a known set. An *unknown* member is
 * deliberately narrowed to `null` rather than rejected: the server is free to
 * introduce a new gate state or milestone state, and a roster that refuses to
 * render because one row carries a value this bundle predates would be a
 * worse bug than a row showing that one cell as unknown. Rejecting is
 * reserved for shape errors (a number where a string belongs), which are
 * always a real mismatch. */
function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | null {
  const s = nullableStr(value, path)
  if (s === null) return null
  return (allowed as readonly string[]).includes(s) ? (s as T) : null
}

const MILESTONE_STATES = ['open', 'closed'] as const
const GATE_A_STATES = ['approved', 'missing', 'stale', 'changes', 'exempt'] as const
const GATE_A_VERDICTS = ['approved', 'changes'] as const
const REVIEW_STATES = ['pending', 'dispatched', 'done'] as const
const REVIEW_VERDICTS = ['approve', 'request-changes'] as const
const SMOKE_RESULTS = ['pass', 'fail'] as const
const TEST_VERDICTS = ['passed', 'failed', 'skipped', 'running'] as const satisfies readonly TestVerdict[]
/** `AssignmentStatus`'s own value set, spelled out for the runtime check —
 * `generated.ts` declares it as a type, and a type cannot be iterated at
 * runtime. Kept in the same order as the declaration there. */
const ASSIGNMENT_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
  'advisory',
  'merged',
] as const satisfies readonly AssignmentStatus[]

function parseGateColumns(raw: unknown, path: string): MilestoneGateColumnsWire | null {
  if (raw === null || raw === undefined) return null
  const o = obj(raw, path)
  return {
    assignment_id: nullableStr(o.assignment_id, `${path}.assignment_id`),
    status: oneOf(o.status, `${path}.status`, ASSIGNMENT_STATUSES),
    branch: nullableStr(o.branch, `${path}.branch`),
    machine_name: nullableStr(o.machine_name, `${path}.machine_name`),
    test_state: oneOf(o.test_state, `${path}.test_state`, TEST_VERDICTS),
    smoke_test: oneOf(o.smoke_test, `${path}.smoke_test`, SMOKE_RESULTS),
    review_state: oneOf(o.review_state, `${path}.review_state`, REVIEW_STATES),
    review_verdict: oneOf(o.review_verdict, `${path}.review_verdict`, REVIEW_VERDICTS),
  }
}

function parseGateA(raw: unknown, path: string): MilestoneGateAWire | null {
  if (raw === null || raw === undefined) return null
  const o = obj(raw, path)
  return {
    state: oneOf(o.state, `${path}.state`, GATE_A_STATES) ?? 'missing',
    ok: bool(o.ok, `${path}.ok`),
    contract_sha: str(o.contract_sha, `${path}.contract_sha`),
    reason: nullableStr(o.reason, `${path}.reason`),
    verdict: oneOf(o.verdict, `${path}.verdict`, GATE_A_VERDICTS),
    actor: nullableStr(o.actor, `${path}.actor`),
    recorded_at: nullableNum(o.recorded_at, `${path}.recorded_at`),
    approved_contract_sha: nullableStr(o.approved_contract_sha, `${path}.approved_contract_sha`),
    href: nullableStr(o.href, `${path}.href`),
  }
}

/**
 * Validate `GET /api/milestones`. Exported for its own unit tests — the
 * point of #85's fix is that this is testable in isolation, not buried in a
 * fetch call nobody can reach without a network.
 */
export function parseMilestoneList(raw: unknown): MilestoneListResponse {
  const o = obj(raw, 'response')
  return {
    milestones: arr(o.milestones, 'response.milestones').map((entry, i) => {
      const path = `response.milestones[${String(i)}]`
      const m = obj(entry, path)
      return {
        repo_name: str(m.repo_name, `${path}.repo_name`),
        milestone_number: num(m.milestone_number, `${path}.milestone_number`),
        title: str(m.title, `${path}.title`),
        state: oneOf(m.state, `${path}.state`, MILESTONE_STATES) ?? 'open',
        tracking_issue: nullableNum(m.tracking_issue, `${path}.tracking_issue`),
        open_issues: num(m.open_issues, `${path}.open_issues`),
        closed_issues: num(m.closed_issues, `${path}.closed_issues`),
        oracle: bool(m.oracle, `${path}.oracle`),
        has_work_order: bool(m.has_work_order, `${path}.has_work_order`),
        work_order_total: num(m.work_order_total, `${path}.work_order_total`),
        work_order_done: num(m.work_order_done, `${path}.work_order_done`),
        ready_frontier: num(m.ready_frontier, `${path}.ready_frontier`),
        in_flight: num(m.in_flight, `${path}.in_flight`),
        blocked: num(m.blocked, `${path}.blocked`),
        needs_you: arr(m.needs_you, `${path}.needs_you`).map((n, j) =>
          str(n, `${path}.needs_you[${String(j)}]`),
        ),
      }
    }),
    warnings: arr(o.warnings ?? [], 'response.warnings').map((w, i) =>
      str(w, `response.warnings[${String(i)}]`),
    ),
  }
}

/**
 * Validate `GET /api/milestones/{repo}/{number}`. `entries` keeps the order
 * it arrived in — the `## Work order` sequence is the whole reason this
 * endpoint exists rather than reading GitHub milestone membership.
 */
export function parseMilestoneDetail(raw: unknown): MilestoneDetail {
  const o = obj(raw, 'response')
  return {
    repo_name: str(o.repo_name, 'response.repo_name'),
    milestone_number: num(o.milestone_number, 'response.milestone_number'),
    title: str(o.title, 'response.title'),
    state: oneOf(o.state, 'response.state', MILESTONE_STATES) ?? 'open',
    tracking_issue: nullableNum(o.tracking_issue, 'response.tracking_issue'),
    open_issues: num(o.open_issues, 'response.open_issues'),
    closed_issues: num(o.closed_issues, 'response.closed_issues'),
    oracle: bool(o.oracle, 'response.oracle'),
    has_work_order: bool(o.has_work_order, 'response.has_work_order'),
    entries: arr(o.entries, 'response.entries').map((entry, i) => {
      const path = `response.entries[${String(i)}]`
      const e = obj(entry, path)
      return {
        issue_number: num(e.issue_number, `${path}.issue_number`),
        title: str(e.title, `${path}.title`),
        state: oneOf(e.state, `${path}.state`, MILESTONE_STATES),
        position: num(e.position, `${path}.position`),
        after: arr(e.after ?? [], `${path}.after`).map((a, j) =>
          num(a, `${path}.after[${String(j)}]`),
        ),
        group: nullableStr(e.group, `${path}.group`),
        gates: parseGateColumns(e.gates, `${path}.gates`),
      }
    }),
    gate_a: parseGateA(o.gate_a, 'response.gate_a'),
    warnings: arr(o.warnings ?? [], 'response.warnings').map((w, i) =>
      str(w, `response.warnings[${String(i)}]`),
    ),
  }
}

/**
 * Fetch a milestone endpoint and validate it, mapping every honest outcome
 * onto `MilestoneQueryResult`. Shared by both fetchers below so the
 * absent-vs-not-found discrimination lives in exactly one place.
 */
async function fetchMilestoneJson<T>(
  path: string,
  parse: (raw: unknown) => T,
): Promise<MilestoneQueryResult<T>> {
  const res = await fetch(`${API_BASE}${path}`)
  if (res.status === 404) {
    // A handled 404 carries a JSON `{"error": ...}` body; an unrouted path on
    // a coord server predating claude-coordinator#3072 answers Starlette's
    // default `text/plain` "Not Found". Both verified against a real server.
    let error: string | null = null
    try {
      const body: unknown = await res.json()
      if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
        error = (body as { error: string }).error
      }
    } catch {
      // Not JSON at all — the unrouted case.
    }
    return error === null ? { ok: false, kind: 'absent' } : { ok: false, kind: 'not-found', error }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET ${path} → HTTP ${String(res.status)}: ${text}`)
  }
  let raw: unknown
  try {
    raw = await res.json()
  } catch {
    return { ok: false, kind: 'invalid', error: `GET ${path}: response was not JSON` }
  }
  try {
    return { ok: true, data: parse(raw) }
  } catch (err) {
    if (err instanceof WireShapeError) {
      return { ok: false, kind: 'invalid', error: `GET ${path} → ${err.message}` }
    }
    throw err
  }
}

/** Fetch the milestone roster across every tracked repo. Pass `repo` to
 * scope to one (mirrors `coord plans --repo`; an unknown repo is a handled
 * 404 → `not-found`, not `absent`). */
export async function fetchMilestones(repo?: string): Promise<MilestoneQueryResult<MilestoneListResponse>> {
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return fetchMilestoneJson(`${API_ROUTES.milestones}${query}`, parseMilestoneList)
}

/** Fetch one milestone's ordered work order, per-entry gate columns and
 * Gate-A summary. */
export async function fetchMilestoneDetail(
  repo: string,
  number: number,
): Promise<MilestoneQueryResult<MilestoneDetail>> {
  const path = buildPath(API_ROUTES.milestoneDetail, { repo, number: String(number) })
  return fetchMilestoneJson(path, parseMilestoneDetail)
}

// ── WS /ws/terminal/{session_id} ────────────────────────────────────────────

/**
 * Key `coord web`'s optional bearer token (`COORD_WEB_TOKEN` /
 * `~/.coord/web_token`, see `coord.dashboard.terminal.resolve_web_token`)
 * is stashed in `localStorage`, when the operator has set one.
 *
 * There's no in-app UI to populate this yet (#1068 is the terminal pane
 * itself, not a settings screen) — for now it's set by hand from the
 * browser devtools console:
 *   `localStorage.setItem('coord_web_token', '<token>')`
 * When unset, the WS connects without `?token=`, which matches the
 * server's "no token configured => open" convention.
 */
const WEB_TOKEN_STORAGE_KEY = 'coord_web_token'

function resolveWebToken(): string | null {
  try {
    return window.localStorage.getItem(WEB_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Build the `/ws/terminal/{session_id}` URL (#1065's PTY<->WebSocket
 * bridge) for the given session, same-origin, ws/wss matching the page's
 * http/https scheme, with `?token=` appended when one is configured.
 */
export function terminalWebSocketUrl(sessionId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const token = resolveWebToken()
  const query = token ? `?token=${encodeURIComponent(token)}` : ''
  return `${proto}//${window.location.host}/ws/terminal/${encodeURIComponent(sessionId)}${query}`
}
