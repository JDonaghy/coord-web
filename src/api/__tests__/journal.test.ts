/**
 * Unit tests for `fetchJournal` / `validateJournal` (#93) — the client half
 * of `GET /api/journal/{submission_id}` (claude-coordinator#3091).
 *
 * The happy-path fixture below is not invented: it is the shape a real
 * `coord web --fixture` process actually returned when curled during this
 * story (issue #93's precondition 3), against `code-coordinator` 0.5.368 —
 * specifically the unlinked-submission response
 *
 *     {"submission_id": "...", "title": "", "customer_status": "",
 *      "link": null,
 *      "gaps": ["no repo/milestone linked to ... (`coord portal link`)"],
 *      "entries": []}
 *
 * — verbatim as the `empty run` case, extended per the served OpenAPI
 * schema (`JournalResponse`/`JournalEntryWire`, now in `generated.ts`) for
 * the populated cases.
 *
 * The bar this file exists to hold is #85's: the response is **validated**,
 * not cast. Every "server sends something else" case below would previously
 * have sailed through `as JournalResponse` and surfaced as a `TypeError`
 * inside a component's render — which is exactly how #76 and #84 presented.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchJournal, validateJournal, type JournalResponse } from '@/api/client'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const mockedFetch = () => vi.mocked(globalThis.fetch)

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** The unlinked-submission body a live `coord web --fixture` really returned. */
const LIVE_EMPTY_BODY = {
  submission_id: 'sub_abc123',
  title: '',
  customer_status: '',
  link: null,
  gaps: [
    'no repo/milestone linked to sub_abc123 — dispatch and merge events are not in this timeline (`coord portal link`)',
  ],
  entries: [],
}

function wireEntry(overrides: Record<string, unknown> = {}) {
  return {
    ts: 1770000000,
    kind: 'question_answered',
    actor: 'customer',
    text: 'Ship it to the Leeds office.',
    artifact: null,
    source: 'ledger',
    details: { seq: 4, question_revision: 2 },
    ...overrides,
  }
}

describe('fetchJournal', () => {
  it('GETs the templated path with the submission id URI-encoded', async () => {
    mockedFetch().mockResolvedValue(jsonResponse(LIVE_EMPTY_BODY))
    await fetchJournal('sub/with space')
    expect(mockedFetch()).toHaveBeenCalledWith('/api/journal/sub%2Fwith%20space')
  })

  it('returns the validated payload on 200', async () => {
    mockedFetch().mockResolvedValue(
      jsonResponse({ ...LIVE_EMPTY_BODY, entries: [wireEntry()] }),
    )
    const result = await fetchJournal('sub_abc123')
    expect(result.available).toBe(true)
    if (!result.available) throw new Error('unreachable')
    expect(result.data.entries).toHaveLength(1)
    expect(result.data.entries[0].kind).toBe('question_answered')
  })

  it('treats an empty run as a real answer, not an error', async () => {
    // The live shape verbatim: an unlinked submission is a 200 with no
    // entries and a gap explaining why. This must NOT throw and must NOT
    // come back as `{available: false}` — see issue #93.
    mockedFetch().mockResolvedValue(jsonResponse(LIVE_EMPTY_BODY))
    const result = await fetchJournal('sub_abc123')
    expect(result).toEqual({
      available: true,
      data: { ...LIVE_EMPTY_BODY, entries: [] },
    })
  })

  it('reports a 404 as "this server has no journal API", not as a failure', async () => {
    // The endpoint's spec declares only a 200, so a 404 can only mean the
    // route itself is absent — the fleet-roll-lag case.
    mockedFetch().mockResolvedValue(jsonResponse({ error: 'Not Found' }, 404))
    await expect(fetchJournal('sub_abc123')).resolves.toEqual({ available: false })
  })

  it('throws on any other non-2xx', async () => {
    mockedFetch().mockResolvedValue(jsonResponse({ error: 'boom' }, 500))
    await expect(fetchJournal('sub_abc123')).rejects.toThrow(/HTTP 500/)
  })

  it('throws a legible error when the body is not JSON at all', async () => {
    mockedFetch().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
      text: async () => '<html>proxy error</html>',
    } as unknown as Response)
    await expect(fetchJournal('sub_abc123')).rejects.toThrow(/was not JSON/)
  })
})

