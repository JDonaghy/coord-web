/**
 * NOMINALLY GENERATED, EFFECTIVELY HAND-MAINTAINED RIGHT NOW — read before
 * editing.
 *
 * This file's canonical source is `scripts/codegen.py` in claude-coordinator,
 * run against the dashboard's OpenAPI 3 spec
 * (`coord.dashboard.server.openapi_spec()`, itself built by
 * `coord/openapi.py` from `coord/models.py` / `coord/pipeline.py`) — #1550
 * (originally #750). From a claude-coordinator checkout:
 *
 *     .venv/bin/python scripts/codegen.py --out <coord-web checkout>/src/api/generated.ts
 *
 * There is currently **no drift gate for this file in this repo** — coord-web
 * CI (`.github/workflows/ci.yml`) does not run the generator or verify this
 * file against it. `tests/test_generated_types_fixture.py` lives in
 * claude-coordinator and, since claude-coordinator#2009, only proves the
 * generator produces well-formed output there; it says nothing about whether
 * *this committed copy* still matches. That gate was meant to move here
 * (claude-coordinator#2009's own header says so) but never did — see
 * coord-web#77, itself blocked on a companion claude-coordinator issue to
 * expose the generator through the installed `code-coordinator` distribution
 * (today it's a repo-root script, not part of the wheel — see
 * claude-coordinator#3045). Until that lands and #77 wires the CI job, treat
 * every change to this file as hand-maintained: verify it against the
 * server's actual `openapi.json` for the target `coord` version before
 * committing (see the Machines block below for the pattern this takes when
 * done carefully).
 */

export type AssignmentStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'advisory'
  | 'merged'

/**
 * coord/models.py Assignment.type's real value set — #1550 found this had
 * drifted: the hand-authored enum this replaces listed 'merge' and 'fix',
 * neither of which is ever a literal `type=` value (coord/config.py's #1137
 * audit note: a dedicated `type="merge"` was tried and reverted; `type="fix"`
 * was deliberately never introduced — both share `type="work"` with their
 * headless counterpart and are distinguished by `provider_name`/
 * `review_of_assignment_id` instead, see `attention_threshold_for`) — while
 * missing seven values that are real: 'audit' (coord/models.py docstring,
 * #885 --audit-of), and the six interactive session types from
 * coord/config.py's `INTERACTIVE_SESSION_TYPES` plus the two headless
 * lightweight-worker types from `_DEFAULT_ATTENTION_THRESHOLDS`.
 */
export type AssignmentType =
  | 'work'
  | 'review'
  | 'plan'
  | 'smoke'
  | 'conflict-fix'
  | 'mock-author'
  | 'test-author'
  | 'audit'
  | 'chat'
  | 'troubleshoot'
  | 'milestone-chat'
  | 'refinement'
  | 'new-issue-chat'
  | 'test-chat'

export type TestVerdict = 'passed' | 'failed' | 'skipped' | 'running'

/**
 * Actions supported by POST /api/pipeline/action.
 *
 * dispatch_review    — kick off an adversarial review assignment
 * dispatch_smoke     — kick off a smoke-test assignment
 * enqueue            — add to merge queue
 * merge              — merge a queued PR (must be in "pending" state)
 * post_findings      — post orphaned review findings to GitHub
 * unstick            — cancel a stuck assignment and mark it failed
 * retry              — (forthcoming) retry a failed work assignment
 * dispatch_fix       — (forthcoming) dispatch a fix for a test failure / review request-changes
 * test-verdict       — (forthcoming) record passed/failed/skipped test verdict
 * record-review-verdict — (forthcoming) record an approved/changes-requested review verdict
 */
export type PipelineAction =
  | 'dispatch_review'
  | 'dispatch_smoke'
  | 'enqueue'
  | 'merge'
  | 'post_findings'
  | 'unstick'
  | 'retry'
  | 'dispatch_fix'
  | 'test-verdict'
  | 'record-review-verdict'

export interface PipelineStage {
  name: string
  status: 'active' | 'completed' | 'skipped' | 'waiting'
  is_current: boolean
}

export interface PipelineGate {
  action: PipelineAction
  label: string
  endpoint: string
}

