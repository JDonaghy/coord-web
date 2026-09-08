/**
 * LogPanel — the stage rail + turn stream for one issue's leg, at
 * `/log/:repo/:issue` (#110).
 *
 * A standalone full-viewport screen, outside `ShellLayout` — the same
 * posture `GateAPanel`/`Terminal` already use for a link opened directly
 * from a queue row or Board detail rather than browsed to via the rail (see
 * `src/routes/paths.ts`'s `log()` doc comment for why this is its own
 * top-level path rather than a `Detail` tab). Two pieces, matching the
 * issue's own structure:
 *
 * - `StageRail` across the top — `Work → Test → Review → Uat → Merge`, the
 *   in-flight stage annotated with its live turn count / elapsed time.
 * - The turn stream below it — newest content appended as it streams in,
 *   built from `GET /api/assignment/{id}/log` (claude-coordinator#3195), an
 *   SSE proxy of the owning agent's raw NDJSON worker log. Per that route's
 *   own contract, the dashboard "parses nothing" — every `event: log` frame
 *   carries the agent's NDJSON bytes verbatim; `@/lib/workerLog` is this
 *   repo's one client-side interpretation of them (see that module's doc
 *   comment for why a client-side parser doesn't contradict the "render, do
 *   not re-parse" rule, which is about the *proxy*, not this app).
 *
 * The assignment to stream is resolved the same way `Detail.tsx` resolves
 * one — `['pipeline']` (the same cache Home/Detail already keep warm) +
 * `findLatestForIssue` — rather than threading an `assignment_id` through
 * the URL: a `repo`+`issue` link (from a queue row, from Board detail) is
 * what the rest of the app already addresses a "leg" by, and always means
 * "whatever the most recent attempt is", which is what `findLatestForIssue`
 * already guarantees Detail's own `assignment_id` reads agree with.
 *
 * Read-only, per #110's own scope note — no stop/retry/intervene controls.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'

import { fetchPipeline, assignmentLogUrl, type PipelineView } from '@/api/client'
import { findLatestForIssue } from '@/lib/pipeline'
import { issueRef } from '@/lib/repoRef'
import { cn } from '@/lib/utils'
import { paths } from '@/routes/paths'
import { createSseConnection, type ConnectionState } from '@/realtime/connection'
import {
  buildLogEntries,
  formatCompactDuration,
  formatDelta,
  parseWorkerLogLine,
  splitCompleteLines,
  turnStats,
  type LogEntry,
  type RateLimitEntry,
  type ResultEntry,
  type TurnEntry,
  type WorkerLogEvent,
} from '@/lib/workerLog'
import { StageRail } from '@/components/StageRail'

const shellClass = 'mx-auto w-full max-w-4xl px-4 py-6 md:px-8'

// A reader is "at the tail" once they're within this many px of the bottom —
// close enough that a new turn landing still feels like "still following",
// without demanding pixel-perfect scrollTop === scrollHeight.
const FOLLOW_THRESHOLD_PX = 48

// ── Header ────────────────────────────────────────────────────────────────────

function BackHeader({ label }: { label: string }) {
  const navigate = useNavigate()
  // Same "pop in-app history if there is any, else fall back to a real
  // route" logic as `Detail.tsx`'s `handleBack` (#1551) — this view is
  // opened from two different places (a queue row, Board detail), so there
  // is no single "the" place Back should always land; popping whatever's
  // actually on the stack is correct for both, and the pipeline list is a
  // sane landing spot for a cold deep-link with no history to pop.
  const handleBack = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(paths.pipeline())
  }, [navigate])

  return (
    <header className="mb-4 flex items-center gap-3">
      <button
        type="button"
        onClick={handleBack}
        aria-label="Back"
        className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="font-mono text-[.72rem] text-muted-foreground">{label}</span>
    </header>
  )
}

// ── Local connection label (this view's own SSE connection, not the global
// board one `ConnectionBadge` reads via `RealtimeProvider`) ────────────────

function connectionLabel(state: ConnectionState, streamEnded: boolean): { text: string; dotClass: string } {
  if (streamEnded) return { text: 'Finished', dotClass: 'bg-muted-foreground' }
  switch (state) {
    case 'live':
      return { text: 'Live', dotClass: 'bg-green-500' }
    case 'reconnecting':
      return { text: 'Reconnecting…', dotClass: 'bg-yellow-500 animate-pulse' }
    case 'disconnected':
      return { text: 'Disconnected', dotClass: 'bg-destructive' }
    case 'connecting':
    default:
      return { text: 'Connecting…', dotClass: 'bg-muted-foreground animate-pulse' }
  }
}

// ── Turn-stream rows ──────────────────────────────────────────────────────────

function TurnRow({ entry }: { entry: TurnEntry }) {
  const delta = formatDelta(entry.deltaMs)
  return (
    <div className="py-1.5" data-testid={`log-entry-turn-${entry.turn}`}>
      {/* Turn marker + delta, de-emphasised relative to content (#110). */}
      <p className="font-mono text-[.7rem] text-muted-foreground">
        Turn {entry.turn}
        {delta && <span className="ml-1.5">{delta}</span>}
      </p>
      {entry.text && (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {entry.text}
        </p>
      )}
      {entry.tools.map((tool, i) => (
        <p
          key={i}
          className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground"
        >
          <span aria-hidden="true">{'→ '}</span>
          <span className="text-foreground">{tool.name}</span>
          {tool.detail ? `: ${tool.detail}` : ''}
        </p>
      ))}
    </div>
  )
}

