/**
 * E2E acceptance net for the Board panel's tree/filter surface (#101).
 *
 * Runs at the default viewport only (not added to `playwright.config.ts`'s
 * `BREAKPOINT_PROJECT_FILES`) — same posture `gate-a.spec.ts`/`answers.
 * spec.ts` take, since #101 doesn't ask for per-breakpoint coverage the way
 * #91 (Milestones) did.
 *
 * `GET /api/drive-queue`'s shape below was captured by curling a live daemon
 * while building this panel — the `format-converter` titles are the same two
 * issues #101's own mock names verbatim. `GET /api/issue/{repo}/{number}`
 * (claude-coordinator#3194 / #107) is mocked per-issue by `mockIssueDetail`
 * below, wherever a test navigates into a detail view; the never-dispatched,
 * name≠slug and 404 cases that endpoint actually exists for are covered by
 * `e2e/board-detail-issue.spec.ts`, not duplicated here.
 *
 * Covers exactly the three things #101 asks e2e coverage for: filter by
 * number, expand a repo group, and render a body.
 */
import { test, expect, type Page } from '@playwright/test'

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

const DRIVE_QUEUE_ENTRIES = [
  {
    id: 1,
    repo_name: 'format-converter',
    issue_number: 2,
    position: 0,
    machine: null,
    after_json: [],
    state: 'blocked',
    attempts: 0,
    deferrals: 0,
    last_reason: '',
    reason_at: null,
    session_name: null,
    launched_at: null,
    enqueued_at: 1_700_000_000,
    hold_after: 0,
    hold_reason: '',
    resume_when: '',
    hold_state: '',
    hold_probes: 0,
    launch_host: 'dellserver',
    hold_scope: 'entry',
    resumes: 0,
    retry_backoff_at: null,
  },
  {
    id: 2,
    repo_name: 'format-converter',
    issue_number: 3,
    position: 1,
    machine: null,
    after_json: [],
    state: 'blocked',
    attempts: 0,
    deferrals: 0,
    last_reason: '',
    reason_at: null,
    session_name: null,
    launched_at: null,
    enqueued_at: 1_700_000_001,
    hold_after: 0,
    hold_reason: '',
    resume_when: '',
    hold_state: '',
    hold_probes: 0,
    launch_host: 'dellserver',
    hold_scope: 'entry',
    resumes: 0,
    retry_backoff_at: null,
  },
  {
    id: 3,
    repo_name: 'claude-coordinator',
    issue_number: 3,
    position: 2,
    machine: null,
    after_json: [],
    state: 'waiting',
    attempts: 0,
    deferrals: 0,
    last_reason: '',
    reason_at: null,
    session_name: null,
    launched_at: null,
    enqueued_at: 1_700_000_002,
    hold_after: 0,
    hold_reason: '',
    resume_when: '',
    hold_state: '',
    hold_probes: 0,
    launch_host: 'dellserver',
    hold_scope: 'entry',
    resumes: 0,
    retry_backoff_at: null,
  },
]

const DRIVE_QUEUE = {
  entries: DRIVE_QUEUE_ENTRIES,
  summary: { level: 'ok', pending: 0, running: 0, waiting: 1, blocked: 2, eligible: 0, held: 0, fleet_held: 0 },
  titles: {
    'format-converter#2': 'Cloudflare Pages scaffold: static, no-Access, strict no-egress CSP',
    'format-converter#3': 'YAML <-> JSON conversion engine with positioned error reporting',
    'claude-coordinator#3': 'Board panel — M-W2',
  },
}

/** The shell's own global reads — every spec that boots the app cold has to
 * stub these regardless of which panel it is testing. */
async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json([])))
  await page.route('**/api/sessions', (route) => route.fulfill(json([])))
}

async function mockBoard(page: Page): Promise<void> {
  await page.route('**/api/drive-queue', (route) => route.fulfill(json(DRIVE_QUEUE)))
}

/**
 * `GET /api/issue/{repo}/{number}` (#107) — `BoardDetail`'s one content
 * fetch, for every issue this spec navigates a detail view to. Titles match
 * `DRIVE_QUEUE.titles` above so a detail page's title matches the row it was
 * opened from. An unlisted repo/number 404s, mirroring the real endpoint's
 * "the store has never synced this issue" outcome.
 */