export interface PipelineView {
  assignment_id: string
  issue_number: number
  issue_title: string
  repo_name: string
  machine_name: string
  stages: PipelineStage[]
  current_stage: string
  available_gates: PipelineGate[]
  progress_pct: number
  review_findings_pending: boolean
  review_verdict: 'approve' | 'request-changes' | null
  review_verdict_original: string | null
  review_verdict_override_reason: string | null
  review_findings_body: string | null
  test_verdict: TestVerdict | null
  needs_attention: boolean
  needs_attention_reason: string | null
  needs_attention_detail: string | null
  finished_at: number | null
}

export interface Assignment {
  machine_name: string
  repo_name: string
  issue_number: number
  issue_title: string
  files_allowed: string[]
  files_forbidden: string[]
  briefing: string
  assignment_id: string | null
  status: AssignmentStatus
  branch: string | null
  pr_url: string | null
  dispatched_at: number | null
  finished_at: number | null
  smoke_test: 'pass' | 'fail' | null
  smoke_test_reason: string | null
  type: AssignmentType
  review_target: string | null
  review_of_assignment_id: string | null
  unreachable_count: number
  model: string | null
  plan: Record<string, unknown> | null
  review_state: 'pending' | 'dispatched' | 'done' | null
  review_dispatch_reason: string | null
  required_gates: string[]
  review_iteration: number
  review_posted_at: number | null
  test_state: TestVerdict | null
  test_reason: string | null
  test_head_sha: string | null
  test_patch_id: string | null
  test_base_sha: string | null
  test_toolchain: string | null
  review_verdict: 'approve' | 'request-changes' | null
  review_verdict_original: string | null
  review_verdict_override_reason: string | null
  verdict_source: string | null
  verdict_source_reason: string | null
  review_head_sha: string | null
  review_patch_id: string | null
  review_scoped: boolean
  review_scope_base_sha: string | null
  cost_usd: number | null
  smoke_tests: string[] | null
  provider_name: string | null
  input_tokens: number
  output_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  failure_reason: string | null
  acceptance_state: string | null
  acceptance_reason: string | null
  acceptance_sha: string | null
  acceptance_total: number | null
  acceptance_passed: number | null
  completion_summary: string | null
  audit_goals_json: string | null
  audit_bottom_line: string | null
  audit_run_number: number | null
  for_issue_number: number | null
  driven_by: string | null
  stop_reason: string | null
}

// ── #2428 DQW-1 (claude-coordinator) / issue #5 (coord-web) ─────────────────
//
// Hand-added ahead of the next real `scripts/codegen.py` regeneration — that
// script and the OpenAPI spec it reads both live in claude-coordinator, not
// here (see this repo's CLAUDE.md "Generated API types drift silently"
// note), so nothing in this checkout can actually run it. Field-for-field
// transcription of what `coord.dashboard.server.openapi_spec()` serves today
// for `GET /api/drive-queue`: `BoardDriveQueueEntry` from
// `sqlite_table_schema(..., "drive_queue", ...)` (the wire shape IS the
// `drive_queue` SQLite DDL, coord/db.py — same "no hand-maintained field
// list to drift" reasoning coord/serve_app.py's `/board` schema uses) and
// `DriveQueueSummary` from `dataclass_schema(DriveQueueSummary, ...)`
// (coord/drive_queue.py). Re-diff against the real generated.ts output next
// time it's regenerated and replace this block wholesale if it drifted.
export interface BoardDriveQueueEntry {
  id: number
  repo_name: string
  issue_number: number
  position: number
  machine: string | null
  /** JSON-decoded on the wire (coord/dao.py `_JSON_COLUMNS`) — pre-req keys, e.g. ["repo#123"]. */
  after_json: string[]
  state: string
  attempts: number
  deferrals: number
  last_reason: string
  reason_at: number | null
  session_name: string | null
  launched_at: number | null
  enqueued_at: number
  hold_after: number
  hold_reason: string
  resume_when: string
  hold_state: string
  hold_probes: number
  launch_host: string
  hold_scope: string
  resumes: number
  retry_backoff_at: number | null
}