function RateLimitRow({ entry }: { entry: RateLimitEntry }) {
  return (
    <p
      className="py-1 font-mono text-xs text-yellow-500"
      data-testid="log-entry-rate-limit"
    >
      [rate_limit] status={entry.status ?? '?'}
      {entry.resetsAt != null &&
        ` resets_at=${new Date(entry.resetsAt * 1000).toLocaleTimeString()}`}
    </p>
  )
}

function ResultRow({ entry }: { entry: ResultEntry }) {
  const duration = entry.durationMs != null ? formatCompactDuration(entry.durationMs) : '?'
  const cost = entry.costUsd != null ? `$${entry.costUsd.toFixed(2)}` : '$?'
  return (
    <p
      className={cn(
        'py-1 font-mono text-xs',
        entry.isError ? 'text-destructive' : 'text-muted-foreground',
      )}
      data-testid="log-entry-result"
    >
      [result] {entry.isError ? 'failed' : 'completed'} in {duration}, {entry.numTurns ?? '?'}{' '}
      turns, {cost}, stop={entry.stopReason ?? '?'}
    </p>
  )
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  if (entry.kind === 'turn') return <TurnRow entry={entry} />
  if (entry.kind === 'rate_limit') return <RateLimitRow entry={entry} />
  return <ResultRow entry={entry} />
}

// ── The log stream itself ────────────────────────────────────────────────────

interface LogStreamState {
  events: WorkerLogEvent[]
  connectionState: ConnectionState
  ended: boolean
  error: string | null
}

/** Owns the SSE connection to `GET /api/assignment/{id}/log` for
 * *assignmentId*, incrementally parsing complete NDJSON lines out of each
 * `event: log` chunk (see `splitCompleteLines`'s doc comment for why a
 * chunk boundary can land mid-line) and accumulating the parsed events for
 * `buildLogEntries`/`turnStats` to walk. Re-subscribes from byte 0 whenever
 * `assignmentId` itself changes (a different leg entirely); a dropped
 * connection for the *same* assignment resumes via the browser's own
 * `Last-Event-ID` — see `assignmentLogUrl`'s doc comment. */
function useAssignmentLogStream(assignmentId: string | null): LogStreamState {
  const [state, setState] = useState<LogStreamState>({
    events: [],
    connectionState: 'connecting',
    ended: false,
    error: null,
  })

  useEffect(() => {
    if (!assignmentId) return
    let buffer = ''
    let events: WorkerLogEvent[] = []
    setState({ events: [], connectionState: 'connecting', ended: false, error: null })

    const conn = createSseConnection({
      url: assignmentLogUrl(assignmentId),
      eventTypes: ['log', 'end', 'error'],
      // The `log` payload is raw (possibly multi-line) NDJSON text, not one
      // JSON value -- see `parseJson`'s doc comment in `connection.ts` for
      // why the default JSON-or-string heuristic silently mis-handles it.
      parseJson: false,
      onEvent: (type, data) => {
        if (type === 'log') {
          const chunk = typeof data === 'string' ? data : ''
          const split = splitCompleteLines(buffer, chunk)
          buffer = split.remainder
          if (split.lines.length === 0) return
          const parsed = split.lines
            .map(parseWorkerLogLine)
            .filter((e): e is WorkerLogEvent => e !== null)
          if (parsed.length === 0) return
          events = [...events, ...parsed]
          setState((prev) => ({ ...prev, events }))
          return
        }
        if (type === 'end') {
          setState((prev) => ({ ...prev, ended: true }))
          return
        }
        // type === 'error' — `data` is the raw `data: {"error": "..."}\n\n`
        // string (this connection reads `parseJson: false`, see above), so
        // it's parsed here rather than trusted to already be an object.
        let message = 'The log stream reported an error.'
        if (typeof data === 'string' && data) {
          try {
            const parsed: unknown = JSON.parse(data)
            if (parsed && typeof parsed === 'object' && 'error' in parsed) {
              message = String((parsed as { error?: unknown }).error)
            }
          } catch {
            // Not JSON -- keep the generic message above.
          }
        }
        setState((prev) => ({ ...prev, error: message }))
      },
      onStatusChange: (status) => {
        setState((prev) => ({ ...prev, connectionState: status.state }))
      },
    })
    conn.start()
    return () => conn.stop()
  }, [assignmentId])

  return state
}

