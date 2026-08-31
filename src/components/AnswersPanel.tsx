/**
 * AnswersPanel — the Answers screen's list-slot content (#59).
 *
 * "Record a client answer given out of band — in person, on a call, by
 * email — against that submission's open question, from a phone, while the
 * call is still happening." `ShellLayout` owns the frame (rail, status bar)
 * and renders this component into the list slot for the `/answers` route,
 * same convention `DriveQueuePanel`/`ReportsPanel` document for their own
 * routes.
 *
 * A thin client over the landed write path (claude-coordinator#2986/#2990):
 * `GET /api/portal/needs-input` lists submissions sitting in `needs-input`,
 * each with its open question; a composer under each one's question posts
 * `POST /api/portal/answer` (`src/api/client.ts`'s `submitPortalAnswer`),
 * paired to that question's `revision`. This screen re-decides none of the
 * state machine — see the issue for the full "why here, not coord-tui / not
 * coord-portal" reasoning.
 *
 * Deliberately **not** the dense, small-text, wide-table layout
 * `DriveQueuePanel`/`ReportsPanel` use: issue #59 is explicit that a phone,
 * one-handed, mid-call, is the primary target, not a responsive afterthought
 * — so this renders a single column of full-width cards with touch-sized
 * controls at every viewport, rather than a grid that only becomes usable
 * once it's wide enough to stop scrolling horizontally.
 *
 * Per-card composer state (text/source/in-flight/error) lives in this
 * component, keyed by `submission_id` — `src/lib/portal.ts` holds the pure
 * validation (`canSubmitPortalAnswer`) and provenance-label logic, same
 * "component orchestrates, lib validates" split `DriveQueuePanel`/
 * `src/lib/driveQueue.ts` already establish.
 *
 * Two outcomes `POST /api/portal/answer` can report get distinct handling,
 * per the issue's acceptance bar:
 *  - `200`: the answer is recorded (or converged on an identical retry —
 *    server-side idempotency, asserted here rather than reimplemented) and
 *    the card leaves `needs-input` on its own, no manual refresh — a
 *    successful submit invalidates `['portal-needs-input']` and the card is
 *    marked recorded in the meantime so the UI doesn't sit blank waiting for
 *    the refetch to land.
 *  - `409`: the question moved on since this list was rendered — surfaced as
 *    an inline "re-read it" banner on that one card (not a generic failure
 *    toast), and the list is refetched in the background so the card's own
 *    question/revision catch up to what's actually current.
 *
 * No SSE invalidation wiring (`src/realtime/events.ts`): the dashboard
 * server's event vocabulary has no portal-question event type today, so
 * there is nothing for `['portal-needs-input']` to subscribe to yet — the
 * explicit invalidate-on-submit above, plus react-query's default
 * `refetchOnWindowFocus`, cover the practical "the list stays correct"
 * need without inventing a subscription to an event that doesn't exist.
 */
import { type FormEvent, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchPortalNeedsInput,
  submitPortalAnswer,
  type PortalNeedsInputItem,
} from '@/api/client'
import { PanelHeader } from '@/components/PanelHeader'
import { toast } from '@/components/ui/use-toast'
import {
  canSubmitPortalAnswer,
  isPortalAnswerSource,
  PORTAL_ANSWER_SOURCES,
  portalAnswerSourceLabel,
  portalItemDisplayRef,
  todayIsoDate,
} from '@/lib/portal'

const QUERY_KEY = ['portal-needs-input']

interface ComposerState {
  text: string
  source: string
  submitting: boolean
  error: string | null
  /** Set on a `409` — this card's question moved on since it was listed. */
  stale: boolean
}

const EMPTY_COMPOSER: ComposerState = { text: '', source: '', submitting: false, error: null, stale: false }

interface AnswerCardProps {
  item: PortalNeedsInputItem
  composer: ComposerState
  recorded: boolean
  onChange: (patch: Partial<ComposerState>) => void
  onSubmit: () => void
}