/**
 * Server-computed aggregate over a drive-queue read — see
 * `coord.drive_queue.summarize_drive_queue`/`DriveQueueSummary`. `level` is
 * the ascending-severity rank 'empty' < 'normal' < 'stalled' < 'held' <
 * 'blocked'; `scripts/codegen.py` has no `ENUM_OVERRIDES` entry for it, so
 * it's a bare `string` here, same as it would be if regenerated today.
 */
export interface DriveQueueSummary {
  level: string
  pending: number
  running: number
  waiting: number
  blocked: number
  eligible: number
  held: number
  fleet_held: number
}

// ── #2492 RPT-1 (claude-coordinator) / #21 RPT-2 (coord-web) ────────────────
//
// Hand-added ahead of the next real `scripts/codegen.py` regeneration — that
// script and the OpenAPI spec it reads both live in claude-coordinator, not
// here (see this repo's CLAUDE.md "Generated API types drift silently"
// note), so nothing in this checkout can actually run it. Same posture as
// `BoardDriveQueueEntry` above: field-for-field transcription of what
// `coord.dashboard.server.openapi_spec()` serves today for `GET /api/report`
// and `GET /api/report/{report_id}` (`coord/dashboard/server.py`'s
// `_openapi_spec`, mirroring `coord/reports.py`'s dataclasses' own
// `to_dict()`). Re-diff against the real generated.ts output next time it's
// regenerated and replace this block wholesale if it drifted.

/** One parameter of a report — rich enough that a client builds its input
 * form from the catalogue alone, never a hardcoded per-report field list. */
export interface ReportParam {
  id: string
  label: string
  /** Open vocabulary — "choice" (render a `<select>` over `choices`) or
   * "text" (a free-text `<input>`) today. */
  kind: string
  choices: string[]
  default: string
  help: string
  /** `choices` are presets, not a whitelist, when true. */
  free_form: boolean
}

/** #2454 — which two `ReportResult.columns` name the `(repo, issue)` a row
 * is about. `null` on a `ReportDef` means its rows have no single owning
 * issue (an aggregate report). */
export interface RowIdentity {
  repo_column: string
  issue_column: string
}

/** A catalogue entry — everything a client needs to render a report's tab,
 * description and parameter form, minus the server-side `run` callable. */
export interface ReportDef {
  id: string
  title: string
  description: string
  params: ReportParam[]
  row_identity: RowIdentity | null
}

export interface ReportCatalogue {
  reports: ReportDef[]
}

/** #1760 — display metadata for one `ReportResult.columns` entry, zipped by
 * array position (`id` also matches the corresponding `columns[]` entry). */
export interface ColumnMeta {
  id: string
  label: string
  /** Open vocabulary — a client meeting a `kind` it predates falls back to
   * plain stringification: "text" | "int" | "timestamp" | "list" | "enum" |
   * "duration" | "money" today. */
  kind: string
  align: string
  weight: number
}

/** #2271 — one series of a `ChartSpec`, reading its y-values off an existing
 * `ReportResult.columns` id (carries no numbers of its own). */
export interface ChartSeries {
  label: string
  column: string
  color: string | null
}

/** #2271 — an optional declaration that a `ReportResult` also reads as a
 * chart. A client that doesn't understand this block (or meets a `kind` it
 * predates) renders the table and ignores it. */
export interface ChartSpec {
  kind: string
  series: ChartSeries[]
  x: string | null
  group_by: string | null
  stacked: boolean
  title: string
  y_label: string
}

/** `GET /api/report/{report_id}`'s response shape. */
export interface ReportResult {
  report_id: string
  generated_at: number
  window: [number, number]
  columns: string[]
  column_meta: ColumnMeta[]
  rows: Array<Record<string, unknown>>
  notes: string[]
  /** #1763 — optional grand-total row keyed by the same column ids as
   * `rows`; `null` for reports with no meaningful sum. */
  totals: Record<string, unknown> | null
  chart: ChartSpec | null
}