describe('validateJournal', () => {
  const path = '/api/journal/sub_abc123'

  it('rejects a bare array where the envelope is expected (#84’s exact bug)', () => {
    expect(() => validateJournal(path, [wireEntry()])).toThrow(/expected a JournalResponse object/)
  })

  it('rejects null and a non-object body', () => {
    expect(() => validateJournal(path, null)).toThrow(/expected a JournalResponse object/)
    expect(() => validateJournal(path, 'nope')).toThrow(/expected a JournalResponse object/)
  })

  it('rejects a body whose "entries" is present but not an array', () => {
    // Present-but-wrong-typed is what a `ShapeGuard` alone cannot catch and
    // what reaches `.map()` as a TypeError.
    expect(() =>
      validateJournal(path, { ...LIVE_EMPTY_BODY, entries: { '0': wireEntry() } }),
    ).toThrow(/expected an array "entries"/)
  })

  it('names the request and the actual shape in the error, never the body', () => {
    let message = ''
    try {
      validateJournal(path, { submission_id: 'sub_abc123', entries: 'x' })
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain(path)
    expect(message).toContain('object with keys [submission_id, entries]')
  })

  it('drops an unreadable entry and reports it as a gap instead of losing the run', () => {
    const result = validateJournal(path, {
      ...LIVE_EMPTY_BODY,
      gaps: [],
      entries: [wireEntry(), { ts: 'yesterday', kind: 'merged' }, wireEntry({ ts: 1770000100 })],
    })
    expect(result.entries).toHaveLength(2)
    expect(result.gaps).toHaveLength(1)
    expect(result.gaps[0]).toMatch(/1 timeline entry was unreadable/)
  })

  it('pluralises the dropped-entry gap correctly', () => {
    const result = validateJournal(path, {
      ...LIVE_EMPTY_BODY,
      gaps: [],
      entries: [null, 7],
    })
    expect(result.entries).toEqual([])
    expect(result.gaps[0]).toMatch(/2 timeline entries were unreadable/)
  })

  it('tolerates a missing/omitted details object rather than dropping the entry', () => {
    const result = validateJournal(path, {
      ...LIVE_EMPTY_BODY,
      entries: [wireEntry({ details: undefined })],
    })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].details).toEqual({})
  })

  it('accepts a real artifact URL and a null one alike', () => {
    const result = validateJournal(path, {
      ...LIVE_EMPTY_BODY,
      entries: [
        wireEntry({ kind: 'merged', artifact: 'https://github.com/o/r/pull/12' }),
        wireEntry({ ts: 1770000100, artifact: null }),
      ],
    })
    expect(result.entries.map((e) => e.artifact)).toEqual([
      'https://github.com/o/r/pull/12',
      null,
    ])
  })

  it('defaults title/customer_status a partial server omitted, rather than refusing', () => {
    const result = validateJournal(path, { submission_id: 'sub_abc123', entries: [] })
    expect(result.title).toBe('')
    expect(result.customer_status).toBe('')
    expect(result.gaps).toEqual([])
    expect(result.link).toBeNull()
  })

  it('re-sorts entries oldest-first so the day grouping cannot read as nonsense', () => {
    const result: JournalResponse = validateJournal(path, {
      ...LIVE_EMPTY_BODY,
      entries: [wireEntry({ ts: 1770000200 }), wireEntry({ ts: 1770000100 })],
    })
    expect(result.entries.map((e) => e.ts)).toEqual([1770000100, 1770000200])
  })

  it('ignores a non-string-array "gaps" rather than rendering junk', () => {
    const result = validateJournal(path, { ...LIVE_EMPTY_BODY, gaps: [{ oops: true }] })
    expect(result.gaps).toEqual([])
  })
})
