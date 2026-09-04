/**
 * Wire-validation tests for `GET /api/milestones{,/{repo}/{number}}`
 * (#91, over claude-coordinator#3072).
 *
 * The bodies in `LIVE_LIST` / `LIVE_DETAIL` are **verbatim captures from a
 * real server** — `coord web` on `code-coordinator==0.5.368`, curled at
 * `GET /api/milestones?repo=coord-web` and `GET /api/milestones/coord-web/1`
 * while building this panel — trimmed only to keep the file readable. That
 * matters: #76 shipped a whole panel against an invented shape and every
 * gate stayed green, because nothing in this repo's tests had ever seen what
 * the server actually sends.
 *
 * The rest of the file is #85's bar in test form: a wrong shape must produce
 * a legible, *named-field* result, never a `TypeError` that reaches render as
 * a blank screen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  API_ROUTES,
  fetchMilestoneDetail,
  fetchMilestones,
  parseMilestoneDetail,
  parseMilestoneList,
} from '@/api/client'

const LIVE_LIST = {
  milestones: [
    {
      repo_name: 'coord-web',
      milestone_number: 1,
      title: 'Drive Queue panel',
      state: 'open',
      tracking_issue: 10,
      open_issues: 1,
      closed_issues: 5,
      oracle: true,
      has_work_order: true,
      work_order_total: 5,
      work_order_done: 5,
      ready_frontier: 0,
      in_flight: 0,
      blocked: 0,
      needs_you: [],
    },
  ],
  warnings: [],
}

const LIVE_DETAIL = {
  repo_name: 'coord-web',
  milestone_number: 1,
  title: 'Drive Queue panel',
  state: 'open',
  tracking_issue: 10,
  open_issues: 1,
  closed_issues: 5,
  oracle: true,
  has_work_order: true,
  entries: [
    {
      issue_number: 5,
      title: 'QW-1: API client + wire types for the drive queue',
      state: 'closed',
      position: 1,
      after: [],
      group: 'A',
      gates: null,
    },
    {
      issue_number: 7,
      title: 'QW-3: Grid + repo-scope dropdown + summary',
      state: 'closed',
      position: 3,
      after: [5, 6],
      group: 'B',
      gates: {
        assignment_id: 'work-7',
        status: 'merged',
        branch: 'issue-7',
        machine_name: 'dellserver',
        test_state: 'passed',
        smoke_test: 'pass',
        review_state: 'done',
        review_verdict: 'approve',
      },
    },
  ],
  gate_a: {
    state: 'missing',
    ok: false,
    contract_sha: '',
    reason: "Gate A sign-off cannot be verified for ms-1: 'tests/acceptance/ms-1/contract.md' …",
    verdict: null,
    actor: null,
    recorded_at: null,
    approved_contract_sha: null,
    href: '/api/gate-a/coord-web/10',
  },
  warnings: [],
}

function mockFetch(status: number, body: unknown, contentType = 'application/json') {
  const isJson = contentType.includes('json')
  const fake = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => (isJson ? Promise.resolve(body) : Promise.reject(new Error('not json'))),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  })
  vi.stubGlobal('fetch', fake)
  return fake
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the route table', () => {
  it('declares both #3072 paths in the served spec’s own template form', () => {
    // `e2e/api-routes.spec.ts` diffs this map against a live `GET
    // /openapi.json`, which is only possible while the literals stay in
    // `{param}` form rather than being interpolated at the call site (#78).
    expect(API_ROUTES.milestones).toBe('/api/milestones')
    expect(API_ROUTES.milestoneDetail).toBe('/api/milestones/{repo}/{number}')
  })
})

describe('parseMilestoneList', () => {
  it('accepts a real server response verbatim', () => {
    const parsed = parseMilestoneList(LIVE_LIST)
    expect(parsed.milestones).toHaveLength(1)
    expect(parsed.milestones[0]).toMatchObject({
      repo_name: 'coord-web',
      milestone_number: 1,
      work_order_done: 5,
      work_order_total: 5,
      oracle: true,
    })
    expect(parsed.warnings).toEqual([])
  })

  it('rejects #84’s exact bug — a bare array where the envelope belongs', () => {
    expect(() => parseMilestoneList([LIVE_LIST.milestones[0]])).toThrow(/response: expected an object/)
  })

  it('names the offending field rather than throwing a TypeError at render', () => {
    const bad = { milestones: [{ ...LIVE_LIST.milestones[0], work_order_total: '5' }], warnings: [] }
    expect(() => parseMilestoneList(bad)).toThrow(
      /response\.milestones\[0\]\.work_order_total: expected a number/,
    )
  })

  it('tolerates an absent warnings key (an older server that only sends rows)', () => {
    expect(parseMilestoneList({ milestones: [] }).warnings).toEqual([])
  })

  it('narrows an unknown milestone state instead of rejecting the whole roster', () => {
    // The server may grow a state this bundle predates; one unfamiliar value
    // must not blank a roster that is otherwise perfectly readable.
    const parsed = parseMilestoneList({
      milestones: [{ ...LIVE_LIST.milestones[0], state: 'archived' }],
      warnings: [],
    })
    expect(parsed.milestones[0].state).toBe('open')
  })
})

describe('parseMilestoneDetail', () => {
  it('accepts a real server response verbatim, gate columns and all', () => {
    const parsed = parseMilestoneDetail(LIVE_DETAIL)
    expect(parsed.entries).toHaveLength(2)
    expect(parsed.entries[0].gates).toBeNull()
    expect(parsed.entries[1].gates).toMatchObject({
      status: 'merged',
      test_state: 'passed',
      smoke_test: 'pass',
      review_verdict: 'approve',
    })
    expect(parsed.gate_a?.state).toBe('missing')
    expect(parsed.gate_a?.href).toBe('/api/gate-a/coord-web/10')
  })

  it('preserves the ## Work order sequence exactly as received', () => {
    // The sequence is the whole reason this endpoint reads the work order
    // instead of GitHub milestone membership. A parser that sorted (by
    // issue number, by position, by anything) would silently destroy it.
    const shuffled = {
      ...LIVE_DETAIL,
      entries: [LIVE_DETAIL.entries[1], LIVE_DETAIL.entries[0]],
    }
    expect(parseMilestoneDetail(shuffled).entries.map((e) => e.issue_number)).toEqual([7, 5])
  })

  it('keeps an unresolved entry state as null rather than guessing closed', () => {
    const parsed = parseMilestoneDetail({
      ...LIVE_DETAIL,
      entries: [{ ...LIVE_DETAIL.entries[0], state: null }],
    })
    expect(parsed.entries[0].state).toBeNull()
  })

  it('accepts gate_a: null (a repo not opted into the oracle loop)', () => {
    expect(parseMilestoneDetail({ ...LIVE_DETAIL, gate_a: null }).gate_a).toBeNull()
  })
})

describe('fetchMilestones', () => {
  it('returns ok with validated data', async () => {
    mockFetch(200, LIVE_LIST)
    const result = await fetchMilestones()
    expect(result).toEqual({ ok: true, data: parseMilestoneList(LIVE_LIST) })
  })

  it('scopes to one repo with ?repo=', async () => {
    const fake = mockFetch(200, LIVE_LIST)
    await fetchMilestones('coord web')
    expect(fake.mock.calls[0][0]).toBe('/api/milestones?repo=coord%20web')
  })

  it('reports a text/plain 404 as absent — a coord server predating #3072', async () => {
    mockFetch(404, 'Not Found', 'text/plain')
    expect(await fetchMilestones()).toEqual({ ok: false, kind: 'absent' })
  })

  it('reports a JSON 404 as not-found — the route exists and said no', async () => {
    mockFetch(404, { error: "unknown repo 'nope'" })
    expect(await fetchMilestones('nope')).toEqual({
      ok: false,
      kind: 'not-found',
      error: "unknown repo 'nope'",
    })
  })

  it('reports a bad 200 body as invalid, naming the field (#85)', async () => {
    mockFetch(200, { milestones: 'not an array' })
    const result = await fetchMilestones()
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('invalid')
    expect(result.kind === 'invalid' && result.error).toMatch(/response\.milestones: expected an array/)
  })

  it('still throws on a 5xx — "broken" must not read as "the server told us something"', async () => {
    mockFetch(500, 'boom', 'text/plain')
    await expect(fetchMilestones()).rejects.toThrow(/HTTP 500/)
  })
})

describe('fetchMilestoneDetail', () => {
  it('builds the concrete path from the templated route, URI-encoding both params', async () => {
    const fake = mockFetch(200, LIVE_DETAIL)
    await fetchMilestoneDetail('owner/repo', 4)
    expect(fake.mock.calls[0][0]).toBe('/api/milestones/owner%2Frepo/4')
  })

  it('reports an unknown milestone as not-found, carrying the server’s own message', async () => {
    mockFetch(404, { error: 'could not fetch milestone 9999 in coord-web: gh: Not Found' })
    const result = await fetchMilestoneDetail('coord-web', 9999)
    expect(result).toEqual({
      ok: false,
      kind: 'not-found',
      error: 'could not fetch milestone 9999 in coord-web: gh: Not Found',
    })
  })

  it('reports an unrouted path as absent, not as a missing milestone', async () => {
    mockFetch(404, 'Not Found', 'text/plain')
    expect(await fetchMilestoneDetail('coord-web', 1)).toEqual({ ok: false, kind: 'absent' })
  })
})