// ── Machines panel (coord-web#76, replacing the invented #61-#66 surface) ──
//
// The previous version of this block invented a `/api/machines/{name}/*`
// per-machine route family and a `MachineState.severity` field — issue #76
// found neither was ever built. The real surface is four fleet-*wide*
// collection endpoints — `/api/machines`, `/api/machines/health`,
// `/api/machines/metrics`, `/api/machines/stats` — and `./client.ts` fetches
// each once, joining/selecting per machine client-side rather than issuing
// one request per machine per concern.
//
// Unlike the rest of this file, every type below IS a faithful transcription
// of a real, running server's own `GET /openapi.json` (fetched against a
// local `coord web --fixture` process on the exact `coord==0.5.341` #76
// cites, then cross-checked field-for-field) — not a guess, and not the
// generator claude-coordinator#3045 would eventually produce (still not
// shipped in the wheel, coord-web#77), but the closest thing to it available
// today. Names/nesting/nullability all come straight from that spec's
// `MachineRow`/`FleetHealthResponse`/`MachineHealthRow`/`HealthCheckResult`/
// `MachineMetricsResponse`/`MachineMetricsSample`/`MachineStatsRow` schemas.
// Replace wholesale the day a real generated.ts can supersede it.

/** `GET /api/machines` — one roster entry (`MachineRow` in the live
 * OpenAPI schema). No `severity` here on purpose — the server only computes
 * that per-check, in `GET /api/machines/health`'s `machine_health[]` rows;
 * `severity` must be joined onto a roster row by machine name, never
 * invented locally (see `joinMachineSeverity`, `./client.ts`). */
export interface MachineState {
  name: string
  /** The machine's Tailscale host, same meaning as `SessionInfo.host`. */
  host: string
  /** Reachability state — open vocabulary per the spec's own description
   * ("unknown|online|offline|..."); render verbatim rather than assuming a
   * closed enum. */
  state: string
  /** Human-readable context for `state` (e.g. why a probe failed). */
  reason: string
  /** Round-trip latency of the roster's last reachability probe, in
   * milliseconds, or `null` when unmeasured. */
  latency_ms: number | null
  /** The coord-agent version this machine last reported, or `null` when the
   * daemon has never heard a version from it. */
  agent_version: string | null
  /** Repos this machine has a worktree/checkout for. */
  repos: string[]
  /** Total on-disk size, in bytes, of this machine's git worktrees, or
   * `null` when the daemon hasn't reported one. */
  worktree_bytes: number | null
  /** This machine's current assignment activity — present (per the spec's
   * own description) "only when this machine has running work"; absent or
   * `null` both mean "nothing active", never fabricated as `{active: []}`
   * by this type (`./client.ts`'s readers normalize that). */
  assignments?: MachineAssignments | null
}

/** `MachineState.assignments` — issue #76's mapping table: "workers" (the
 * old, never-built `/api/machines/{name}/workers` route) now reads as
 * `assignments.active` on the roster row itself. */
export interface MachineAssignments {
  active: MachineActiveWorker[]
}

/**
 * One of a machine's currently active assignments, nested under
 * `MachineState.assignments.active`. Deliberately thin per the live schema
 * — no dispatch timestamp and no assignment `type` travel on this row (both
 * were invented by the pre-#76 surface), so the detail panel can show
 * identity + status + issue context but not an age column.
 */
export interface MachineActiveWorker {
  assignment_id: string
  status: string
  spec?: MachineAssignmentSpec
}

/** `MachineActiveWorker.spec` — issue context for one active assignment,
 * all optional per the live schema (a spec-less row still has an
 * `assignment_id`/`status` worth showing). */
export interface MachineAssignmentSpec {
  issue_number?: number
  issue_title?: string
  repo_name?: string
}

/**
 * One entry in a machine's recent (last 20, per the endpoint's own summary)
 * job history, nested under `GET /api/machines/stats`'s per-machine
 * `job_history[]` — already scoped to one machine on the wire, unlike the
 * pre-#76 surface's invented flat/fleet-wide array.
 */
