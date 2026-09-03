/**
 * Pure `coord drive` queue helpers for `DriveQueuePanel` (#7 QW-3).
 *
 * Two things live here, each mirroring a specific upstream source of truth
 * rather than inventing its own:
 *
 * - The **summary block**'s numbers (`driveQueueSummaryStats`) are read
 *   verbatim off `GET /api/drive-queue`'s server-computed aggregate
 *   (`DriveQueueSummary`, from `coord.drive_queue.summarize_drive_queue`).
 *   This module performs no arithmetic over raw entries to reproduce those
 *   counts -- same "one aggregate, many readers" posture the TUI's own
 *   `queue_sidebar` takes (`tui/src/app/drive_queue.rs`), which reads that
 *   same result one count per row instead of recomputing client-side.
 * - The **grid**'s per-cell formatting (`queueHoldCell`, `queueReasonCell`,
 *   ...) mirrors the TUI's per-entry cell formatter (`Self::queue_row` /
 *   `queue_hold_cell` / `queue_reason_cell` / `format_age`, same file) and
 *   `coord/drive_queue.py`'s wire constants (`HOLD_FIRED`, `HOLD_SCOPE_FLEET`)
 *   cell-for-cell, so the two surfaces never disagree about what a cell says.
 *   Row *selection* -- which entries even reach that formatter -- is a
 *   separate concern, handled by `filterActiveQueueEntries` below, which
 *   mirrors the TUI's `queue_rows()` instead.
 *
 * #82 deliberately broke TUI column parity: the grid now collapses to three
 * columns at rest (`#`, `Issue`, `Title`, `State` minus the position, which
 * moved into the expanded region) with everything else -- `Machine`, `Tries`,
 * `After`, `Hold`, `Reason`, timestamps, `Actions` -- revealed per-row on
 * demand. `Machine` and `Tries` are gone outright (see `queueLiveMachineCell`
 * / `queuePinnedMachine` and the honest `attempts`/`deferrals`/`resumes`
 * fields below for why). Every *cell* helper below still formats a plain
 * string; which column or region it lands in is `DriveQueuePanel`'s call.
 *
 * Row *actions* (#8 QW-4) live at the bottom of this module: the same guards
 * the TUI's `queue_unblock_selected` / `queue_resume_selected` enforce before
 * mutating (`canUnblockQueueEntry` / `canReleaseQueueGate`), plus the
 * move-up/move-down neighbour math (`queueMoveNeighbor` /
 * `applyQueueMoveOptimistic`) `DriveQueuePanel` uses for its optimistic
 * reorder. Mutating the queue itself -- the actual `driveQueueAction` POST --
 * stays in the component; everything here is pure.
 */
import type { BoardDriveQueueEntry, DriveQueueSummary, PipelineView } from '@/api/client'
import { aliasIssueRef } from '@/lib/repoRef'

/** Mirrors `coord/drive_queue.py`'s terminal `state` wire value. `done` rows
 * are set in place rather than deleted -- `coord/dao.py` applies no
 * retention cap to the `drive_queue` table, unlike `assignments` /
 * `notifications` -- so a raw `entries` list keeps every completed row
 * forever unless something filters them back out. */
const QUEUE_STATE_DONE = 'done'

// ── active-entry filter ─────────────────────────────────────────────────────

/**
 * Drop rows that are no longer "in the queue" for display purposes: `GET
 * /api/drive-queue`'s `entries` field is the raw, unfiltered table dump
 * (`coord/dashboard/server.py`'s `api_drive_queue` docstring / `_read_drive_queue`),
 * not pre-scoped to active work.
 *
 * Mirrors `queue_rows()` in `tui/src/app/drive_queue.rs` (`is_pending(e) ||
 * is_holding(e)`): a `done` entry is excluded unless its deploy gate is
 * still fired, since a fired gate is itself live state worth surfacing even
 * after the row's own work finished. Non-`done` states (`waiting`,
 * `running`, `blocked`, ...) always pass through untouched.
 *
 * Callers must apply this *before* `driveQueueRepoOptions` and
 * `filterQueueEntriesByRepo` -- otherwise both the dropdown's option list
 * and the grid can be inflated by history that will never leave the table.
 */