// ── Turn stream pane (scroll + follow-tail) ──────────────────────────────────

function TurnStream({ entries, streamEnded }: { entries: LogEntry[]; streamEnded: boolean }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [followTail, setFollowTail] = useState(true)

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setFollowTail(distanceFromBottom <= FOLLOW_THRESHOLD_PX)
  }, [])

  // Follow the tail while it runs (#110) -- but only until the reader
  // scrolls up: `handleScroll` above flips `followTail` off the instant
  // they leave the bottom, and this effect stops re-scrolling on every new
  // entry from that point on. Scrolling back down near the bottom (or
  // hitting "Jump to latest") turns following back on.
  useEffect(() => {
    if (!followTail) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [entries, followTail])

  return (
    <div className="relative mt-4">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="log-turn-stream"
        className="max-h-[65vh] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-black/20 px-3 py-2"
      >
        {entries.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {streamEnded ? 'No turns recorded for this leg.' : 'Waiting for the first turn…'}
          </p>
        )}
        {entries.map((entry) => (
          <LogEntryRow key={entry.key} entry={entry} />
        ))}
      </div>
      {!followTail && (
        <button
          type="button"
          onClick={() => setFollowTail(true)}
          className="absolute bottom-3 right-3 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-md hover:text-foreground"
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

function LogView({ view }: { view: PipelineView }) {
  const stream = useAssignmentLogStream(view.assignment_id)
  const entries = useMemo(() => buildLogEntries(stream.events), [stream.events])
  const stats = useMemo(() => turnStats(stream.events), [stream.events])

  // Ticks a live clock for the in-flight stage's elapsed time while the leg
  // is still running; once the stream reports `end`, elapsed freezes at the
  // last turn's own timestamp instead of drifting forward forever.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (stream.ended) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [stream.ended])

  const elapsedMs =
    stats.firstTurnAtMs == null
      ? null
      : (stream.ended ? (stats.lastTurnAtMs ?? stats.firstTurnAtMs) : nowMs) - stats.firstTurnAtMs

  const conn = connectionLabel(stream.connectionState, stream.ended)

  return (
    <>
      <section className="mb-1">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{issueRef(view.repo_name, view.issue_number)}</span>
          {' · '}
          <span className="font-mono">{view.machine_name}</span>
        </p>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <h1 className="min-w-0 truncate text-base font-semibold text-foreground">
            {view.issue_title}
          </h1>
          <span
            role="status"
            aria-label={`Log stream: ${conn.text}`}
            className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span className={cn('h-2 w-2 shrink-0 rounded-full', conn.dotClass)} aria-hidden="true" />
            {conn.text}
          </span>
        </div>
      </section>

      <div className="mt-4">
        <StageRail
          view={view}
          turnCount={stats.turnCount > 0 ? stats.turnCount : null}
          elapsedMs={elapsedMs}
        />
      </div>

      {stream.error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="log-stream-error">
          {stream.error}
        </p>
      )}

      <TurnStream entries={entries} streamEnded={stream.ended} />
    </>
  )
}

export default function LogPanel() {
  const { repo, issue } = useParams<{ repo: string; issue: string }>()

  const { data: pipeline, isLoading, isError } = useQuery({
    queryKey: ['pipeline'],
    queryFn: fetchPipeline,
  })

  const view: PipelineView | null =
    repo && issue ? findLatestForIssue(pipeline ?? [], repo, issue) : null

  return (
    <div className={shellClass}>
      <BackHeader label={repo && issue ? issueRef(repo, issue) : 'Log'} />

      {isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}

      {isError && (
        <p className="py-12 text-center text-sm text-destructive">Failed to load pipeline</p>
      )}

      {!isLoading && !isError && !view && (
        <p className="py-12 text-center text-sm text-muted-foreground" data-testid="log-not-found">
          No run to show a log for
          {repo && issue ? ` — ${issueRef(repo, issue)} has no recorded leg.` : '.'}
        </p>
      )}

      {view && <LogView view={view} />}
    </div>
  )
}