export interface MachineJobHistoryEntry {
  assignment_id: string
  repo_name: string
  issue_number: number | null
  issue_title: string | null
  /** Assignment type, e.g. `"work"`/`"review"` — reuses `AssignmentType`'s
   * open string shape rather than fixing it here; the live schema declares
   * this a bare string, not necessarily a closed `AssignmentType`. */
  type: string
  /** Assignment status — reuses `AssignmentStatus`'s real value set since a
   * job history row *is* a (usually finished) assignment; the detail panel
   * uses it to render failures visually distinct from the rest. */
  status: AssignmentStatus
  dispatched_at: number | null
  /** Epoch seconds the job finished, or `null` while it's still
   * pending/running -- the detail panel renders those as "in progress"
   * rather than a bogus age. */
  finished_at: number | null
}

/** One sample of a machine's CPU/memory time series
 * (`MachinesMetricsResponse.machines{}`'s per-machine array, oldest-first).
 * Deliberately not a generic named-metric-series shape (the pre-#76
 * surface's invented `MachineMetricsSeries`/`MachineMetricPoint`) — the real
 * endpoint reports a fixed, richer sample per timestamp instead.
 *
 * `status: 'unknown'` (a poll that failed or timed out) is a first-class
 * outcome (#65's honesty rule, still true post-#76): `./client.ts`'s
 * `fetchMachineMetrics` maps a `'unknown'`-status sample to an explicit gap
 * in the `cpu_pct`/`mem_pct` series it synthesizes, never interpolating
 * across it or plotting it as `0`. */
export interface MachineMetricsSample {
  /** Epoch seconds. */
  timestamp: number
  status: string
  cpu_percent: number | null
  mem_percent: number | null
  mem_used_mb: number | null
  mem_total_mb: number | null
  reason: string
}

/** `GET /api/machines/metrics`'s response shape — `machines{}` keyed by
 * machine name, each an oldest-first `MachineMetricsSample[]`. */
export interface MachinesMetricsResponse {
  schema: number
  generated_at: number
  since: number | null
  resolution: number | null
  machines: Record<string, MachineMetricsSample[]>
}

/** One epoch-seconds point of a `MachineMetricsSeries` — `./client.ts`'s
 * `fetchMachineMetrics` synthesizes this shape from the real
 * `MachineMetricsSample[]` above so `src/components/MachineCharts.tsx` /
 * `src/lib/machineCharts.ts`'s generic named-metric-series chart machinery
 * (built for #65 against the pre-#76 invented endpoint, but not itself
 * wrong — just fed from the wrong source) can stay as-is. `value: null` is
 * a first-class, explicit "unknown" sample: a client MUST render it as a
 * gap in the series, never interpolated or plotted as `0`. */
export interface MachineMetricPoint {
  t: number
  value: number | null
}

/** A named time series (`"cpu_pct"`/`"mem_pct"`, the only two
 * `fetchMachineMetrics` synthesizes today — see that function's doc
 * comment) for one machine, client-side-derived from
 * `MachineMetricsSample[]`. */
export interface MachineMetricsSeries {
  metric: string
  unit: string | null
  points: MachineMetricPoint[]
}

export type Severity = 'ok' | 'warn' | 'crit' | 'unknown'

/**
 * One already-rendered health-check row (`HealthCheckResult` in the live
 * OpenAPI schema) — the wire shape of `coord.health.models.CheckResult.
 * to_dict()` (`coord/health/checks/`: disk, worktrees, toolchain,
 * index_lock, spawned_coord, cargo_targets and the rest). `severity`/
 * `headroom` are pre-decided by the probe that produced this row; nothing
 * on this side may re-derive either from raw numbers — the same rule
 * `coord-tui/src/app/fleet_health.rs`'s module doc comment spells out for
 * the identical data. `headroom` is the load-bearing field: a short,
 * already-formatted phrase such as `"86% used (22G free)"`, not a number
 * this client formats itself. Open vocabulary on `key`. `detail` is
 * optional per the live schema — an unset one just means nothing extra to
 * show, not a data error.
 */
export interface MachineHealthCheckResult {
  /** Stable identity for this row: `check_id`, or `"<check_id>:<subject>"`
   * when the check has a subject. */
  key: string
  check_id: string
  scope: string
  subject?: string | null
  title: string
  /** Display label, e.g. `"disk"` or `"worktrees vimcode"`. */
  label: string
  severity: Severity
  headroom: string
  threshold?: string
  detail?: string
  trend?: string | null
}

