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

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${init?.method ?? 'GET'} ${path} → HTTP ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
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
async function apiFetchOptional<T>(path: string): Promise<MachineQueryResult<T>> {
  const res = await fetch(`${API_BASE}${path}`)
  if (res.status === 404) {
    return { available: false }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`GET ${path} → HTTP ${res.status}: ${text}`)
  }
  return { available: true, data: (await res.json()) as T }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch the full board state (active + last-20 completed assignments). */
export async function fetchBoard(): Promise<BoardData> {
  return apiFetch<BoardData>(API_ROUTES.board)
}

/** Fetch pipeline views for all work-type assignments. */
export async function fetchPipeline(): Promise<PipelineView[]> {
  return apiFetch<PipelineView[]>(API_ROUTES.pipeline)
}

/**
 * Fetch the `coord drive` work queue in run order, plus a server-computed
 * aggregate summary (#2428 DQW-1). Pass `repo` to narrow `entries` to one
 * repo — `summary` is always computed over the full, unfiltered queue (see
 * `BoardDriveQueueEntry`'s doc comment for why).
 */
export async function fetchDriveQueue(repo?: string): Promise<DriveQueueData> {
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return apiFetch<DriveQueueData>(`${API_ROUTES.driveQueue}${query}`)
}

/** Fetch live coord-* interactive sessions the phone can take over (#1066). */
export async function fetchSessions(): Promise<SessionInfo[]> {
  return apiFetch<SessionInfo[]>(API_ROUTES.sessions)
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
  return apiFetchOptional<MachineState[]>(API_ROUTES.machines)
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
  return apiFetchOptional<MachinesHealthResponse>(API_ROUTES.machinesHealth)
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
  return apiFetchOptional<MachinesMetricsResponse>(API_ROUTES.machinesMetrics)
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
  return apiFetchOptional<MachineStatsRow[]>(API_ROUTES.machinesStats)
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
  return apiFetch<ReportCatalogue>(API_ROUTES.reportCatalogue)
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
  return apiFetch<ReportResult>(`${path}${qs ? `?${qs}` : ''}`)
}

/**
 * Fetch the diff for a completed work assignment.
 * Prefers the GitHub PR diff; falls back to the compare API.
 */
export async function fetchDiff(assignmentId: string): Promise<DiffResult> {
  return apiFetch<DiffResult>(buildPath(API_ROUTES.diff, { id: assignmentId }))
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
 * to `PortalNeedsInputItem[]`, which `apiFetch` never validates against —
 * TypeScript believed it, react-query handed the object straight to
 * `.map()`, and the panel white-screened on every render, including the
 * empty-list case). The `Array.isArray` check below is a narrow runtime
 * assertion at this one boundary, not a general `apiFetch` validator — see
 * this file's own header re: generated-type drift, which nothing here
 * guards against automatically.
 */
export async function fetchPortalNeedsInput(): Promise<PortalNeedsInputItem[]> {
  const data = await apiFetch<PortalNeedsInputResponse>(API_ROUTES.portalNeedsInput)
  if (!data || !Array.isArray(data.submissions)) {
    throw new Error(
      `GET ${API_ROUTES.portalNeedsInput} → expected {submissions: [...]}, got ${JSON.stringify(data)}`,
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
