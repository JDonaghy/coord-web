/**
 * Unit tests for `src/lib/journal.ts` — the Journal panel's pure derivation
 * layer (#93).
 *
 * The `kind` vocabulary asserted here is claude-coordinator's own, read off
 * `coord.portal_store`'s `LEDGER_KIND_*` constants plus
 * `_JOURNAL_AUDIT_EVENT_TYPES` at `code-coordinator` 0.5.368 (the version
 * installed on this machine, i.e. the published one serving
 * `/api/journal/{submission_id}`) — not guessed, and not read off a mock.
 *
 * Timestamps here are built with `new Date(y, m, d, ...)` (local-time
 * constructor) rather than fixed epoch integers on purpose: the day
 * grouping is deliberately *local*-calendar (see the module header), so a
 * hardcoded UTC epoch would assert a different calendar day depending on
 * where CI runs.
 */
import { describe, it, expect } from 'vitest'
import type { JournalEntryWire } from '@/api/client'
import {
  groupJournalEntriesByDay,
  journalDayKey,
  journalDayLabel,
  journalKindMeta,
  journalTimeLabel,
  normaliseSubmissionId,
  safeArtifactUrl,
  JOURNAL_KIND_META,
} from '@/lib/journal'

/** Epoch *seconds* for a local wall-clock moment. */
function at(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000
}

function entry(overrides: Partial<JournalEntryWire> = {}): JournalEntryWire {
  return {
    ts: at(2026, 2, 3, 9, 15),
    kind: 'status_changed',
    actor: 'coord',
    text: 'in_progress',
    artifact: null,
    source: 'ledger',
    details: {},
    ...overrides,
  }
}

describe('journalKindMeta', () => {
  // The exact set coord 0.5.368 can emit.
  const COORD_KINDS = [
    'answer_confirmed',
    'design_round_published',
    'draft_approved',
    'draft_edited',
    'draft_rejected',
    'operator_note',
    'preview_published',
    'question_answered',
    'question_pushed',
    'signoff_recorded',
    'status_changed',
    'work_shipped',
    'work_started',
    'dispatched',
    'merged',
  ]

  it('knows every kind coord actually emits', () => {
    const unknown = COORD_KINDS.filter((k) => !(k in JOURNAL_KIND_META))
    expect(unknown, `kinds coord emits that this panel has no label for: ${unknown}`).toEqual([])
  })

  it('gives a client answer, a design round and a merge three different tones', () => {
    expect(journalKindMeta('question_answered').tone).toBe('client')
    expect(journalKindMeta('design_round_published').tone).toBe('design')
    expect(journalKindMeta('merged').tone).toBe('ship')
    // The acceptance bar is that these do not read as one feed.
    const tones = new Set(
      ['question_answered', 'design_round_published', 'signoff_recorded', 'merged'].map(
        (k) => journalKindMeta(k).tone,
      ),
    )
    expect(tones.size).toBeGreaterThan(1)
  })

  it('degrades an unknown kind to a humanised label rather than dropping it', () => {
    // The version-skew case: a coord newer than this bundle invents a kind.
    const meta = journalKindMeta('client_called_in')
    expect(meta.label).toBe('Client called in')
    expect(meta.tone).toBe('internal')
  })

  it('never inherits a label from Object.prototype for a prototype-named kind', () => {
    // `'constructor' in JOURNAL_KIND_META` is true via the prototype chain —
    // a naive lookup would hand a `Function` back as this row's metadata.
    const meta = journalKindMeta('constructor')
    expect(meta.label).toBe('Constructor')
    expect(typeof meta.artifactLabel).toBe('string')
  })

  it('names the artifact link after what it actually opens', () => {
    expect(journalKindMeta('merged').artifactLabel).toBe('Open PR')
    expect(journalKindMeta('preview_published').artifactLabel).toBe('Open preview')
    expect(journalKindMeta('design_round_published').artifactLabel).toBe('Open bundle')
  })
})