export function filterActiveQueueEntries(
  entries: readonly BoardDriveQueueEntry[],
): BoardDriveQueueEntry[] {
  return entries.filter((e) => e.state !== QUEUE_STATE_DONE || isHolding(e))
}

// ── repo scope ───────────────────────────────────────────────────────────────

/**
 * Distinct repo names present in `entries`, alphabetical -- the repo-scope
 * dropdown's "single repo" options (the other option is the fixed "All
 * repos" choice, which isn't one of these).
 *
 * Callers should pass entries already narrowed by `filterActiveQueueEntries`
 * so a repo whose only rows are terminal `done` (non-held) history doesn't
 * appear as a selectable scope that immediately renders an empty grid.
 */
export function driveQueueRepoOptions(entries: readonly BoardDriveQueueEntry[]): string[] {
  return Array.from(new Set(entries.map((e) => e.repo_name))).sort()
}

/**
 * Narrow `entries` to one repo. `repo === null` (the "All repos" choice)
 * returns every entry unchanged.
 *
 * Filters client-side over one unscoped fetch rather than re-fetching
 * `GET /api/drive-queue?repo=...` per scope change: `fetchDriveQueue`'s own
 * doc comment notes the server's `summary` is always computed over the full,
 * unfiltered queue regardless of `?repo=`, so a server round trip buys
 * nothing here but latency -- switching scopes this way is instant, and the
 * dropdown's own option list (`driveQueueRepoOptions`) never has to be
 * recomputed from an already-narrowed response.
 */
export function filterQueueEntriesByRepo(
  entries: readonly BoardDriveQueueEntry[],
  repo: string | null,
): BoardDriveQueueEntry[] {
  if (!repo) return [...entries]
  return entries.filter((e) => e.repo_name === repo)
}

// ── summary block ────────────────────────────────────────────────────────────

export interface DriveQueueSummaryStat {
  key: string
  label: string
  value: string
}

/**
 * Format `summary` into the five stats the summary block renders: pending,
 * running, waiting (with eligible folded in, same as the TUI's
 * `"{waiting} waiting ({eligible} eligible)"` sidebar line), blocked, held.
 *
 * Reads `summary`'s fields verbatim -- see this module's doc comment for why
 * that's load-bearing, not a style choice.
 */
export function driveQueueSummaryStats(summary: DriveQueueSummary): DriveQueueSummaryStat[] {
  return [
    { key: 'pending', label: 'Pending', value: String(summary.pending) },
    { key: 'running', label: 'Running', value: String(summary.running) },
    { key: 'waiting', label: 'Waiting', value: `${summary.waiting} (${summary.eligible} eligible)` },
    { key: 'blocked', label: 'Blocked', value: String(summary.blocked) },
    { key: 'held', label: 'Held', value: String(summary.held) },
  ]
}

// ── grid cells ───────────────────────────────────────────────────────────────

/** What an absent cell value renders as -- a blank cell and a failed paint
 * look identical; an em dash says "there is nothing here" out loud. Same
 * convention as `QUEUE_EMPTY_CELL` in `tui/src/app/drive_queue.rs`. */
export const QUEUE_EMPTY_CELL = '—'

/** Mirrors `coord/drive_queue.py`'s `HOLD_FIRED` wire constant. */
const HOLD_STATE_FIRED = 'fired'
/** Mirrors `coord/drive_queue.py`'s `HOLD_SCOPE_FLEET` wire constant. */
const HOLD_SCOPE_FLEET = 'fleet'

function repoIssueKey(repo: string, issue: number): string {
  return `${repo}#${issue}`
}