/** One row of `GET /api/machines/health`'s `machine_health[]` — one
 * machine's rolled-up health, keyed by `machine` (#76's mapping table).
 *
 * `severity`/`stale` answer "trust this right now?"; `results`/`checked_at`
 * answer "what did we last see?" — kept as two separate pairs on purpose
 * (#1630, #64). A stale snapshot must render as "last measured OK, a while
 * ago", never silently as "OK": `severity` is already stale-aware
 * server-side (it becomes `'unknown'` once a machine hasn't reported in too
 * long), but `stale`+`checked_at` are what let the UI say *why* rather than
 * just rendering the downgraded verdict with no explanation.
 *
 * This is the server's one and only computed `severity` for a machine
 * (`_effective_severity`) — per #76 and #3023's honesty contract, no other
 * type in this file may re-derive or duplicate it; `MachineState` deliberately
 * has none of its own. Also carries its own copy of several roster-shaped
 * fields (`state`/`reason`/`latency_ms`/`worktree_bytes`/
 * `agent_runtime_version`) per the live schema — `./client.ts` ignores those
 * here and reads them off the roster instead, to avoid two sources of truth
 * for the same fact inside one component tree. */
export interface MachineHealthRow {
  machine: string
  state: string
  reason: string
  latency_ms?: number | null
  received_at?: number | null
  stale: boolean
  severity: Severity
  /** Epoch seconds of the last actual measurement, or `null`/absent when
   * this machine has never reported health at all (old agent, or never
   * polled). */
  checked_at?: number | null
  results: MachineHealthCheckResult[]
  worktree_bytes?: number | null
  agent_runtime_version?: string | null
}

/** `GET /api/machines/health`'s response shape (`FleetHealthResponse`) —
 * `machine_health[]` (one row per machine, keyed by `machine`) plus
 * `fleet_checks`, facts about the fleet as a whole (board latency,
 * phantom-running rows, deploy-lane skew, …) that aren't about any one
 * machine. Reuses `MachineHealthCheckResult` row-for-row for `fleet_checks`
 * rather than inventing a second "check result" shape, since a fleet-scope
 * check and a machine-scope check render the same way (severity + headroom
 * + detail), just scoped differently. */
export interface MachinesHealthResponse {
  schema: number
  refreshed_at: number | null
  machine_health: MachineHealthRow[]
  fleet_checks: MachineHealthCheckResult[]
  truncated: boolean
}

/** A machine's rolled-up health, joined onto one roster row by name
 * (`joinMachineSeverity`/`fetchMachineHealth`, `./client.ts`) — the
 * severity/stale/checked_at/results slice of `MachineHealthRow` this panel
 * actually renders (see that type's doc comment for why the rest of its
 * fields are ignored here). */
export interface MachineHealthSnapshot {
  severity: Severity
  stale: boolean
  checked_at: number | null
  results: MachineHealthCheckResult[]
}

/** One machine's active-vs-configured worker concurrency
 * (`MachineStatsRow.capacity`). */
export interface MachineCapacity {
  active: number
  max: number
}

/** Fleet-wide worker capacity, client-side-summed across every
 * `MachineStatsRow.capacity` (`fetchFleetCapacity`, `./client.ts`) — there
 * is no fleet-wide total on the wire, only per-machine ones. `total: null`
 * when no machine reports one, never a fabricated 0. */
export interface FleetCapacity {
  used: number
  total: number | null
}

/** One machine's completed/failed assignment counts over the server's own
 * retention window (`MachineStatsRow.counts`). */
export interface MachineJobCounts {
  completed: number
  failed: number
}

/** `GET /api/machines/stats`'s response shape — an array of per-machine
 * rows (`MachineStatsRow` in the live schema), NOT the fleet-wide
 * `{capacity, counts, job_history}` object the pre-#76 surface guessed at:
 * capacity and job counts are both per-machine here, and there is no
 * separate fleet-wide capacity total on the wire — `fetchFleetCapacity`
 * (`./client.ts`) sums `capacity.active`/`capacity.max` across every row
 * client-side, the same way the pre-#76 `summarizeFleetCapacity` summed
 * per-machine roster fields (just sourced from the real endpoint now). */
