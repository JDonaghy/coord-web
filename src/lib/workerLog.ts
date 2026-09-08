/**
 * Client-side turn-by-turn rendering for `GET /api/assignment/{id}/log`
 * (claude-coordinator#3195, coord-web#110).
 *
 * The dashboard server proxies the owning agent's NDJSON log bytes
 * *verbatim* — its own doc comment is explicit that it "parses nothing...
 * a second parser here would drift from the TUI's own turn-by-turn
 * rendering". That constraint is about the SERVER: coord-web has no NDJSON
 * parser of its own to keep in sync with a second one. This module *is*
 * this repo's one interpretation of that NDJSON on the client — necessary
 * because a browser SSE frame is opaque bytes until something turns it into
 * "Turn 68 +23s" / "→ Bash: ..." — written from the same wire shape
 * `coord/worker_events.py` (claude-coordinator, not vendored here) already
 * documents: `claude -p --output-format stream-json --verbose` emits one
 * JSON object per line, and the agent writes that stream to
 * `~/.coord/logs/<assignment_id>.log` unmodified. See that module's own doc
 * comment for the fuller field-shape catalogue this deliberately only
 * covers the subset of.
 *
 * Deliberately permissive, matching `worker_events.py`'s own posture: an
 * unparseable line (blank, a `# argv=...`/`# reap: ...` comment the agent
 * itself prepends/appends, a non-object JSON value) is skipped, never
 * thrown. The stream-json shape has changed over time and varies between
 * claude versions; a client that opens the Log view for one bad line is a
 * strictly worse experience than one that quietly drops it.
 *
 * `LogEntry` intentionally covers *less* than `worker_events.py`'s
 * `render_event` does: `tool_progress` heartbeats, `system`/
 * `thinking_tokens` chatter, and raw `user`/`tool_result` echoes are all
 * real lines in the file but are not among the things #110 asks this view
 * to show (turn markers + narration, tool calls, and "inline events... that
 * explain a gap in the timings" like `rate_limit_event`) — folding them in
 * would just be noise on a desktop-width scrolling feed. Nothing here
 * *drops* the rate_limit signal itself: every `rate_limit_event` becomes an
 * entry, not only the throttled ones (`worker_events.py`'s own
 * `render_event` — the full-transcript renderer `coord log` uses, as
 * opposed to `format_important_event`'s filtered `coord watch` feed — makes
 * the same choice, for the same reason: a healthy `allowed` status is still
 * useful evidence of what happened when, in a full transcript).
 */

// ── Line parsing ─────────────────────────────────────────────────────────────

