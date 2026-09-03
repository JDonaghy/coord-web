/**
 * Static contract check: every `e2e/fixtures/*.json` seed must still load in
 * the real `coord web --fixture` process.
 *
 * Sibling of `api-routes.spec.ts` (#78), one layer down: that spec proves the
 * *paths* `client.ts` calls exist in the served OpenAPI spec; this one proves
 * the *payloads* this repo seeds those paths with still match the schemas the
 * same spec declares for them.
 *
 * Why it exists. `coord/dashboard/fixture.py` grew a load-time validator
 * (claude-coordinator#3050, `_validate_seeded_payloads`) that walks every
 * route-backed section of a fixture against `openapi_spec()` and raises
 * `FixtureError` on the first mismatch. Two of this repo's fixtures had been
 * carrying a `machines[]` shape the server never actually serves — `reason:
 * null` where `MachineRow.reason` is a required non-nullable string, and an
 * `assignments.completed` key no schema declares (the panel only ever read
 * `assignments.active`). Nothing here noticed: the fixtures were only ever
 * fed to an older `coord` that accepted them verbatim, which is precisely the
 * silent generated-types/wire drift CLAUDE.md flags and claude-coordinator
 * #2258 tracks.
 *
 * When the pinned `code-coordinator` moved past that release, the fixtures
 * stopped loading and `coord web` exited before binding its port — surfacing
 * as `Process from config.webServer was not able to start` with all fifteen
 * sealed ms-3 acceptance tests red, in a job whose diff touched neither the
 * fixtures nor the Home screen. This spec turns that into one named failure
 * against the offending file, in the `e2e` job, with the validator's own
 * message attached.
 *
 * It deliberately covers the whole `e2e/fixtures/` directory rather than the
 * two files that happened to break: a fixture is added here roughly every
 * time a spec needs a new seeded scenario, and each new one inherits the same
 * drift exposure. `{ dist: false }` skips the production build — validation
 * happens in `load_fixture()` before any bundle is mounted, so the ~5s build
 * would buy nothing.
 *
 * NOT a substitute for a drift check on `src/api/generated.ts` (coord-web#77,
 * claude-coordinator#3045) — that gate needs the generator itself, which
 * isn't in the installed wheel. This only pins the fixtures.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFixtureServer } from './fixtureServer'

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fixtureFiles = fs
  .readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()

test.describe('e2e/fixtures/*.json still validate against the served OpenAPI schemas', () => {
  // A directory that silently emptied (a bad glob, a move) would make every
  // generated test below vanish and the file pass with zero assertions —
  // the confidently-wrong green playwright.acceptance.config.ts's own
  // docstring warns about. Pin the floor instead.
  test('the fixtures directory is non-empty', () => {
    expect(fixtureFiles.length).toBeGreaterThan(0)
  })

  for (const file of fixtureFiles) {
    test(`coord web --fixture loads ${file}`, async () => {
      // `startFixtureServer` rejects with the child's captured stdout+stderr
      // when `coord web` exits before becoming ready, so a FixtureError's
      // own field-level message ("machines[0].reason: null but schema is not
      // nullable") lands in the test output verbatim.
      const server = await startFixtureServer(path.join(FIXTURES_DIR, file), { dist: false })
      try {
        const res = await fetch(`${server.baseUrl}/api/board`)
        expect(res.ok, `GET /api/board → HTTP ${res.status}`).toBe(true)
      } finally {
        await server.stop()
      }
    })
  }
})
