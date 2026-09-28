/**
 * Wire-validation tests for `GET /api/pipeline/{repo}/{issue}/legs`
 * (#100, over claude-coordinator#3184).
 *
 * `LIVE_LEGS` is a **verbatim capture from a real server** — `coord web
 * --fixture e2e/fixtures/board-pipeline-basic.json` on the locally installed
 * `code-coordinator` (`coord --version` reported 0.5.530 while building this
 * view), curled at `GET /api/pipeline/claude-coordinator/4104/legs` — same
 * "confirm against the live endpoint" posture `milestones.test.ts` and
 * `issueDetail.test.ts` already establish (#76/#84's lesson: a shape nobody
 * ever validated against a real server is how those two panels shipped
 * broken).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { API_ROUTES, fetchPipelineLegs, parsePipelineLegs } from '@/api/client'

const LIVE_LEGS = {
  repo_name: 'claude-coordinator',
  issue_number: 4104,
  legs: [
    {
      assignment_id: 'rev-review-approved',
      stage: 'review',
      status: 'done',
      machine_name: 'precision',
      dispatched_at: 1749971100.0,
      finished_at: 1749971600.0,
    },
    {
      assignment_id: 'work-review-approved',
      stage: 'work',
      status: 'done',
      machine_name: 'dellserver',
      dispatched_at: 1749970000.0,
      finished_at: 1749971000.0,
    },
  ],
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
  it('declares the #3184 path in the served spec’s own template form', () => {
    // `e2e/api-routes.spec.ts` diffs this map against a live `GET
    // /openapi.json`, which is only possible while the literal stays in
    // `{param}` form rather than being interpolated at the call site (#78).
    expect(API_ROUTES.pipelineLegs).toBe('/api/pipeline/{repo}/{issue}/legs')
  })
})

describe('parsePipelineLegs', () => {
  it('accepts a real server response verbatim', () => {
    const parsed = parsePipelineLegs(LIVE_LEGS)
    expect(parsed.repo_name).toBe('claude-coordinator')
    expect(parsed.issue_number).toBe(4104)
    expect(parsed.legs).toHaveLength(2)
    expect(parsed.legs[0]).toMatchObject({
      assignment_id: 'rev-review-approved',
      stage: 'review',
      status: 'done',
      machine_name: 'precision',
    })
  })

  it('keeps a dispatched-but-unfinished leg -- finished_at: null, not omitted', () => {
    const parsed = parsePipelineLegs({
      repo_name: 'claude-coordinator',
      issue_number: 4101,
      legs: [
        {
          assignment_id: 'work-running',
          stage: 'work',
          status: 'running',
          machine_name: 'precision',
          dispatched_at: 1749996400.0,
          finished_at: null,
        },
      ],
    })
    expect(parsed.legs[0].finished_at).toBeNull()
    expect(parsed.legs[0].dispatched_at).toBe(1749996400.0)
  })

  it('tolerates an empty legs array -- an issue with no board rows yet', () => {
    expect(parsePipelineLegs({ repo_name: 'r', issue_number: 1, legs: [] }).legs).toEqual([])
  })

  it('narrows an unrecognised leg status to null instead of rejecting the row', () => {
    const parsed = parsePipelineLegs({
      ...LIVE_LEGS,
      legs: [{ ...LIVE_LEGS.legs[0], status: 'some-future-status' }],
    })
    expect(parsed.legs[0].status).toBeNull()
  })

  it('rejects a bare array where the envelope belongs, naming the field', () => {
    expect(() => parsePipelineLegs(LIVE_LEGS.legs)).toThrow(/response: expected an object/)
  })

  it('names the offending field rather than throwing a TypeError at render (#85)', () => {
    const bad = { ...LIVE_LEGS, legs: [{ ...LIVE_LEGS.legs[0], dispatched_at: 'not-a-number' }] }
    expect(() => parsePipelineLegs(bad)).toThrow(/response\.legs\[0\]\.dispatched_at: expected a number/)
  })
})

describe('fetchPipelineLegs', () => {
  it('builds the concrete path from the templated route, URI-encoding the repo', async () => {
    const fake = mockFetch(200, LIVE_LEGS)
    await fetchPipelineLegs('owner/repo', 42)
    expect(fake.mock.calls[0][0]).toBe('/api/pipeline/owner%2Frepo/42/legs')
  })

  it('returns ok with validated data', async () => {
    mockFetch(200, LIVE_LEGS)
    const result = await fetchPipelineLegs('claude-coordinator', 4104)
    expect(result).toEqual({ ok: true, data: parsePipelineLegs(LIVE_LEGS) })
  })

  it('reports a text/plain 404 as absent -- an older coord server without this route', async () => {
    mockFetch(404, 'Not Found', 'text/plain')
    expect(await fetchPipelineLegs('claude-coordinator', 4104)).toEqual({ ok: false, kind: 'absent' })
  })

  it('reports a JSON 404 as not-found -- the route exists and said no', async () => {
    mockFetch(404, { error: "unknown repo 'nope'" })
    expect(await fetchPipelineLegs('nope', 1)).toEqual({
      ok: false,
      kind: 'not-found',
      error: "unknown repo 'nope'",
    })
  })

  it('reports a bad 200 body as invalid, naming the field (#85)', async () => {
    mockFetch(200, { ...LIVE_LEGS, legs: 'not an array' })
    const result = await fetchPipelineLegs('claude-coordinator', 4104)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('invalid')
    expect(result.kind === 'invalid' && result.error).toMatch(/response\.legs: expected an array/)
  })

  it('still throws on a 5xx -- "broken" must not read as "the server told us something"', async () => {
    mockFetch(500, 'boom', 'text/plain')
    await expect(fetchPipelineLegs('claude-coordinator', 4104)).rejects.toThrow(/HTTP 500/)
  })
})