export interface WorkerLogEvent {
  type: string
  subtype: string | null
  /** Epoch ms, parsed from the line's own `timestamp` field (an ISO-8601
   * string on `assistant`/`user` lines in current claude versions) when
   * present and parseable; `null` for every other line shape, including
   * older logs that predate the field. Turn deltas silently go `null` too
   * when this is `null` — see `buildLogEntries` — rather than guessing. */
  timestamp: number | null
  raw: Record<string, unknown>
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Parse one NDJSON line into a `WorkerLogEvent`, or `null` for a blank
 * line, a `#`-prefixed comment the agent itself writes, or anything that
 * isn't a JSON object — mirrors `coord.worker_events.parse_event`. */
export function parseWorkerLogLine(line: string): WorkerLogEvent | null {
  if (!line || !line.trim()) return null
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const obj = data as Record<string, unknown>
  return {
    type: typeof obj.type === 'string' ? obj.type : 'unknown',
    subtype: typeof obj.subtype === 'string' ? obj.subtype : null,
    timestamp: parseTimestamp(obj.timestamp),
    raw: obj,
  }
}

/** `parseWorkerLogLine` over every line of a (possibly multi-line) string —
 * for a one-shot parse of an already-complete chunk. Streaming callers that
 * receive the log incrementally over SSE should use `splitCompleteLines`
 * first so a chunk boundary landing mid-line never gets handed here as two
 * truncated halves. */
export function parseWorkerLogText(text: string): WorkerLogEvent[] {
  const events: WorkerLogEvent[] = []
  for (const line of text.split('\n')) {
    const event = parseWorkerLogLine(line)
    if (event) events.push(event)
  }
  return events
}

/**
 * Fold a newly-arrived SSE chunk into `buffer` (whatever was left over,
 * unterminated, from the previous chunk) and split off every *complete*
 * line — one held back as the new remainder.
 *
 * The live (non-fixture) proxy path polls the owning agent for new bytes on
 * a fixed cadence (`coord/dashboard/server.py`'s `_fetch_agent_log`) and
 * forwards whatever it read, which has no reason to land on a line
 * boundary — a chunk can end mid-JSON-object. Parsing an incomplete line
 * either throws (caught, silently dropped by `parseWorkerLogLine` — losing
 * that turn) or, worse, parses as valid-but-wrong JSON if the truncation
 * happens to close some outer brace early. Buffering until a `\n` arrives
 * is the same fix `coord.events._read_log_chunk`'s own byte-offset cursor
 * exists to make safe on the server's read side; this is the client-side
 * half of the same problem.
 */
export function splitCompleteLines(
  buffer: string,
  chunk: string,
): { lines: string[]; remainder: string } {
  const combined = buffer + chunk
  const parts = combined.split('\n')
  const remainder = parts.pop() ?? ''
  return { lines: parts, remainder }
}

// ── Content-block extraction (assistant message shape) ──────────────────────

interface ContentBlock {
  type?: unknown
  text?: unknown
  name?: unknown
  input?: unknown
}

function contentBlocks(event: WorkerLogEvent): ContentBlock[] {
  const message = event.raw.message
  if (!message || typeof message !== 'object') return []
  const content = (message as Record<string, unknown>).content
  if (!Array.isArray(content)) return []
  return content.filter((b): b is ContentBlock => typeof b === 'object' && b !== null)
}

/** First `text`-type content block's text, trimmed — `''` for a turn that
 * was purely thinking and/or tool calls (mirrors
 * `worker_events._assistant_text`, minus its top-level-`text` fallback,
 * which no real claude stream-json shape has ever used per that module's
 * own comment history). */
function assistantText(event: WorkerLogEvent): string {
  for (const block of contentBlocks(event)) {
    if (block.type === 'text' && typeof block.text === 'string') return block.text.trim()
  }
  return ''
}

export interface ToolCall {
  name: string
  /** The command (Bash) or path (Edit/Write/NotebookEdit), when the input
   * shape carries one this module recognises; `null` for a tool call whose
   * input has no single obvious "what did it do" string to show inline. */
  detail: string | null
}

const PATH_TOOL_INPUT_KEYS = ['file_path', 'path', 'notebook_path', 'filePath'] as const

function toolDetail(name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const lower = name.toLowerCase()
  if (lower === 'bash' && typeof obj.command === 'string') return obj.command
  if (lower === 'edit' || lower === 'write' || lower === 'notebookedit') {
    for (const key of PATH_TOOL_INPUT_KEYS) {
      const value = obj[key]
      if (typeof value === 'string') return value
    }
  }
  return null
}

function toolCalls(event: WorkerLogEvent): ToolCall[] {
  const calls: ToolCall[] = []
  for (const block of contentBlocks(event)) {
    if (block.type !== 'tool_use' || typeof block.name !== 'string') continue
    calls.push({ name: block.name, detail: toolDetail(block.name, block.input) })
  }
  return calls
}

// ── Turn-stream entries ──────────────────────────────────────────────────────

export interface TurnEntry {
  kind: 'turn'
  key: string
  turn: number
  atMs: number | null
  /** Wall-clock gap since the *previous* turn with a known timestamp, in
   * ms — `null` for the first turn, or when either timestamp is unknown
   * (an older log, or a line this parser doesn't recognise). */
  deltaMs: number | null
  text: string
  tools: ToolCall[]
}

export interface RateLimitEntry {
  kind: 'rate_limit'
  key: string
  status: string | null
  /** Epoch seconds, straight off the wire's `resetsAt` — left unconverted
   * (not ms) since nothing here does arithmetic on it, only displays it. */
  resetsAt: number | null
}

export interface ResultEntry {
  kind: 'result'
  key: string
  costUsd: number | null
  stopReason: string | null
  numTurns: number | null
  durationMs: number | null
  isError: boolean
}

export type LogEntry = TurnEntry | RateLimitEntry | ResultEntry

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** Walk a full (already ordered) event list and produce the entries the
 * turn stream renders. Re-run over the whole accumulated event list on
 * every new chunk rather than incrementally folded — the accumulated log
 * for even a very long-running leg is a few thousand lines, cheap to
 * re-walk, and re-deriving from scratch means a bug can never leave a
 * dangling half-updated turn counter behind. */
export function buildLogEntries(events: readonly WorkerLogEvent[]): LogEntry[] {
  const entries: LogEntry[] = []
  let turn = 0
  let prevTurnAtMs: number | null = null

  events.forEach((event, i) => {
    if (event.type === 'assistant') {
      turn += 1
      const atMs = event.timestamp
      const deltaMs = atMs != null && prevTurnAtMs != null ? atMs - prevTurnAtMs : null
      if (atMs != null) prevTurnAtMs = atMs
      entries.push({
        kind: 'turn',
        key: `turn-${i}`,
        turn,
        atMs,
        deltaMs,
        text: assistantText(event),
        tools: toolCalls(event),
      })
      return
    }

    if (event.type === 'rate_limit_event') {
      const info = event.raw.rate_limit_info
      const infoObj = info && typeof info === 'object' ? (info as Record<string, unknown>) : {}
      entries.push({
        kind: 'rate_limit',
        key: `rate-limit-${i}`,
        status: strOrNull(infoObj.status),
        resetsAt: numOrNull(infoObj.resetsAt),
      })
      return
    }

    if (event.type === 'result') {
      entries.push({
        kind: 'result',
        key: `result-${i}`,
        costUsd: numOrNull(event.raw.total_cost_usd ?? event.raw.cost_usd),
        stopReason: strOrNull(event.raw.stop_reason ?? event.raw.subtype),
        numTurns: numOrNull(event.raw.num_turns),
        durationMs: numOrNull(event.raw.duration_ms ?? event.raw.duration),
        isError: Boolean(event.raw.is_error),
      })
    }
  })

  return entries
}

export interface TurnStats {
  turnCount: number
  firstTurnAtMs: number | null
  lastTurnAtMs: number | null
}

/** The running totals `StageRail` shows on the currently in-flight stage —
 * `Work T76  6m54s` is `turnCount` + an elapsed time the caller derives from
 * `firstTurnAtMs` (LogPanel ticks a live clock off it while the stage is
 * still active; a finished stage uses `lastTurnAtMs` instead, both outside
 * this module since neither "now" nor "is this stage still active" is a
 * fact the parsed event list carries). */
export function turnStats(events: readonly WorkerLogEvent[]): TurnStats {
  let turnCount = 0
  let firstTurnAtMs: number | null = null
  let lastTurnAtMs: number | null = null
  for (const event of events) {
    if (event.type !== 'assistant') continue
    turnCount += 1
    if (event.timestamp != null) {
      if (firstTurnAtMs == null) firstTurnAtMs = event.timestamp
      lastTurnAtMs = event.timestamp
    }
  }
  return { turnCount, firstTurnAtMs, lastTurnAtMs }
}

// ── Duration formatting ──────────────────────────────────────────────────────

/** `45s` / `6m54s` / `1h23m` — compact, no spaces, matching the issue's own
 * `Work T76  6m54s` example. */
export function formatCompactDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h${minutes}m`
  if (minutes > 0) return `${minutes}m${seconds}s`
  return `${seconds}s`
}

/** `+23s` — a turn's delta, de-emphasised text alongside its turn number.
 * `null` in, `null` out: `TurnMarker` skips the whole delta suffix rather
 * than rendering a fabricated `+0s` for the first turn / an unknown gap. */
export function formatDelta(ms: number | null): string | null {
  if (ms == null) return null
  return `+${formatCompactDuration(Math.max(0, ms))}`
}
