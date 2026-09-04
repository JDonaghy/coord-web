/**
 * JournalPanel — the Journal screen's list-slot content (#93), over
 * `GET /api/journal/{submission_id}` (claude-coordinator#3091, itself the
 * served counterpart of `coord journal` / claude-coordinator#3071).
 *
 * Every other panel in this app answers "what is true now". This one answers
 * "what happened, in order" — one submission's whole run as a single ordered
 * narrative: intake, questions and answers, design rounds published and
 * signed off, previews, status transitions, dispatches and merges. It is the
 * view to put in front of someone who is not an operator (a client asking
 * what is happening, anyone watching over a screen share), so it is a story,
 * not a state dump.
 *
 * `ShellLayout` owns the frame (rail, status bar) and renders this into the
 * list slot for `/journal` and `/journal/:submissionId`, the same list-only
 * posture `DriveQueuePanel`/`ReportsPanel`/`AnswersPanel` use — there is no
 * detail view for one journal entry, the entry *is* the content.
 *
 * ## Three things this panel deliberately does not collapse together
 *
 * Issue #93 names three prior incidents in this repo (#76, #84, #85) that
 * all reduce to the same mistake: a shape or an outcome the server actually
 * produces being treated as impossible, and reaching render as a blank
 * screen. So the degraded states are first-class here, not afterthoughts:
 *
 *  - **an empty timeline is valid.** An unlinked or brand-new submission
 *    comes back `200` with `entries: []` and a `gaps` note saying why. That
 *    is a true answer and renders as "nothing has happened yet" — never an
 *    error, never a spinner that never resolves. (`coord`'s own aggregator
 *    documents this: "a submission coord has simply not done anything with
 *    yet has an empty run, which is a true answer".)
 *  - **gaps are shown, not hidden.** `gaps[]` is the server telling you the
 *    timeline is incomplete and why. Rendering the entries without it would
 *    be presenting a partial story as a whole one.
 *  - **an absent endpoint is not a crash.** `coord-web` auto-deploys on its
 *    own timer, decoupled from any claude-coordinator release (CLAUDE.md), so
 *    for as long as the fleet roll lags this bundle *is* newer than the API
 *    serving it and `/api/journal/...` will 404 as a route. That renders an
 *    explanatory empty state naming the version skew — see
 *    `fetchJournal`'s doc comment for why a 404 here is unambiguously
 *    "route absent" and never "no such submission".
 *
 * ## Error boundary
 *
 * `ShellLayout` already wraps the whole list slot in one (#87). The second,
 * inner boundary below is not redundant: it wraps *only* the timeline body,
 * so a throw while rendering one submission's run leaves the picker above it
 * alive and the operator can immediately try a different submission id
 * instead of being bounced back to Pipeline. Its `resetKey` is the
 * submission id, so switching submissions clears a latched fallback.
 */
import { type FormEvent, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Activity,
  ExternalLink,
  GitMerge,
  MessageSquareReply,
  ScrollText,
  Shapes,
  StickyNote,
  type LucideIcon,
} from 'lucide-react'

import {
  fetchJournal,
  fetchPortalNeedsInput,
  type JournalEntryWire,
  type JournalResponse,
} from '@/api/client'
import { PanelHeader } from '@/components/PanelHeader'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBoundary } from '@/shell/ErrorBoundary'
import {
  groupJournalEntriesByDay,
  journalKindMeta,
  journalTimeLabel,
  normaliseSubmissionId,
  safeArtifactUrl,
  type JournalTone,
} from '@/lib/journal'
import { paths } from '@/routes/paths'

/**
 * Tone -> form. Issue #93: "event kinds are visually distinct … Encode kind
 * in form, not just text." Each tone gets its own icon *and* its own marker
 * treatment (filled / ringed / hollow) so the five families are separable
 * without reading a word — and, importantly, without relying on colour
 * alone, which a monochrome screen share or a red-green-colourblind viewer
 * would flatten. Colours come from the shared wash/solid token pairs
 * (`src/index.css`), which are AA-clean in both themes by construction —
 * see `ui/badge.tsx`'s note on why nothing here fills a chip solid.
 */
const TONE_STYLE: Readonly<
  Record<JournalTone, { icon: LucideIcon; chip: string; marker: string }>
> = {
  client: {
    icon: MessageSquareReply,
    chip: 'bg-brand-wash text-brand',
    marker: 'bg-brand border-brand',
  },
  design: {
    icon: Shapes,
    chip: 'bg-attn-wash text-attn',
    marker: 'bg-attn-wash border-attn',
  },
  ship: {
    icon: GitMerge,
    chip: 'bg-pass-wash text-pass',
    marker: 'bg-pass border-pass',
  },
  status: {
    icon: Activity,
    chip: 'bg-idle-wash text-foreground',
    marker: 'bg-transparent border-line-strong',
  },
  internal: {
    icon: StickyNote,
    chip: 'bg-surface-2 text-muted-foreground',
    marker: 'bg-surface-2 border-line',
  },
}

