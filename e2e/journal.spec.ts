/**
 * E2E coverage for #93 — the Journal panel at `/journal` /
 * `/journal/:submissionId`, over `GET /api/journal/{submission_id}`
 * (claude-coordinator#3091).
 *
 * Runs as its own line item at **both** breakpoints ('wide' / 'narrow'
 * projects, see `playwright.config.ts`) rather than under `chromium` with a
 * `test.use({ viewport })` override, same posture `theme.spec.ts` and
 * `machines-responsive.spec.ts` take: the audience for this panel is a
 * client on a phone or someone watching a screen share, so "readable at
 * 390px" is a requirement, not a nice-to-have, and a regression pinned to
 * one breakpoint has to show up as its own failing project.
 *
 * Both themes are covered in the same file for the same reason — this is the
 * one panel that gets shown to someone who is *not* an operator, and the
 * event-kind colour system (`JournalPanel`'s `TONE_STYLE`) is the thing most
 * likely to be legible in one theme and not the other.
 *
 * `page.route()` against the mocked endpoint, not a live `coord web
 * --fixture` process: `coord/dashboard/fixture.py` has no seeded portal
 * ledger, so a fixture server can only ever return the *empty* run — which
 * is one of the states below, not all of them. The bodies mocked here are
 * transcribed from the real endpoint's served OpenAPI schema
 * (`JournalResponse`/`JournalEntryWire`, now in `src/api/generated.ts`) and
 * from a live `curl` against `coord web --fixture` on `code-coordinator`
 * 0.5.368 — see `src/api/__tests__/journal.test.ts`'s header. The
 * "does this path exist at all" question that #76 got wrong is answered
 * separately and for real by `api-routes.spec.ts`, which diffs `API_ROUTES`
 * against a live `GET /openapi.json`.
 *
 * Run: npm run test:e2e
 */
import { test, expect, type Page } from '@playwright/test'

const SUB = 'sub_abc123'

/** Local wall-clock -> epoch seconds, matching the panel's local-calendar
 * day grouping (see `src/lib/journal.ts`'s header). Computed in the *test
 * process*, which shares a timezone with the browser Playwright launches. */
function at(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000
}

interface WireEntry {
  ts: number
  kind: string
  actor: string
  text: string
  artifact: string | null
  source: string
  details: Record<string, unknown>
}

function wireEntry(overrides: Partial<WireEntry> = {}): WireEntry {
  return {
    ts: at(2026, 2, 3, 9, 15),
    kind: 'question_pushed',
    actor: 'coord',
    text: 'What is the shipping address for the replacement unit?',
    artifact: null,
    source: 'ledger',
    details: {},
    ...overrides,
  }
}

/** A run that spans three days and touches all four event families. */
const FULL_RUN = {
  submission_id: SUB,
  title: 'Replacement unit portal',
  customer_status: 'in_progress',
  link: {
    repo_name: 'acme/site',
    milestone_number: 4,
    issue_number: 12,
    submission_id: SUB,
    linked_at: at(2026, 2, 3, 8, 0),
    actor: 'operator',
    schema: 1,
  },
  gaps: [],
  entries: [
    wireEntry({ ts: at(2026, 2, 3, 9, 15), kind: 'question_pushed' }),
    wireEntry({
      ts: at(2026, 2, 3, 17, 40),
      kind: 'question_answered',
      actor: 'customer',
      text: 'The Leeds office.',
    }),
    wireEntry({
      ts: at(2026, 2, 5, 11, 0),
      kind: 'design_round_published',
      text: 'round 1 published',
      artifact: 'https://cdn.example/bundles/sub-001/r1',
    }),
    wireEntry({
      ts: at(2026, 2, 5, 16, 30),
      kind: 'signoff_recorded',
      actor: 'customer',
      text: 'approved: looks right',
    }),
    wireEntry({
      ts: at(2026, 2, 6, 14, 5),
      kind: 'merged',
      actor: 'coordinator',
      text: 'acme/site#12 merged',
      artifact: 'https://github.com/acme/site/pull/40',
    }),
  ],
}