/** `repo_name#issue_number` -- the same key format `after_json` entries use
 * (`BoardDriveQueueEntry`'s doc comment), so an `After` cell's contents are
 * directly comparable to this. */
export function queueEntryKey(entry: BoardDriveQueueEntry): string {
  return repoIssueKey(entry.repo_name, entry.issue_number)
}

/** Is this entry's own deploy gate currently fired? Read straight off
 * `hold_state`, never re-derived -- mirrors `is_holding` in
 * `tui/src/app/drive_queue.rs`. */
function isHolding(entry: BoardDriveQueueEntry): boolean {
  return entry.hold_state === HOLD_STATE_FIRED
}

/** The `State` cell. */
export function queueStateCell(entry: BoardDriveQueueEntry): string {
  return entry.state || QUEUE_EMPTY_CELL
}

/**
 * `repo#issue -> machine_name`, built from the same `/api/pipeline` roster
 * `buildQueueTitleLookup` reads (#82). `drive_queue.machine` is only the
 * optional `--machine` *pin* (`QueueEntry.machine`, default `""`,
 * `coord/drive_queue.py`) -- unpinned entries, i.e. effectively all of them,
 * have nothing there, which is a structural fact about the pin column, not a
 * transient gap in the live machine. `PipelineView.machine_name` names the
 * machine actually running the entry's current leg, which is what an
 * operator expanding a row wants to read as "Machine".
 */
export function buildQueueMachineLookup(views: readonly PipelineView[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const v of views) {
    map[repoIssueKey(v.repo_name, v.issue_number)] = v.machine_name
  }
  return map
}

/** The expanded region's `Machine` field, resolved against
 * `buildQueueMachineLookup`'s map -- the *live* machine, not the pin. An
 * entry with no matching pipeline row (never yet dispatched, or dispatched
 * to a leg the roster no longer carries) renders the empty cell rather than
 * a guess, same fallback posture as `queueTitleCell`. */
export function queueLiveMachineCell(
  entry: BoardDriveQueueEntry,
  machineByKey: Readonly<Record<string, string>>,
): string {
  return machineByKey[queueEntryKey(entry)] || QUEUE_EMPTY_CELL
}

/**
 * The expanded region's `Pinned to` field -- the raw `--machine` pin, or
 * `null` when unset. Deliberately `null` rather than the em-dash empty cell:
 * the issue's ask is to show this field "only when non-empty", i.e. omit the
 * `<dt>`/`<dd>` pair entirely on an unpinned (the common) row, not render it
 * dashed out like a value that's merely unknown.
 */
export function queuePinnedMachine(entry: BoardDriveQueueEntry): string | null {
  return entry.machine ? entry.machine : null
}

/** The `After` cell -- pre-req keys, comma-joined, each aliased for display
 * (#46) via `aliasIssueRef` -- `entry.after_json` itself stays the raw
 * `repo#N` wire format `queueEntryKey` produces, only the rendered cell text
 * is aliased. */
export function queueAfterCell(entry: BoardDriveQueueEntry): string {
  return entry.after_json.length > 0
    ? entry.after_json.map(aliasIssueRef).join(', ')
    : QUEUE_EMPTY_CELL
}

/**
 * The `Hold` cell -- mirrors `queue_hold_cell` in
 * `tui/src/app/drive_queue.rs` exactly: `FIRED` (scope spelled out only for
 * the fleet-wide case, silent for the default entry scope, same as
 * `coord/drive_queue.py`'s `render_plan` scope tag), the raw `hold_state`
 * while a gate is merely armed but not fired, or the empty cell when this
 * entry carries no gate at all (`hold_after === 0`).
 */
export function queueHoldCell(entry: BoardDriveQueueEntry): string {
  if (isHolding(entry)) {
    return entry.hold_scope === HOLD_SCOPE_FLEET ? 'FIRED [fleet]' : 'FIRED'
  }
  if (entry.hold_after === 0) return QUEUE_EMPTY_CELL
  return entry.hold_state || 'gate'
}

