/**
 * Presentation logic for the Journal panel (#93) — the pure half of
 * "a submission's run as a narrative", kept out of `JournalPanel.tsx` so it
 * can be unit-tested without a DOM. Same "component orchestrates, lib
 * validates/derives" split `AnswersPanel`/`src/lib/portal.ts` and
 * `DriveQueuePanel`/`src/lib/driveQueue.ts` already establish.
 *
 * The wire-shape validation lives on the other side of the seam, in
 * `src/api/client.ts`'s `validateJournal` (#85: validated, not cast) —
 * everything here may assume it is looking at a well-formed
 * `JournalEntryWire`.
 *
 * ## Why the date/time formatting is hand-rolled
 *
 * `Intl`/`toLocaleDateString` output varies by the host's locale *and* by
 * ICU version, so a "Mon 3 Feb" assertion written on one machine can fail on
 * another for reasons that have nothing to do with the code. This panel's
 * day headings and per-entry times are structural (they are what turns forty
 * rows into a narrative), so they are built from fixed tables below and are
 * byte-identical everywhere. They still respect the *viewer's* timezone —
 * `Date`'s local getters — because "which day did this happen on" means the
 * day it was where the person reading is, which is the whole point of
 * grouping by it.
 */
import type { JournalEntryWire } from '@/api/client'

/**
 * How an entry kind reads to a human, and which of five *forms* it takes.
 *
 * Issue #93: "a client answering a question, a design round going out, a
 * sign-off landing and a merge are different kinds of event and should not
 * read as one undifferentiated feed. Encode kind in form, not just text." So
 * `tone` is what `JournalPanel` maps to a marker colour/shape, and it is
 * grouped by *who or what the moment belongs to*, not by which coord
 * subsystem happened to record it:
 *
 *   - `client`   — the client acted (answered, signed off).
 *   - `design`   — something was published for the client to look at.
 *   - `ship`     — code moved (dispatched to a worker, merged).
 *   - `status`   — the run's own state changed.
 *   - `internal` — operator/coord bookkeeping around the above.
 *
 * The kind vocabulary is claude-coordinator's, read off
 * `coord.portal_store`'s `LEDGER_KIND_*` constants plus
 * `_JOURNAL_AUDIT_EVENT_TYPES` (`dispatched`, `merged`) at
 * `code-coordinator` 0.5.368. It is deliberately **not** a closed union:
 * `JournalEntryWire.kind` is a bare `string` on the wire, and a coord server
 * newer than this bundle will send kinds that aren't here (the version-skew
 * case CLAUDE.md calls out). `journalKindMeta` degrades those to a
 * humanised label rather than dropping the row — a moment nobody has taught
 * this panel about is still part of the story.
 */
export type JournalTone = 'client' | 'design' | 'ship' | 'status' | 'internal'

export interface JournalKindMeta {
  /** Short label shown on the row's kind chip. */
  label: string
  tone: JournalTone
  /** Verb for the row's artifact link, when the entry carries one. */
  artifactLabel: string
}

export const JOURNAL_KIND_META: Readonly<Record<string, JournalKindMeta>> = {
  // Client-side moments.
  question_answered: { label: 'Answered', tone: 'client', artifactLabel: 'Open' },
  answer_confirmed: { label: 'Answer confirmed', tone: 'client', artifactLabel: 'Open' },
  signoff_recorded: { label: 'Sign-off', tone: 'client', artifactLabel: 'Open' },
  draft_approved: { label: 'Draft approved', tone: 'client', artifactLabel: 'Open' },
  draft_rejected: { label: 'Draft rejected', tone: 'client', artifactLabel: 'Open' },
  draft_edited: { label: 'Draft edited', tone: 'client', artifactLabel: 'Open' },

  // Things published for the client to look at.
  design_round_published: { label: 'Design round', tone: 'design', artifactLabel: 'Open bundle' },
  preview_published: { label: 'Preview', tone: 'design', artifactLabel: 'Open preview' },
  question_pushed: { label: 'Question sent', tone: 'design', artifactLabel: 'Open' },

  // Code moving (the audit trail's business tier).
  dispatched: { label: 'Dispatched', tone: 'ship', artifactLabel: 'Open' },
  merged: { label: 'Merged', tone: 'ship', artifactLabel: 'Open PR' },
  work_shipped: { label: 'Shipped', tone: 'ship', artifactLabel: 'Open' },

  // The run's own state.
  status_changed: { label: 'Status', tone: 'status', artifactLabel: 'Open' },
  work_started: { label: 'Work started', tone: 'status', artifactLabel: 'Open' },

  // Bookkeeping.
  operator_note: { label: 'Note', tone: 'internal', artifactLabel: 'Open' },
} as const