async function mockIssueDetail(page: Page): Promise<void> {
  const issues: Record<string, unknown> = {
    'format-converter/2': {
      repo_name: 'format-converter',
      number: 2,
      title: 'Cloudflare Pages scaffold: static, no-Access, strict no-egress CSP',
      body: '## What\n\nStatic Cloudflare Pages scaffold, no Access, strict no-egress CSP.\n',
      state: 'open',
      labels: ['area:infra'],
      milestone_number: null,
      milestone_title: null,
      html_url: 'https://github.com/JDonaghy/format-converter/issues/2',
    },
    'format-converter/3': {
      repo_name: 'format-converter',
      number: 3,
      title: 'YAML <-> JSON conversion engine with positioned error reporting',
      body:
        '## What\n\nParse YAML and JSON bidirectionally.\n\n' +
        '- positioned errors\n- a fenced example:\n\n```yaml\nkey: value\n```\n',
      state: 'open',
      labels: [],
      milestone_number: null,
      milestone_title: null,
      html_url: 'https://github.com/JDonaghy/format-converter/issues/3',
    },
    'claude-coordinator/3': {
      repo_name: 'claude-coordinator',
      number: 3,
      title: 'Board panel — M-W2',
      body: '## What\n\nBoard panel.\n',
      state: 'open',
      labels: [],
      milestone_number: null,
      milestone_title: null,
      html_url: 'https://github.com/JDonaghy/code-coordinator/issues/3',
    },
  }
  await page.route('**/api/issue/*/*', (route) => {
    const url = new URL(route.request().url())
    const [, , , repo, number] = url.pathname.split('/')
    const key = `${repo}/${number}`
    const issue = issues[key]
    if (!issue) {
      return route.fulfill(json({ error: `unknown issue '${key}'` }, 404))
    }
    return route.fulfill(json(issue))
  })
}

const rail = (page: Page) => page.locator('[data-region="rail"]')
const statusBar = (page: Page) => page.getByLabel('Status')

async function expectShellAlive(page: Page): Promise<void> {
  await expect(rail(page)).toBeVisible()
  await expect(statusBar(page)).toBeVisible()
  await expect(page.getByText(/panel hit an error/)).toHaveCount(0)
}

test.describe('Board panel', () => {
  test('the rail entry is live and navigates — no longer a SOON placeholder', async ({ page }) => {
    await mockShellApi(page)
    await mockBoard(page)
    await page.goto('/pipeline')

    const entry = rail(page).getByRole('button', { name: /Board/ })
    await expect(entry).toBeEnabled()
    await entry.click()

    await expect(page).toHaveURL(/\/board$/)
    await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
    await expectShellAlive(page)
  })

  test('groups are collapsed by default and expand on click (#101 tree)', async ({ page }) => {
    await mockShellApi(page)
    await mockBoard(page)
    await page.goto('/board')

    await expect(page.getByText('format-converter')).toBeVisible()
    await expect(page.getByTestId('board-issue-format-converter-2')).toHaveCount(0)

    await page.getByTestId('board-group-format-converter').click()

    await expect(page.getByTestId('board-issue-format-converter-2')).toContainText(
      'Cloudflare Pages scaffold',
    )
    await expect(page.getByTestId('board-issue-format-converter-3')).toContainText(
      'YAML <-> JSON conversion engine',
    )
  })

  test('typing a bare number narrows every repo to that issue number', async ({ page }) => {
    await mockShellApi(page)
    await mockBoard(page)
    await page.goto('/board')

    await page.getByTestId('board-filter-input').fill('3')

    await expect(page.getByTestId('board-issue-format-converter-3')).toBeVisible()
    await expect(page.getByTestId('board-issue-claude-coordinator-3')).toBeVisible()
    await expect(page.getByTestId('board-issue-format-converter-2')).toHaveCount(0)
  })

  test('typing an alias ref (FC#3) jumps straight to that issue', async ({ page }) => {
    await mockShellApi(page)
    await mockBoard(page)
    await mockIssueDetail(page)
    await page.goto('/board')

    await page.getByTestId('board-filter-input').fill('FC#3')

    await expect(page).toHaveURL(/\/board\/format-converter\/3$/)
    await expect(page.getByTestId('board-detail-title')).toContainText('YAML <-> JSON conversion engine')
  })

  test('renders a dispatched issue’s body as markdown, from GET /api/issue (#107 — no regression)', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockBoard(page)
    await mockIssueDetail(page)
    await page.goto('/board')
    await page.getByTestId('board-group-format-converter').click()
    await page.getByTestId('board-issue-format-converter-3').click()

    await expect(page).toHaveURL(/\/board\/format-converter\/3$/)
    // The rendered markdown -- a heading, a list item, a fenced code block --
    // this is the issue body straight off GET /api/issue, never a briefing
    // wrapper (there is no "Issue #3: ..." synthesized line to strip anymore).
    await expect(page.getByRole('heading', { name: 'What' })).toBeVisible()
    await expect(page.getByText('positioned errors')).toBeVisible()
    await expect(page.locator('pre code')).toContainText('key: value')
    await expect(page.getByText(/^Issue #3:/)).toHaveCount(0)
    await expectShellAlive(page)
  })
})