function JournalRow({ entry }: { entry: JournalEntryWire }) {
  const meta = journalKindMeta(entry.kind)
  const tone = TONE_STYLE[meta.tone]
  const Icon = tone.icon
  const href = safeArtifactUrl(entry.artifact)

  return (
    <li
      data-testid={`journal-entry-${entry.kind}-${entry.ts}`}
      data-kind={entry.kind}
      data-tone={meta.tone}
      className="relative flex gap-3 pb-5 pl-1"
    >
      {/* The rail marker. `border-2` + a per-tone fill is what makes a
          merge and an operator note distinguishable at a glance down the
          left edge, before any text is read. */}
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full border-2 ${tone.marker}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <time
            className="font-mono text-[.7rem] text-faint"
            dateTime={new Date(entry.ts * 1000).toISOString()}
          >
            {journalTimeLabel(entry.ts)}
          </time>
          <span
            data-testid={`journal-kind-${entry.kind}`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[.68rem] font-semibold ${tone.chip}`}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {meta.label}
          </span>
          <span className="truncate text-[.7rem] text-muted-foreground">{entry.actor}</span>
        </div>
        {/* `whitespace-pre-wrap`: journal text is written for a human and
            can carry its own line breaks (a status transition's reason, a
            client's multi-line answer) — collapsing them would turn a
            legible note into a wall. Never truncated: this panel exists to
            show what happened, in full. */}
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{entry.text}</p>
        {href && (
          <a
            data-testid={`journal-artifact-${entry.kind}-${entry.ts}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {meta.artifactLabel}
          </a>
        )}
      </div>
    </li>
  )
}