/**
 * "3h ago" style age for a `reason_at` epoch-SECONDS timestamp, relative to
 * `now` (epoch milliseconds, `Date.now()`-shaped -- injectable so tests don't
 * depend on the real clock). Mirrors `format_age` in `tui/src/app/mod.rs`:
 * seconds under a minute, minutes under an hour, hours under a day, days
 * beyond. Empty string for a missing/non-positive timestamp -- a row
 * predating #2133's migration, rather than a guessed age.
 */
export function formatQueueAge(reasonAt: number | null, now: number = Date.now()): string {
  if (reasonAt == null || reasonAt <= 0) return ''
  const secs = Math.max(0, Math.floor(now / 1000 - reasonAt))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

/**
 * The `Reason` cell -- `last_reason` age-stamped with `reason_at` (#2133):
 * rendering a snapshot reason bare would let an hours-old, no-longer-true
 * observation read as a live diagnosis. Mirrors `queue_reason_cell` in
 * `tui/src/app/drive_queue.rs`.
 */
export function queueReasonCell(entry: BoardDriveQueueEntry, now: number = Date.now()): string {
  if (!entry.last_reason) return QUEUE_EMPTY_CELL
  const age = formatQueueAge(entry.reason_at, now)
  return age ? `${entry.last_reason} (${age})` : entry.last_reason
}

/**
 * The expanded region's `Enqueued` field -- age of `enqueued_at`, an
 * epoch-seconds timestamp that (unlike `reason_at`) is never null on the
 * wire (`BoardDriveQueueEntry.enqueued_at: number`). Still routed through
 * `formatQueueAge` rather than assumed non-zero: a row predating #2133's
 * migration can carry `0`, which reads the same as "unknown" here as it does
 * for `reason_at`.
 */
export function queueEnqueuedCell(entry: BoardDriveQueueEntry, now: number = Date.now()): string {
  return formatQueueAge(entry.enqueued_at, now) || QUEUE_EMPTY_CELL
}

/** The expanded region's `Launched` field -- age of `launched_at`, empty
 * cell for a row that hasn't launched yet (`launched_at === null`). */
export function queueLaunchedCell(entry: BoardDriveQueueEntry, now: number = Date.now()): string {
  return formatQueueAge(entry.launched_at, now) || QUEUE_EMPTY_CELL
}

/**
 * The expanded region's `Reason updated` field -- age of `reason_at` on its
 * own, separate from the age already folded into `queueReasonCell`'s prose
 * (`"checks_failed (3h ago)"`). The issue asks for the row's timestamps to be
 * surfaced in the expanded region in their own right, not just embedded
 * inside another field's text.
 */
export function queueReasonAtCell(entry: BoardDriveQueueEntry, now: number = Date.now()): string {
  return formatQueueAge(entry.reason_at, now) || QUEUE_EMPTY_CELL
}

// ── title lookup ─────────────────────────────────────────────────────────────

/**
 * `repo#issue -> issue_title`, built from the Pipeline panel's own cached
 * `/api/pipeline` roster (a `useQuery(['pipeline'], ...)` cache read, not a
 * dedicated fetch -- see `DriveQueuePanel`).
 *
 * `drive_queue` is a raw table dump with no title column of its own (same
 * reasoning as the TUI's `queue_issue_title`, which falls back through the
 * board cache, the pipeline roster and the assignment list rather than
 * adding a fetch dedicated to titles -- a second source of truth this panel
 * exists to avoid). This is the one of those three sources coord-web already
 * has warm in its query cache; an entry with no matching pipeline row (e.g.
 * `waiting`, never yet dispatched) renders the empty cell via
 * `queueTitleCell` rather than a guess.
 */
export function buildQueueTitleLookup(views: readonly PipelineView[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const v of views) {
    map[repoIssueKey(v.repo_name, v.issue_number)] = v.issue_title
  }
  return map
}

/** The `Title` cell, resolved against `buildQueueTitleLookup`'s map. */
export function queueTitleCell(
  entry: BoardDriveQueueEntry,
  titleByKey: Readonly<Record<string, string>>,
): string {
  return titleByKey[queueEntryKey(entry)] || QUEUE_EMPTY_CELL
}

// ── row actions (#8 QW-4) ────────────────────────────────────────────────────

/** Mirrors `coord/drive_queue.py`'s `blocked` wire state -- the one state
 * `queue_unblock_selected` (`tui/src/app/drive_queue.rs`) accepts; any other
 * state is a refused no-op there. */
const QUEUE_STATE_BLOCKED = 'blocked'

/**
 * Can this entry be unblocked? Same guard `queue_unblock_selected` enforces
 * in the TUI: "unblock" only means something on a row the queue itself has
 * marked `blocked`. Rendered as a *disabled* button rather than hidden when
 * this is `false` -- the action's existence stays discoverable even when it
 * doesn't apply to this row (per the issue's own "rich client, not hotkeys"
 * framing).
 */
export function canUnblockQueueEntry(entry: BoardDriveQueueEntry): boolean {
  return entry.state === QUEUE_STATE_BLOCKED
}

/**
 * Can this entry's deploy gate be released? Same guard `queue_resume_selected`
 * enforces in the TUI: only a *fired* gate (`isHolding`) can be released --
 * an armed-but-not-yet-fired gate, or no gate at all, refuses the same way
 * there. Deliberately reuses `isHolding` rather than re-deriving the check,
 * so this and `queueHoldCell`'s `FIRED` rendering can never disagree about
 * what "fired" means.
 */
export function canReleaseQueueGate(entry: BoardDriveQueueEntry): boolean {
  return isHolding(entry)
}

/**
 * The entry immediately above (`direction: 'up'`) or below (`'down'`) `entry`
 * in `entries`' own order -- `null` when `entry` is already first/last (or
 * isn't in `entries` at all), which doubles as "this move is illegal" for the
 * ▲/▼ buttons' disabled guard.
 *
 * Deliberately walks the *displayed* order (whatever `entries` the caller
 * passes -- typically the repo-scoped, active-filtered grid rows), not the
 * full unfiltered queue: a "move up" click should mean "swap with the row
 * visibly above this one", not a jump across rows the current repo scope is
 * hiding.
 */
export function queueMoveNeighbor(
  entries: readonly BoardDriveQueueEntry[],
  entry: BoardDriveQueueEntry,
  direction: 'up' | 'down',
): BoardDriveQueueEntry | null {
  const index = entries.findIndex((e) => e.id === entry.id)
  if (index === -1) return null
  const neighborIndex = direction === 'up' ? index - 1 : index + 1
  return entries[neighborIndex] ?? null
}

/**
 * The optimistic result of swapping `entry` and `neighbor`'s `position`
 * fields (re-sorted by the new positions) -- what a `move` action is expected
 * to converge to once the server round trip lands, per the issue's
 * "reorder immediately, reconcile on the next poll" ask. Operates over
 * whatever `entries` the caller passes (typically the *raw*, unscoped list
 * backing the query cache, so the swap survives a repo-scope change) and
 * returns a new array -- `entries` itself is left untouched.
 *
 * A no-op (returns `entries` unchanged, still re-sorted) if either id isn't
 * present -- callers only reach this after `queueMoveNeighbor` already
 * confirmed both rows exist, but this stays defensive rather than throwing on
 * a stale reference.
 */
export function applyQueueMoveOptimistic(
  entries: readonly BoardDriveQueueEntry[],
  entry: BoardDriveQueueEntry,
  neighbor: BoardDriveQueueEntry,
): BoardDriveQueueEntry[] {
  return entries
    .map((e) => {
      if (e.id === entry.id) return { ...e, position: neighbor.position }
      if (e.id === neighbor.id) return { ...e, position: entry.position }
      return e
    })
    .sort((a, b) => a.position - b.position)
}
