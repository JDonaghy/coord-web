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
  FleetChecks,
  MachineActiveWorker,
  MachineHealthCheckResult,
  MachineHealthSnapshot,
  MachineJobHistoryEntry,
  MachineMetricPoint,
  MachineMetricsSeries,
  MachineState,
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
  FleetChecks,
  MachineActiveWorker,
  MachineHealthCheckResult,
  MachineHealthSnapshot,
  MachineJobHistoryEntry,
  MachineMetricPoint,
  MachineMetricsSeries,
  MachineState,
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
 * newer than the API serving it. Every `fetchMachine*` function below is
 * built on this rather than `apiFetch` for exactly that reason (issue #61:
 * "must degrade to an honest 'unavailable' state when an endpoint 404s, not
 * crash the panel or render an empty chart as zero") — today that 404 always
 * fires, since the Machines API itself is still claude-coordinator#3027, not
 * yet a registered route on any coord server; the same code path is what
 * keeps this client working once #3027 lands on some hosts before others.
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
  return apiFetch<BoardData>('/api/board')
}

/** Fetch pipeline views for all work-type assignments. */
export async function fetchPipeline(): Promise<PipelineView[]> {
  return apiFetch<PipelineView[]>('/api/pipeline')
}

/**
 * Fetch the `coord drive` work queue in run order, plus a server-computed
 * aggregate summary (#2428 DQW-1). Pass `repo` to narrow `entries` to one
 * repo — `summary` is always computed over the full, unfiltered queue (see
 * `BoardDriveQueueEntry`'s doc comment for why).
 */
export async function fetchDriveQueue(repo?: string): Promise<DriveQueueData> {
  const query = repo ? `?repo=${encodeURIComponent(repo)}` : ''
  return apiFetch<DriveQueueData>(`/api/drive-queue${query}`)
}

/** Fetch live coord-* interactive sessions the phone can take over (#1066). */
export async function fetchSessions(): Promise<SessionInfo[]> {
  return apiFetch<SessionInfo[]>('/api/sessions')
}

// ── GET /api/machines* (forthcoming — claude-coordinator#3027, #61, #63) ───
//
// Every function below hits a route that isn't registered on any coord
// server yet — see `./generated.ts`'s "Machines panel" section header for
// the full context. All seven are built on `apiFetchOptional`, not
// `apiFetch`: a 404 is this milestone's *expected* steady state until #3027
// lands, not a bug to throw over, and `MachinesPanel`/`MachineDetail` (M-4)
// render `{available: false}` as an honest "unavailable" note per section
// rather than an empty list/chart that would misreport as "zero machines" /
// "zero of this metric."

/** Fetch the machine roster — every machine coord knows about. */
export async function fetchMachines(): Promise<MachineQueryResult<MachineState[]>> {
  return apiFetchOptional<MachineState[]>('/api/machines')
}

/** Fetch one machine's roster entry by name. */
export async function fetchMachine(name: string): Promise<MachineQueryResult<MachineState>> {
  return apiFetchOptional<MachineState>(`/api/machines/${encodeURIComponent(name)}`)
}

/** Fetch a machine's metrics series (load, disk free, etc — open vocabulary,
 * see `MachineMetricsSeries`'s doc comment). */
export async function fetchMachineMetrics(
  name: string,
): Promise<MachineQueryResult<MachineMetricsSeries[]>> {
  return apiFetchOptional<MachineMetricsSeries[]>(
    `/api/machines/${encodeURIComponent(name)}/metrics`,
  )
}

/** Fetch a machine's current health-check snapshot (severity/stale +
 * per-check results — see `MachineHealthSnapshot`'s doc comment for why
 * both pairs travel together, #64). */
export async function fetchMachineHealth(
  name: string,
): Promise<MachineQueryResult<MachineHealthSnapshot>> {
  return apiFetchOptional<MachineHealthSnapshot>(
    `/api/machines/${encodeURIComponent(name)}/health`,
  )
}

/** Fetch a machine's aggregate work-stats over the server's own trailing window. */
export async function fetchMachineWorkStats(
  name: string,
): Promise<MachineQueryResult<MachineWorkStats>> {
  return apiFetchOptional<MachineWorkStats>(
    `/api/machines/${encodeURIComponent(name)}/work-stats`,
  )
}

/** Fetch a machine's currently active headless workers (#63's ACTIVE WORKERS
 * section — id/issue/type/repo/age per row). */
export async function fetchMachineWorkers(
  name: string,
): Promise<MachineQueryResult<MachineActiveWorker[]>> {
  return apiFetchOptional<MachineActiveWorker[]>(
    `/api/machines/${encodeURIComponent(name)}/workers`,
  )
}

/** Fetch a machine's recent job history (#63's JOB HISTORY section —
 * status + age per row, most recent first). */
export async function fetchMachineJobs(
  name: string,
): Promise<MachineQueryResult<MachineJobHistoryEntry[]>> {
  return apiFetchOptional<MachineJobHistoryEntry[]>(`/api/machines/${encodeURIComponent(name)}/jobs`)
}

/** Fetch fleet-*scope* health checks (#66) — facts about the fleet as a
 * whole, not any one machine's (`FleetChecks`'s doc comment, `./generated.ts`).
 * `FleetSummary` folds these into the same severity rollup as every
 * machine's own `MachineState.severity`, per `coord.health.aggregate`'s
 * counting rule. */
export async function fetchFleetChecks(): Promise<MachineQueryResult<FleetChecks>> {
  return apiFetchOptional<FleetChecks>('/api/fleet/health')
}

// ── GET /api/report, GET /api/report/{report_id} (#2492 RPT-1 / #21 RPT-2) ──

/** Fetch the report catalogue — ids, titles, descriptions and full parameter
 * metadata (kind/choices/default), so a client builds its picker and
 * parameter form from here rather than hardcoding a per-report field list. */
export async function fetchReportCatalogue(): Promise<ReportCatalogue> {
  return apiFetch<ReportCatalogue>('/api/report')
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
  return apiFetch<ReportResult>(
    `/api/report/${encodeURIComponent(reportId)}${qs ? `?${qs}` : ''}`,
  )
}

/**
 * Fetch the diff for a completed work assignment.
 * Prefers the GitHub PR diff; falls back to the compare API.
 */
export async function fetchDiff(assignmentId: string): Promise<DiffResult> {
  return apiFetch<DiffResult>(`/api/diff/${encodeURIComponent(assignmentId)}`)
}

/** Advance an assignment through a pipeline gate. */
export async function pipelineAction(
  body: PipelineActionRequest,
): Promise<PipelineActionResult> {
  const res = await fetch(`${API_BASE}/api/pipeline/action`, {
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
  const res = await fetch(`${API_BASE}/api/drive-queue/action`, {
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

/** Fetch the submissions currently sitting in `needs-input`, each with its
 * open question attached (#59). */
export async function fetchPortalNeedsInput(): Promise<PortalNeedsInputItem[]> {
  return apiFetch<PortalNeedsInputItem[]>('/api/portal/needs-input')
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
  const res = await fetch(`${API_BASE}/api/portal/answer`, {
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