/** The body a live `coord web --fixture` really returns for an unlinked or
 * unknown submission — 200, no entries, and a gap saying why. */
const EMPTY_RUN = {
  submission_id: SUB,
  title: '',
  customer_status: '',
  link: null,
  gaps: [
    `no repo/milestone linked to ${SUB} — dispatch and merge events are not in this timeline (\`coord portal link\`)`,
  ],
  entries: [],
}

async function mockJournal(page: Page, body: unknown, status = 200): Promise<void> {
  await page.route('**/api/journal/**', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

/** The panel reaches for `/api/portal/needs-input` to populate its quick
 * picks, and `ShellLayout` for pipeline/sessions/board. Stub them so a
 * journal assertion never fails for an unrelated reason. */
async function mockShellApis(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.route('**/api/board', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ round_number: 1, active: [], completed: [] }),
    }),
  )
  await page.route('**/api/portal/needs-input', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        submissions: [{ submission_id: 'sub_waiting', question: 'Which font?', revision: 1 }],
      }),
    }),
  )
}

function themeToggle(page: Page) {
  return page.getByRole('button', { name: /Switch to (dark|light) theme/ })
}

function htmlTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'))
}

// Pin the emulated OS preference so "no stored theme yet" resolves to dark,
// the documented default — same as theme.spec.ts.
test.use({ colorScheme: 'dark' })

