/**
 * Pure helpers for the Answers screen (#59) — recording a client answer
 * given out of band against a `needs-input` submission's open question, over
 * the landed `POST /api/portal/answer` (see `src/api/client.ts`).
 *
 * Two things live here, same "pure logic out of the component" split
 * `driveQueue.ts`/`reports.ts` already establish for their own panels:
 *
 * - **Provenance capture.** The issue's acceptance bar is explicit: "Source
 *   and date are captured and are not optional — an answer with no stated
 *   provenance cannot be submitted." The landed `PortalAnswerRequest`
 *   (`src/api/client.ts`, given verbatim by the issue) has a `source` field
 *   but no `date` field — the issue's own "Shape" section says the date
 *   "travels with the answer" as provenance, and the ledger entry the `200`
 *   response wraps is where that lives, timestamped server-side at the
 *   moment it's recorded. So `canSubmitPortalAnswer` requires a non-empty
 *   answer plus a chosen `source` (the only date-shaped requirement, the
 *   landed contract can actually carry as a wire field, is already
 *   automatic), and `todayIsoDate` gives the composer a *displayed* date —
 *   what will be stamped on the entry — rather than a submittable field.
 *   This keeps the screen a thin client over the exact landed contract
 *   instead of inventing a widened one the server doesn't accept.
 * - **Answer-source labels.** One list, `PORTAL_ANSWER_SOURCES`, drives both
 *   the composer's `<select>` options and any place a recorded entry's
 *   `source` needs a human label — never two separately-maintained lists.
 */
import type { PortalAnswerSource, PortalNeedsInputItem } from '@/api/client'
import { issueRef } from '@/lib/repoRef'

/** The three provenance values `POST /api/portal/answer` accepts, in the
 * order the composer's `<select>` offers them. */
export const PORTAL_ANSWER_SOURCES: readonly PortalAnswerSource[] = ['verbal', 'phone', 'email']

const PORTAL_ANSWER_SOURCE_LABELS: Readonly<Record<PortalAnswerSource, string>> = {
  verbal: 'In person',
  phone: 'Phone',
  email: 'Email',
}

/** Human label for a `PortalAnswerSource` — the composer's option text and
 * any later display of a recorded entry's provenance. */
export function portalAnswerSourceLabel(source: PortalAnswerSource): string {
  return PORTAL_ANSWER_SOURCE_LABELS[source]
}

/** Is `value` one of the three wire-valid source strings? Narrows a raw
 * `<select>` value (which starts as `''`, matching nothing here) before it's
 * safe to put in a `PortalAnswerRequest`. */
export function isPortalAnswerSource(value: string): value is PortalAnswerSource {
  return (PORTAL_ANSWER_SOURCES as readonly string[]).includes(value)
}

/**
 * Can this composer be submitted? The issue's two mandatory fields: answer
 * text that isn't just whitespace, and a chosen (non-empty) source — see
 * this module's doc comment for why "date" isn't a third field here.
 */
export function canSubmitPortalAnswer(text: string, source: string): boolean {
  return text.trim().length > 0 && isPortalAnswerSource(source)
}

/** `YYYY-MM-DD` for `now` (local time) — the composer's read-only "Date"
 * context, matching what the server stamps on the recorded ledger entry.
 * Injectable `now` so tests don't depend on the real clock. */
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Display label for one `needs-input` item — its own `title` when the server
 * gave one, else its issue ref (`CC#59`-style, via `repoAlias`) when
 * `repo_name`/`issue_number` are known, else a bare `submission_id` fallback
 * so a row never renders with no visible identity at all.
 */
export function portalItemDisplayRef(
  item: Pick<PortalNeedsInputItem, 'submission_id' | 'title' | 'repo_name' | 'issue_number'>,
): string {
  if (item.title) return item.title
  if (item.repo_name && item.issue_number != null) return issueRef(item.repo_name, item.issue_number)
  return `Submission ${item.submission_id}`
}
