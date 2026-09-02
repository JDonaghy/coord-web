/**
 * Static contract check: every path `client.ts` fetches must exist in the
 * real dashboard's own OpenAPI spec, `GET /openapi.json` (#78).
 *
 * coord-web#76 shipped the Machines panel calling **eight** paths of which
 * **seven had never been built**, and every existing gate — vitest's fake
 * `fetch`, Playwright's `page.route()` mocks — stayed green regardless: none
 * of them ever asks a real server whether a path exists at all. This is not
 * a browser test. It's a set difference between two lists of strings; it
 * needs no fleet, no rendering, and runs in milliseconds once the server
 * answers.
 *
 * That server is trustworthy as the contract: claude-coordinator's
 * `tests/test_openapi.py` already enforces `declared_routes(...) ==
 * spec_routes(...)` (#757) against the real Starlette route table, so a
 * path present in `GET /openapi.json` is a path the server actually serves,
 * and vice versa.
 *
 * `API_ROUTES` (`src/api/client.ts`) is the single source of truth this test
 * diffs against, in the spec's own `{param}` template form — the fetch
 * helpers build every concrete URL from that same map, so there's no second,
 * hand-maintained path list here to parse out of source or drift from what
 * the client actually requests.
 *
 * No `--dist` build: `GET /openapi.json` is computed from the Starlette
 * route table, independent of whether a frontend bundle is mounted
 * (`coord/dashboard/server.py`'s `_openapi_spec()`) — `{ dist: false }`
 * skips `fixtureServer.ts`'s production build, which this check never
 * exercises.
 */
import { test, expect } from '@playwright/test'
import { startFixtureServer, FIXTURE_PATH, type FixtureServerHandle } from './fixtureServer'
import { API_ROUTES } from '../src/api/client'

interface OpenApiSpec {
  paths: Record<string, unknown>
}

test.describe('client.ts fetch paths exist in the served OpenAPI spec (#78)', () => {
  let server: FixtureServerHandle
  let spec: OpenApiSpec

  test.beforeAll(async () => {
    server = await startFixtureServer(FIXTURE_PATH, { dist: false })
    const res = await fetch(`${server.baseUrl}/openapi.json`)
    expect(res.ok, `GET /openapi.json → HTTP ${res.status}`).toBe(true)
    spec = (await res.json()) as OpenApiSpec
  })

  test.afterAll(async () => {
    await server?.stop()
  })

  test('every API_ROUTES entry is a path the served spec declares', () => {
    const specPaths = new Set(Object.keys(spec.paths))
    const clientPaths = Object.values(API_ROUTES)
    const missing = clientPaths.filter((p) => !specPaths.has(p))

    expect(
      missing,
      `client.ts calls paths the served OpenAPI spec doesn't declare: ${missing.join(', ')}. ` +
        `Either the route was never built (see coord-web#76) or API_ROUTES has drifted from the ` +
        `real spec's template form — compare against a live GET /openapi.json.`,
    ).toEqual([])
  })

  // Advisory only (scope item 3, #78): spec paths this client never calls.
  // Useful signal for coverage gaps, but a legitimate server route this
  // client has no reason to use yet is not a bug here, so this never fails
  // the build.
  test('advisory: spec paths client.ts never calls', () => {
    const clientPaths = new Set(Object.values(API_ROUTES))
    const unused = Object.keys(spec.paths).filter((p) => !clientPaths.has(p))
    // eslint-disable-next-line no-console
    console.log(
      `[api-routes] spec paths API_ROUTES never calls (${unused.length}): ${unused.join(', ') || '(none)'}`,
    )
  })
})