export interface MachineStatsRow {
  name: string
  capacity: MachineCapacity
  counts: MachineJobCounts
  job_history: MachineJobHistoryEntry[]
}

/** One machine's work-stats summary, derived from its `MachineStatsRow`
 * (`fetchMachineWorkStats`, `./client.ts`) — the completed/failed counts
 * `MachineDetail`'s Work stats section renders. */
export interface MachineWorkStats {
  machine: string
  assignments_completed: number
  assignments_failed: number
}

/** Fleet-*scope* health checks (#66): facts about the fleet as a whole, not
 * any one machine's — `MachinesHealthResponse.fleet_checks`. `FleetSummary`
 * (`src/components/FleetSummary.tsx`) mirrors `coord.health.aggregate`'s
 * counting rule client-side: one unit per machine's joined severity, plus
 * one unit per entry here. */
export type FleetChecks = MachineHealthCheckResult[]

// ── GET /api/gate-a/{repo}/{tracking_issue} (claude-coordinator#3069 / coord-web#90) ──
//
// Hand-spliced, not a full regeneration of this file. A real
// `python -m coord.codegen --out src/api/generated.ts` run (installed
// `code-coordinator==0.5.359`, the version this line was verified against)
// DOES now work from this checkout — claude-coordinator#3045/coord-web#77's
// blocker is resolved — but running it wholesale rewrites/renames dozens of
// unrelated types this file's other sections hand-maintain (Machines panel,
// Reports panel, DriveQueue, Assignment's newer fields), breaking every
// consumer of those sections (`client.ts`, `MachinesPanel.tsx`,
// `MachineHealth.tsx`, `MachineCharts.tsx`, `MachineDetail.tsx`,
// `ReportsPanel.tsx`, `DriveQueuePanel.tsx` and their tests). That drift
// predates this issue and fixing it is a real, separate, repo-wide task —
// not something to fold silently into a Gate-A review panel PR. The three
// interfaces below ARE the generator's real, verbatim output for this one
// route (copied field-for-field from that run, not hand-guessed — see this
// repo's CLAUDE.md "three separate incidents" note) and should be replaced
// wholesale, not re-diffed, whenever the full-file regeneration above
// finally happens.

/** `GET /api/gate-a/{repo}/{tracking_issue}`'s full response shape — see
 * `coord/dashboard/server.py`'s `GateAPacket` dataclass. `state`/`ok`/
 * `stale`/`contract_sha`/`reason`/`approval` are read straight off
 * `coord.gate_a.evaluate()` — the same decision `coord gate-a` prints — so
 * this can never disagree with the CLI. `stale` is the one field worth
 * rendering unmissably: it's `state === 'stale'` spelled out as a plain
 * bool so a client doesn't have to import the state enum just to ask one
 * question. `mocks` arrive fully self-contained (every relative stylesheet
 * already inlined server-side) — render each directly, no further
 * fetching. */
export interface GateAPacket {
  repo_name: string
  milestone_number: number
  milestone_title: string
  tracking_issue: number
  tracking_issue_title: string
  state: 'approved' | 'missing' | 'stale' | 'changes' | 'exempt'
  ok: boolean
  stale: boolean
  contract_sha: string
  reason: string | null
  approval: GateAApprovalWire | null
  contract_markdown: string
  mocks: GateAMockWire[]
  mocks_note: string
}

/** Wire shape of `coord.gate_a.GateAApproval` — the recorded human verdict
 * on a Gate-A contract. Present on `GateAPacket.approval` only when a
 * verdict has actually been recorded (`coord gate-a --approved` /
 * `--changes`, not reachable from this read-only panel — see issue #90's
 * "Not in this slice"). */
export interface GateAApprovalWire {
  verdict: 'approved' | 'changes'
  contract_sha: string
  tracking_issue: number | null
  note: string
  actor: string
  recorded_at: number
}

/** One rendered Gate-A mock, self-contained (`GateAPacket.mocks[]`) — `html`
 * has already had every relatively-linked stylesheet inlined server-side, so
 * it renders correctly with zero further fetches. */
export interface GateAMockWire {
  name: string
  title: string
  html: string
}