test.describe('Journal panel (#93)', () => {
  test.beforeEach(async ({ page }) => {
    await mockShellApis(page)
  })

  test('the rail reaches it, and it lands on the picker with nothing selected', async ({ page }) => {
    await mockJournal(page, EMPTY_RUN)
    await page.goto('/pipeline')

    await page.locator('[data-region="rail"]').getByRole('button', { name: /Journal/ }).click()

    await expect(page).toHaveURL(/\/journal$/)
    await expect(page.getByTestId('journal-no-selection')).toBeVisible()
    await expect(page.getByTestId('journal-submission-input')).toBeVisible()
  })

  test('picking a submission renders its run grouped by day, oldest first', async ({ page }) => {
    await mockJournal(page, FULL_RUN)
    await page.goto('/journal')

    await page.getByTestId('journal-submission-input').fill(SUB)
    await page.getByTestId('journal-show-button').click()

    // The URL carries the selection, so this view is bookmarkable/pasteable.
    await expect(page).toHaveURL(new RegExp(`/journal/${SUB}$`))
    await expect(page.getByTestId('journal-timeline')).toBeVisible()

    const days = page.getByTestId(/^journal-day-/)
    await expect(days).toHaveCount(3)
    await expect(days.nth(0)).toContainText('Tue 3 Feb 2026')
    await expect(days.nth(2)).toContainText('Fri 6 Feb 2026')
    // Two moments on day one, and the answer reads in full.
    await expect(days.nth(0).getByTestId(/^journal-entry-/)).toHaveCount(2)
    await expect(days.nth(0)).toContainText('The Leeds office.')
  })

  test('a deep link to one run restores it on a cold load', async ({ page }) => {
    await mockJournal(page, FULL_RUN)
    await page.goto(`/journal/${SUB}`)

    await expect(page.getByTestId('journal-timeline')).toBeVisible()
    await expect(page.getByTestId('journal-submission-id')).toHaveText(SUB)
    await expect(page.getByTestId('journal-submission-input')).toHaveValue(SUB)
    await expect(page.getByTestId('journal-link')).toContainText('acme/site')
  })

  test('event kinds are visually distinct — not one undifferentiated feed', async ({ page }) => {
    await mockJournal(page, FULL_RUN)
    await page.goto(`/journal/${SUB}`)

    await expect(page.getByTestId('journal-timeline')).toBeVisible()

    const tones = await page.getByTestId(/^journal-entry-/).evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.tone),
    )
    expect(tones).toEqual(['design', 'client', 'design', 'client', 'ship'])

    // Form, not just text: the client answer's chip and the merge's chip do
    // not resolve to the same colour.
    const answerChip = page.getByTestId('journal-kind-question_answered')
    const mergeChip = page.getByTestId('journal-kind-merged')
    const answerColour = await answerChip.evaluate((el) => getComputedStyle(el).color)
    const mergeColour = await mergeChip.evaluate((el) => getComputedStyle(el).color)
    expect(answerColour).not.toEqual(mergeColour)
    // ...and each carries its own glyph, so the distinction survives a
    // monochrome screen share.
    await expect(answerChip.locator('svg')).toHaveCount(1)
    await expect(mergeChip.locator('svg')).toHaveCount(1)
  })

  test('an entry carrying an artifact is a real link; one without is plain text', async ({
    page,
  }) => {
    await mockJournal(page, FULL_RUN)
    await page.goto(`/journal/${SUB}`)

    const pr = page.getByTestId(`journal-artifact-merged-${at(2026, 2, 6, 14, 5)}`)
    await expect(pr).toHaveAttribute('href', 'https://github.com/acme/site/pull/40')
    await expect(pr).toHaveText(/Open PR/)
    await expect(pr).toHaveAttribute('target', '_blank')

    const bundle = page.getByTestId(`journal-artifact-design_round_published-${at(2026, 2, 5, 11, 0)}`)
    await expect(bundle).toHaveText(/Open bundle/)

    // Only the two artifact-carrying entries are links.
    await expect(page.getByTestId('journal-timeline').getByRole('link')).toHaveCount(2)
  })

  // ── degraded states (#93's explicit acceptance list) ──────────────────────

  test('an empty timeline reads as "nothing has happened yet", never as an error', async ({
    page,
  }) => {
    await mockJournal(page, EMPTY_RUN)
    await page.goto(`/journal/${SUB}`)

    await expect(page.getByTestId('journal-empty')).toContainText(/nothing has happened yet/i)
    await expect(page.getByTestId('journal-fetch-error')).toHaveCount(0)
    await expect(page.getByTestId('journal-unavailable')).toHaveCount(0)
    // The reason is still shown — an empty run with a stated cause beats an
    // empty run without one.
    await expect(page.getByTestId('journal-gaps')).toContainText('coord portal link')
  })

  test('a timeline with gaps shows what is missing above the entries, not after them', async ({
    page,
  }) => {
    await mockJournal(page, {
      ...FULL_RUN,
      gaps: [
        'audit trail unreadable for acme/site#12: database is locked',
        'no issue numbers resolvable for acme/site ms-4',
      ],
    })
    await page.goto(`/journal/${SUB}`)

    const gaps = page.getByTestId('journal-gaps')
    await expect(gaps).toContainText('2 things are missing from this timeline')
    await expect(gaps).toContainText('database is locked')
    // The entries still render — a partial story is still a story.
    await expect(page.getByTestId(/^journal-entry-/)).toHaveCount(5)
    // Above, not below: the reader learns it is incomplete before reading it.
    const gapsBox = await gaps.boundingBox()
    const firstDayBox = await page.getByTestId(/^journal-day-/).first().boundingBox()
    expect(gapsBox!.y).toBeLessThan(firstDayBox!.y)
  })

  test('a 500 from the endpoint surfaces the failure, and the picker stays usable', async ({
    page,
  }) => {
    await mockJournal(page, { error: 'boom' }, 500)
    await page.goto(`/journal/${SUB}`)

    await expect(page.getByTestId('journal-fetch-error')).toContainText(/HTTP 500/)
    await expect(page.getByTestId('journal-submission-input')).toBeVisible()
  })

  test('a 404 — the endpoint absent because the fleet has not been rolled — explains itself', async ({
    page,
  }) => {
    // The realistic case for as long as the roll lags: coord-web deploys on
    // its own timer, so this bundle can be newer than the API serving it.
    // Must be an explanatory empty state, never a white screen.
    await mockJournal(page, { error: 'Not Found' }, 404)
    await page.goto(`/journal/${SUB}`)

    await expect(page.getByTestId('journal-unavailable')).toContainText(/no journal API yet/i)
    await expect(page.getByTestId('journal-fetch-error')).toHaveCount(0)
    // Not a white screen: the shell is still there and still navigable.
    await expect(page.locator('[data-region="rail"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible()
  })

  test('a malformed body is caught at the seam, not inside a render (#85)', async ({ page }) => {
    // `{submissions: [...]}`-shaped nonsense where the envelope is expected —
    // the exact class of bug #84 shipped. It must reach the error state, not
    // blank the panel.
    await mockJournal(page, [{ ts: 1, kind: 'merged' }])
    await page.goto(`/journal/${SUB}`)

    await expect(page.getByTestId('journal-fetch-error')).toContainText(/JournalResponse object/)
    await expect(page.locator('[data-region="rail"]')).toBeVisible()
  })

  // ── both themes ──────────────────────────────────────────────────────────

  test('the timeline renders in both themes, and the kind colours stay distinct', async ({
    page,
  }) => {
    await mockJournal(page, FULL_RUN)
    await page.goto(`/journal/${SUB}`)
    await expect(page.getByTestId('journal-timeline')).toBeVisible()

    const answerChip = page.getByTestId('journal-kind-question_answered')
    const mergeChip = page.getByTestId('journal-kind-merged')
    const colours = () =>
      Promise.all([
        answerChip.evaluate((el) => getComputedStyle(el).color),
        mergeChip.evaluate((el) => getComputedStyle(el).color),
      ])

    await expect.poll(() => htmlTheme(page)).toBe('dark')
    const [darkAnswer, darkMerge] = await colours()
    expect(darkAnswer).not.toEqual(darkMerge)

    await themeToggle(page).click()
    await expect.poll(() => htmlTheme(page)).toBe('light')

    // Still rendering, still distinct, and genuinely repainted.
    await expect(page.getByTestId('journal-timeline')).toBeVisible()
    await expect(page.getByTestId(/^journal-entry-/)).toHaveCount(5)
    const [lightAnswer, lightMerge] = await colours()
    expect(lightAnswer).not.toEqual(lightMerge)
    expect(lightAnswer).not.toEqual(darkAnswer)
  })

  test('the degraded states are legible in light theme too', async ({ page }) => {
    await mockJournal(page, EMPTY_RUN)
    await page.goto(`/journal/${SUB}`)
    await expect(page.getByTestId('journal-empty')).toBeVisible()

    await themeToggle(page).click()
    await expect.poll(() => htmlTheme(page)).toBe('light')

    await expect(page.getByTestId('journal-empty')).toBeVisible()
    await expect(page.getByTestId('journal-gaps')).toBeVisible()
  })

  // ── breakpoint-sensitive layout ──────────────────────────────────────────

  test('no row overflows its column at this viewport', async ({ page }) => {
    // The narrow project is what this exists for: a long, unbroken journal
    // text (a URL a client pasted into an answer) must wrap, not push a
    // horizontal scrollbar onto a 390px phone.
    await mockJournal(page, {
      ...FULL_RUN,
      entries: [
        wireEntry({
          kind: 'question_answered',
          actor: 'customer',
          text: 'see https://example.com/an/extremely/long/path/that/will/not/wrap/on/its/own/unless/we/ask/it/to/and/keeps/going',
        }),
      ],
    })
    await page.goto(`/journal/${SUB}`)
    await expect(page.getByTestId('journal-timeline')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('the quick picks offer whatever coord is currently waiting on', async ({ page }) => {
    await mockJournal(page, FULL_RUN)
    await page.goto('/journal')

    await page.getByTestId('journal-quick-pick-sub_waiting').click()
    await expect(page).toHaveURL(/\/journal\/sub_waiting$/)
    await expect(page.getByTestId('journal-timeline')).toBeVisible()
  })
})