function AnswerCard({ item, composer, recorded, onChange, onSubmit }: AnswerCardProps) {
  const displayRef = portalItemDisplayRef(item)
  const canSubmit = canSubmitPortalAnswer(composer.text, composer.source)
  const textId = `answer-text-${item.submission_id}`
  const sourceId = `answer-source-${item.submission_id}`

  return (
    <article
      data-testid={`answer-card-${item.submission_id}`}
      className="mb-4 rounded-lg border border-border bg-card p-4"
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium text-card-foreground">{displayRef}</span>
        {item.opened_at && (
          <span className="text-xs text-muted-foreground">Opened {item.opened_at}</span>
        )}
      </header>

      {/* The open question, in full — never truncated (issue #59's explicit
          acceptance bar). */}
      <p
        data-testid={`answer-question-${item.submission_id}`}
        className="mb-4 whitespace-pre-wrap text-base text-foreground"
      >
        {item.question}
      </p>

      {recorded ? (
        <p
          data-testid={`answer-recorded-${item.submission_id}`}
          role="status"
          className="rounded-md border border-pass bg-pass-wash px-3 py-2.5 text-sm text-pass"
        >
          Answer recorded — leaving Needs input…
        </p>
      ) : (
        <form
          aria-label={`Record an answer for ${displayRef}`}
          onSubmit={(event: FormEvent) => {
            event.preventDefault()
            onSubmit()
          }}
          className="flex flex-col gap-3"
        >
          {composer.stale && (
            <p
              data-testid={`answer-stale-banner-${item.submission_id}`}
              role="alert"
              className="rounded-md border border-attn/40 bg-attn-wash px-3 py-2.5 text-sm text-attn"
            >
              This question moved on since it was loaded — re-read it above before answering again.
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor={textId} className="text-xs text-muted-foreground">
              Answer
            </label>
            <textarea
              id={textId}
              data-testid={`answer-text-input-${item.submission_id}`}
              value={composer.text}
              onChange={(e) => onChange({ text: e.target.value, stale: false })}
              placeholder="What did they say?"
              rows={4}
              className="min-h-[6.5rem] w-full rounded-md border border-border bg-background px-3 py-2.5 text-base text-foreground"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={sourceId} className="text-xs text-muted-foreground">
                Source
              </label>
              <select
                id={sourceId}
                data-testid={`answer-source-select-${item.submission_id}`}
                required
                value={composer.source}
                onChange={(e) => onChange({ source: e.target.value, stale: false })}
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-base text-foreground"
              >
                <option value="">Select source…</option>
                {PORTAL_ANSWER_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {portalAnswerSourceLabel(source)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Date</span>
              {/* Read-only — not a submittable wire field (see this file's +
                  src/lib/portal.ts's doc comments): the landed
                  `POST /api/portal/answer` body has no `date` field, so this
                  shows what the server will stamp on the recorded entry
                  rather than a second, unsent contract. */}
              <span
                data-testid={`answer-date-${item.submission_id}`}
                className="rounded-md border border-border bg-secondary/30 px-3 py-2.5 text-base text-muted-foreground"
              >
                {todayIsoDate()}
              </span>
            </div>
          </div>

          {composer.error && (
            <p data-testid={`answer-error-${item.submission_id}`} role="alert" className="text-sm text-destructive">
              {composer.error}
            </p>
          )}

          <button
            type="submit"
            data-testid={`answer-submit-button-${item.submission_id}`}
            disabled={!canSubmit || composer.submitting}
            className="w-full rounded-md bg-brand px-4 py-3 text-base font-semibold text-[#08161a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {composer.submitting ? 'Recording…' : 'Record answer'}
          </button>
        </form>
      )}
    </article>
  )
}

export default function AnswersPanel() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPortalNeedsInput,
  })
  const items = data ?? []
  const queryClient = useQueryClient()

  const [composers, setComposers] = useState<Record<string, ComposerState>>({})
  const [recordedIds, setRecordedIds] = useState<Set<string>>(new Set())

  // Prune `recordedIds` to whatever the latest fetch still lists -- once a
  // just-answered submission's card is gone (the invalidate below landed),
  // there's nothing left for that flag to describe.
  useEffect(() => {
    if (!data) return
    const present = new Set(data.map((i) => i.submission_id))
    setRecordedIds((prev) => {
      const next = new Set([...prev].filter((id) => present.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [data])

  const composerFor = (id: string): ComposerState => composers[id] ?? EMPTY_COMPOSER

  const patchComposer = (id: string, patch: Partial<ComposerState>) => {
    setComposers((prev) => ({ ...prev, [id]: { ...composerFor(id), ...patch } }))
  }

  const handleSubmit = async (item: PortalNeedsInputItem) => {
    const composer = composerFor(item.submission_id)
    if (!canSubmitPortalAnswer(composer.text, composer.source) || composer.submitting) return
    if (!isPortalAnswerSource(composer.source)) return

    patchComposer(item.submission_id, { submitting: true, error: null })
    try {
      const result = await submitPortalAnswer({
        submission_id: item.submission_id,
        text: composer.text.trim(),
        source: composer.source,
        revision: item.revision,
      })
      if (result.ok) {
        toast({
          variant: 'success',
          title: 'Answer recorded',
          description: portalItemDisplayRef(item),
        })
        setRecordedIds((prev) => new Set(prev).add(item.submission_id))
        setComposers((prev) => {
          const next = { ...prev }
          delete next[item.submission_id]
          return next
        })
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      } else if (result.status === 409) {
        // Re-read prompt, not a generic error (issue #59's explicit bar) --
        // and refetch so the card's own question/revision catch up.
        patchComposer(item.submission_id, { submitting: false, stale: true })
        void refetch()
      } else {
        const message = result.error ?? 'Failed to record the answer'
        patchComposer(item.submission_id, { submitting: false, error: message })
        toast({ variant: 'destructive', title: 'Answer not recorded', description: message })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to record the answer'
      patchComposer(item.submission_id, { submitting: false, error: message })
      toast({ variant: 'destructive', title: 'Answer not recorded', description: message })
    }
  }

  return (
    <div className="mx-auto w-full px-4 py-4">
      <PanelHeader title="Answers" count={data ? items.length : undefined} countLabel="needing input">
        {isFetching && !isLoading && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-label="Refreshing" />
        )}
      </PanelHeader>

      {isLoading && (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading submissions…</p>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center">
          <p className="text-sm text-destructive">Failed to load needs-input submissions</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {data &&
        (items.length > 0 ? (
          items.map((item) => (
            <AnswerCard
              key={item.submission_id}
              item={item}
              composer={composerFor(item.submission_id)}
              recorded={recordedIds.has(item.submission_id)}
              onChange={(patch) => patchComposer(item.submission_id, patch)}
              onSubmit={() => void handleSubmit(item)}
            />
          ))
        ) : (
          <div data-testid="answers-empty-state" className="py-14 text-center text-sm text-muted-foreground">
            <p>Nothing needs an answer right now.</p>
          </div>
        ))}
    </div>
  )
}
