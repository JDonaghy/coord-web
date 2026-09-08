/**
 * Tests for `GET /api/issue/{repo}/{number}` (claude-coordinator#3194 /
 * coord-web#107) — `fetchIssueDetail` in `src/api/client.ts`.
 *
 * `LIVE_ISSUE` below was captured verbatim from the endpoint's own
 * `IssueDetailWire` schema (curled `GET /openapi.json` against a local
 * `coord web --fixture` process on `code-coordinator==0.5.413`, the version
 * this was verified against) — `state`/`labels`/`html_url` are exactly the
 * three fields the old briefing-scrape source (`src/lib/board.ts`, pre-#107)
 * never had.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { API_ROUTES, fetchIssueDetail } from '@/api/client'

const LIVE_ISSUE = {
  repo_name: 'format-converter',
  number: 2,
  title: 'Cloudflare Pages scaffold: static, no-Access, strict no-egress CSP',
  body: '## What\n\nStatic Cloudflare Pages scaffold, no Access, strict no-egress CSP.\n',
  state: 'open',
  labels: ['area:infra'],
  milestone_number: null,
  milestone_title: null,
  html_url: 'https://github.com/JDonaghy/format-converter/issues/2',
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
  it('declares #3194’s path in the served spec’s own template form', () => {
    // `e2e/api-routes.spec.ts` diffs this map against a live `GET
    // /openapi.json`, which is only possible while the literal stays in
    // `{param}` form rather than being interpolated at the call site (#78).
    expect(API_ROUTES.issueDetail).toBe('/api/issue/{repo}/{number}')
  })
})

describe('fetchIssueDetail', () => {
  it('returns ok with the wire response untouched, including html_url', async () => {
    mockFetch(200, LIVE_ISSUE)
    const result = await fetchIssueDetail('format-converter', 2)
    expect(result).toEqual({ ok: true, data: LIVE_ISSUE })
  })

  it('builds the path with repo and number substituted', async () => {
    const fake = mockFetch(200, LIVE_ISSUE)
    await fetchIssueDetail('format-converter', 2)
    expect(fake.mock.calls[0][0]).toBe('/api/issue/format-converter/2')
  })

  it('URI-encodes an owner/repo-shaped repo name', async () => {
    const fake = mockFetch(200, { ...LIVE_ISSUE, repo_name: 'claude-coordinator', number: 3194 })
    await fetchIssueDetail('claude-coordinator', 3194)
    expect(fake.mock.calls[0][0]).toBe('/api/issue/claude-coordinator/3194')
  })

  it('reports a handled 404 as ok:false with the server’s own error message', async () => {
    mockFetch(404, { error: "unknown issue 'format-converter#9999'" })
    expect(await fetchIssueDetail('format-converter', 9999)).toEqual({
      ok: false,
      status: 404,
      error: "unknown issue 'format-converter#9999'",
    })
  })

  it('falls back to a generic message when a non-2xx response carries no JSON body', async () => {
    mockFetch(500, 'boom', 'text/plain')
    expect(await fetchIssueDetail('format-converter', 2)).toEqual({
      ok: false,
      status: 500,
      error: 'HTTP 500',
    })
  })
})