function JournalTimeline({ data }: { data: JournalResponse }) {
  const days = groupJournalEntriesByDay(data.entries)

  return (
    <div data-testid="journal-timeline">
      <header className="mb-4 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            data-testid="journal-submission-id"
            className="font-mono text-sm font-medium text-card-foreground"
          >
            {data.submission_id}
          </span>
          {data.customer_status && (
            <span
              data-testid="journal-customer-status"
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[.68rem] font-semibold text-muted-foreground"
            >
              {data.customer_status}
            </span>
          )}
        </div>
        {data.title && (
          <p data-testid="journal-title" className="mt-1 text-sm text-foreground">
            {data.title}
          </p>
        )}
        {data.link && (
          <p data-testid="journal-link" className="mt-1 font-mono text-xs text-muted-foreground">
            {data.link.repo_name}
            {data.link.milestone_number != null && ` · ms-${data.link.milestone_number}`}
            {data.link.issue_number != null && ` · #${data.link.issue_number}`}
          </p>
        )}
      </header>

      {/* Gaps first, above the entries: the reader needs to know the story is
          incomplete *before* reading it, not after. */}
      {data.gaps.length > 0 && (
        <div
          data-testid="journal-gaps"
          role="note"
          className="mb-4 rounded-lg border border-attn/40 bg-attn-wash p-3"
        >
          <p className="flex items-center gap-1.5 text-xs font-semibold text-attn">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {data.gaps.length === 1
              ? 'One thing is missing from this timeline'
              : `${data.gaps.length} things are missing from this timeline`}
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-foreground">
            {/* Index in the key, not the text alone: the server builds these
                per-issue, so two linked issues failing the same way produce
                two identical gap strings. */}
            {data.gaps.map((gap, i) => (
              <li key={`${i}-${gap}`}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {days.length === 0 ? (
        <div data-testid="journal-empty">
          <EmptyState
            icon={<ScrollText aria-hidden="true" />}
            title="Nothing has happened yet"
            description={`No moments are recorded against ${data.submission_id} — this run has not started. That is an answer, not an error.`}
          />
        </div>
      ) : (
        <ol>
          {days.map((day) => (
            <li key={day.key} data-testid={`journal-day-${day.key}`}>
              {/* Sticky so the day you are reading stays named while you
                  scroll a long run — the thing that keeps forty rows a
                  narrative rather than a feed. */}
              <h2 className="sticky top-0 z-10 -mx-1 mb-3 bg-background/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {day.label}
              </h2>
              {/* The vertical rail the markers sit on — a border on the
                  list itself rather than a spacer element, so nothing
                  decorative lands in the a11y tree. */}
              <ol className="relative ml-[4px] border-l border-line pl-3">
                {day.entries.map((entry, i) => (
                  <JournalRow key={`${entry.ts}-${entry.kind}-${i}`} entry={entry} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** The picker: type or paste a submission id, or pick one coord is currently
 * waiting on. There is no "list every submission" endpoint on the dashboard
 * API (`/api/portal/needs-input` is the only submission list it serves, and
 * it is scoped to open questions), so the free-text field is the primary
 * control and the quick-picks are an aid — a failure to load them costs the
 * panel nothing and is swallowed. */
function SubmissionPicker({
  value,
  onSubmit,
}: {
  value: string
  onSubmit: (submissionId: string | null) => void
}) {
  const [draft, setDraft] = useState(value)

  // Keep the field in step with the URL when navigation (a quick-pick, the
  // back button, a pasted deep link) changes the selected submission from
  // outside this component.
  useEffect(() => {
    setDraft(value)
  }, [value])

  const { data: needsInput } = useQuery({
    queryKey: ['portal-needs-input'],
    queryFn: fetchPortalNeedsInput,
    // An older coord without the portal endpoints, or a transient failure,
    // must not take the panel's actual content with it.
    retry: false,
  })

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit(normaliseSubmissionId(draft))
  }

  return (
    <div className="mb-4">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="journal-submission-input" className="text-[.7rem] text-muted-foreground">
            Submission
          </label>
          <input
            id="journal-submission-input"
            data-testid="journal-submission-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="submission id, e.g. sub_0f2a"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 rounded-md border border-border bg-card px-2.5 py-2 font-mono text-sm text-card-foreground"
          />
        </div>
        <button
          type="submit"
          data-testid="journal-show-button"
          className="rounded-md bg-brand px-3.5 py-2 text-xs font-semibold text-[#08161a]"
        >
          Show run
        </button>
      </form>

      {needsInput && needsInput.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[.68rem] text-faint">Waiting on a client:</span>
          {needsInput.map((item) => (
            <button
              key={item.submission_id}
              type="button"
              data-testid={`journal-quick-pick-${item.submission_id}`}
              onClick={() => onSubmit(item.submission_id)}
              className="rounded-full border border-border px-2.5 py-1 font-mono text-[.68rem] text-foreground hover:bg-secondary"
            >
              {item.submission_id}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function JournalPanelBody() {
  const { submissionId: raw } = useParams<{ submissionId: string }>()
  const navigate = useNavigate()
  const submissionId = raw ? normaliseSubmissionId(decodeURIComponent(raw)) : null

  const { data, error, isPending, isError } = useQuery({
    queryKey: ['journal', submissionId],
    queryFn: () => fetchJournal(submissionId as string),
    enabled: submissionId !== null,
    retry: false,
  })

  const handlePick = (next: string | null) => {
    navigate(next ? paths.journalItem(next) : paths.journal())
  }

  // The whole run, or the reason there isn't one. Computed here rather than
  // inline in the JSX so the "which of the five states are we in" decision
  // reads as one ordered list instead of a nest of ternaries.
  let body
  if (submissionId === null) {
    body = (
      <div data-testid="journal-no-selection">
        <EmptyState
          icon={<ScrollText aria-hidden="true" />}
          title="Pick a submission"
          description="Enter a submission id above to see its whole run — intake, questions and answers, design rounds, sign-offs, dispatches and merges — as one ordered timeline."
        />
      </div>
    )
  } else if (isPending) {
    body = (
      <div data-testid="journal-loading" className="space-y-3" aria-busy="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-3/4" />
      </div>
    )
  } else if (isError) {
    body = (
      <div data-testid="journal-fetch-error" role="alert">
        <EmptyState
          icon={<AlertTriangle aria-hidden="true" />}
          title="Could not load this run"
          description={error instanceof Error ? error.message : String(error)}
        />
      </div>
    )
  } else if (!data.available) {
    // The realistic case for as long as the fleet roll lags this bundle —
    // explanatory, and explicit that it is the *server* that is behind, not
    // the submission that is missing. See `fetchJournal`.
    body = (
      <div data-testid="journal-unavailable">
        <EmptyState
          icon={<ScrollText aria-hidden="true" />}
          title="This coord server has no journal API yet"
          description="GET /api/journal/… is not served here. The Journal endpoint ships with a newer coord than the one answering this app; once this machine's fleet is rolled, this run will appear with no change to the app."
        />
      </div>
    )
  } else {
    body = <JournalTimeline data={data.data} />
  }

  return (
    <div className="pb-6">
      <PanelHeader
        title="Journal"
        count={data && data.available ? data.data.entries.length : undefined}
        countLabel="moments"
      />
      <SubmissionPicker value={submissionId ?? ''} onSubmit={handlePick} />
      {/* The *inner* boundary: a throw while rendering one run's timeline
          leaves the picker above it alive, so the next thing the operator
          does is try another submission id rather than get bounced back to
          Pipeline. See this file's header. */}
      <ErrorBoundary label="journal" resetKey={submissionId}>
        {body}
      </ErrorBoundary>
    </div>
  )
}

/**
 * The panel, with its own outer boundary.
 *
 * `ShellLayout` already wraps the list slot in one (#87), so in the running
 * app this is the third boundary a throw here would have to get past — but
 * this one belongs to the panel rather than to the slot, which is what makes
 * the containment property true of `JournalPanel` *itself* and not merely of
 * where it currently happens to be mounted. It catches the narrow band the
 * inner boundary structurally cannot: `JournalPanelBody`'s own render, which
 * reads the response for the header's moment count before the inner
 * boundary's subtree is even constructed.
 *
 * `resetKey` is deliberately absent here: the inner boundary owns
 * per-submission recovery, and the fallback this one renders offers Retry.
 */
export default function JournalPanel() {
  return (
    <ErrorBoundary label="journal">
      <JournalPanelBody />
    </ErrorBoundary>
  )
}