const UNKNOWN_KIND_META: JournalKindMeta = {
  label: 'Event',
  tone: 'internal',
  artifactLabel: 'Open',
}

/** `some_event_kind` -> `Some event kind`, for a kind this bundle predates. */
function humaniseKind(kind: string): string {
  const words = kind.replace(/[_-]+/g, ' ').trim()
  if (!words) return UNKNOWN_KIND_META.label
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * How to render `kind` — always something, never `undefined`. An unknown
 * kind gets a humanised label and the neutral `internal` tone rather than
 * being hidden: see `JOURNAL_KIND_META`'s note on version skew.
 */
export function journalKindMeta(kind: string): JournalKindMeta {
  const known = Object.prototype.hasOwnProperty.call(JOURNAL_KIND_META, kind)
    ? JOURNAL_KIND_META[kind]
    : undefined
  if (known) return known
  return { ...UNKNOWN_KIND_META, label: humaniseKind(kind) }
}

/**
 * `entry.artifact` if it is safe to put in an `href`, else `null`.
 *
 * The server already promises `artifact` is "null or a URL, never a bare
 * object key" (claude-coordinator#3091), and its `_journal_url` enforces
 * *URL-shaped*. It does not enforce *web-linkable*: `javascript:alert(1)`
 * satisfies "scheme, then `://`"-adjacent parsing on some inputs, and any
 * non-http(s) scheme in an `href` a client taps is at best a dead end and at
 * worst script execution in the app's own origin. So this panel narrows to
 * `http`/`https` itself rather than trusting the far side — the same posture
 * `apiFetch`'s shape guards take toward the server's other promises.
 */
export function safeArtifactUrl(artifact: string | null | undefined): string | null {
  if (typeof artifact !== 'string') return null
  const candidate = artifact.trim()
  if (!candidate) return null
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : null
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Local-calendar `YYYY-MM-DD` for an epoch-seconds timestamp — the key day
 * grouping buckets on, and stable to sort lexicographically. */
export function journalDayKey(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** `Mon 3 Feb 2026` — the day heading. Locale-independent by construction,
 * see this module's header. */
export function journalDayLabel(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** `14:05` — a row's own time within its day. 24h, so it is unambiguous
 * without an am/pm a narrow viewport has no room for. */
export function journalTimeLabel(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export interface JournalDay {
  /** `YYYY-MM-DD`, also the `data-testid` suffix and React key. */
  key: string
  label: string
  entries: JournalEntryWire[]
}

/**
 * Split an oldest-first entry list into consecutive day buckets (#93: "Group
 * by day; the run spans days and an undifferentiated list of forty rows is
 * not a narrative").
 *
 * Consecutive-run grouping, not a `Map` keyed by day: the server's ordering
 * contract is oldest-first and `validateJournal` re-sorts to be sure, so
 * runs of one day are already contiguous, and grouping this way means a
 * hypothetical out-of-order pair shows up as two headings for the same day
 * rather than being silently re-stitched into one — visible, not papered
 * over. Returns `[]` for no entries, which the panel renders as its
 * "nothing has happened yet" state rather than an error.
 */
export function groupJournalEntriesByDay(entries: readonly JournalEntryWire[]): JournalDay[] {
  const days: JournalDay[] = []
  for (const entry of entries) {
    const key = journalDayKey(entry.ts)
    const last = days[days.length - 1]
    if (last && last.key === key) {
      last.entries.push(entry)
    } else {
      days.push({ key, label: journalDayLabel(entry.ts), entries: [entry] })
    }
  }
  return days
}

/**
 * Trim and drop empties from a submission id typed into the picker.
 * Returns `null` when there is nothing to look up, which is what keeps the
 * panel from firing a `GET /api/journal/` (no id) request at all.
 */
export function normaliseSubmissionId(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed ? trimmed : null
}