describe('safeArtifactUrl', () => {
  it('passes an http(s) URL through unchanged', () => {
    expect(safeArtifactUrl('https://github.com/o/r/pull/12')).toBe('https://github.com/o/r/pull/12')
    expect(safeArtifactUrl('http://preview.example/x')).toBe('http://preview.example/x')
  })

  it('rejects null, empty and whitespace-only artifacts', () => {
    expect(safeArtifactUrl(null)).toBeNull()
    expect(safeArtifactUrl('')).toBeNull()
    expect(safeArtifactUrl('   ')).toBeNull()
  })

  it('rejects a non-http scheme even though the server considers it URL-shaped', () => {
    // `coord.portal_store._journal_url` only checks "alpha scheme, then
    // ://" — these all satisfy that and none of them belongs in an href a
    // client taps.
    expect(safeArtifactUrl('javascript://comment%0aalert(1)')).toBeNull()
    expect(safeArtifactUrl('data://text/html,<script>')).toBeNull()
    expect(safeArtifactUrl('file:///etc/passwd')).toBeNull()
  })

  it('rejects a bare R2 bundle key, which is what a design round often carries', () => {
    expect(safeArtifactUrl('bundles/sub-001/r1.tar')).toBeNull()
  })
})

describe('day/time formatting', () => {
  it('keys and labels a day in the viewer’s own local calendar', () => {
    expect(journalDayKey(at(2026, 2, 3, 9, 15))).toBe('2026-02-03')
    expect(journalDayLabel(at(2026, 2, 3, 9, 15))).toBe('Tue 3 Feb 2026')
  })

  it('zero-pads month, day, hour and minute', () => {
    expect(journalDayKey(at(2026, 1, 5, 4, 7))).toBe('2026-01-05')
    expect(journalTimeLabel(at(2026, 1, 5, 4, 7))).toBe('04:07')
  })

  it('uses 24h time, so 14:05 is never confusable with 02:05', () => {
    expect(journalTimeLabel(at(2026, 1, 5, 14, 5))).toBe('14:05')
    expect(journalTimeLabel(at(2026, 1, 5, 2, 5))).toBe('02:05')
  })
})

describe('groupJournalEntriesByDay', () => {
  it('returns no days for an empty run — the panel renders that, not an error', () => {
    expect(groupJournalEntriesByDay([])).toEqual([])
  })

  it('buckets a multi-day run into one group per day, in order', () => {
    const days = groupJournalEntriesByDay([
      entry({ ts: at(2026, 2, 3, 9, 15), kind: 'question_pushed' }),
      entry({ ts: at(2026, 2, 3, 17, 40), kind: 'question_answered' }),
      entry({ ts: at(2026, 2, 5, 11, 0), kind: 'design_round_published' }),
    ])

    expect(days.map((d) => d.key)).toEqual(['2026-02-03', '2026-02-05'])
    expect(days.map((d) => d.entries.length)).toEqual([2, 1])
    expect(days[0].label).toBe('Tue 3 Feb 2026')
  })

  it('keeps two entries a minute either side of local midnight on different days', () => {
    const days = groupJournalEntriesByDay([
      entry({ ts: at(2026, 2, 3, 23, 59) }),
      entry({ ts: at(2026, 2, 4, 0, 1) }),
    ])
    expect(days).toHaveLength(2)
  })

  it('does not silently re-stitch an out-of-order day back together', () => {
    // Grouping is on *consecutive runs*, so a server that broke its own
    // oldest-first contract shows up as two headings rather than being
    // quietly reordered into one.
    const days = groupJournalEntriesByDay([
      entry({ ts: at(2026, 2, 3, 9, 0) }),
      entry({ ts: at(2026, 2, 4, 9, 0) }),
      entry({ ts: at(2026, 2, 3, 10, 0) }),
    ])
    expect(days.map((d) => d.key)).toEqual(['2026-02-03', '2026-02-04', '2026-02-03'])
  })
})

describe('normaliseSubmissionId', () => {
  it('trims, and treats an all-whitespace field as no selection', () => {
    expect(normaliseSubmissionId('  sub_0f2a  ')).toBe('sub_0f2a')
    expect(normaliseSubmissionId('   ')).toBeNull()
    expect(normaliseSubmissionId('')).toBeNull()
  })
})
