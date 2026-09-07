/**
 * E2E acceptance net for the Board panel (#101).
 *
 * Runs at the default viewport only (not added to `playwright.config.ts`'s
 * `BREAKPOINT_PROJECT_FILES`) — same posture `gate-a.spec.ts`/`answers.
 * spec.ts` take, since #101 doesn't ask for per-breakpoint coverage the way
 * #91 (Milestones) did.
 *
 * `GET /api/drive-queue` and `GET /api/board`'s shapes below were both
 * captured by curling a live daemon while building this panel (see
 * `src/lib/board.ts`'s header for the full story of why this panel reads
 * those two real, already-registered routes instead of a dedicated Board
 * endpoint — that endpoint doesn't exist in `coord-web`'s own API yet, and
 * this repo ships no backend code to add one). The `format-converter`
 * titles below are the same two issues #101's own mock names verbatim.
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

async function mockBoard(page: Page, boardOverride?: unknown): Promise<void> {
  await page.route('**/api/drive-queue', (route) => route.fulfill(json(DRIVE_QUEUE)))
  await page.route('**/api/board', (route) =>
    route.fulfill(json(boardOverride ?? { round_number: 1, active: [], completed: [] })),
  )
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
    await page.goto('/board')

    await page.getByTestId('board-filter-input').fill('FC#3')

    await expect(page).toHaveURL(/\/board\/format-converter\/3$/)
    await expect(page.getByTestId('board-detail-title')).toContainText('YAML <-> JSON conversion engine')
  })

  test('renders a dispatched issue’s body as markdown, and an honest gap for one that has none', async ({
    page,
  }) => {
    await mockShellApi(page)
    await mockBoard(page, {
      round_number: 1,
      active: [
        {
          machine_name: 'dellserver',
          repo_name: 'format-converter',
          issue_number: 3,
          issue_title: 'YAML <-> JSON conversion engine with positioned error reporting',
          files_allowed: [],
          files_forbidden: [],
          briefing:
            'Issue #3: YAML <-> JSON conversion engine with positioned error reporting\n\n' +
            '## What\n\nParse YAML and JSON bidirectionally.\n\n' +
            '- positioned errors\n- a fenced example:\n\n```yaml\nkey: value\n```\n',
          assignment_id: 'a1',
          status: 'running',
          branch: null,
          pr_url: null,
          dispatched_at: 1_700_000_000,
          finished_at: null,
          smoke_test: null,
          smoke_test_reason: null,
          type: 'work',
          review_target: null,
          review_of_assignment_id: null,
          unreachable_count: 0,
          model: null,
          plan: null,
          review_state: null,
          review_dispatch_reason: null,
          required_gates: [],
          review_iteration: 0,
          review_posted_at: null,
          test_state: null,
          test_reason: null,
          test_head_sha: null,
          test_patch_id: null,
          test_base_sha: null,
          test_toolchain: null,
          review_verdict: null,
          review_verdict_original: null,
          review_verdict_override_reason: null,
          verdict_source: null,
          verdict_source_reason: null,
          review_head_sha: null,
          review_patch_id: null,
          review_scoped: false,
          review_scope_base_sha: null,
          cost_usd: null,
          smoke_tests: null,
          provider_name: null,
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_tokens: 0,
          cache_read_tokens: 0,
          failure_reason: null,
          acceptance_state: null,
          acceptance_reason: null,
          acceptance_sha: null,
          acceptance_total: null,
          acceptance_passed: null,
          completion_summary: null,
          audit_goals_json: null,
          audit_bottom_line: null,
          audit_run_number: null,
          for_issue_number: null,
          driven_by: null,
          stop_reason: null,
        },
      ],
      completed: [],
    })
    await page.goto('/board')
    await page.getByTestId('board-group-format-converter').click()
    await page.getByTestId('board-issue-format-converter-3').click()

    await expect(page).toHaveURL(/\/board\/format-converter\/3$/)
    // The rendered markdown -- a heading, a list item, a fenced code block --
    // not the raw "Issue #3: ..." text the dispatcher synthesized.
    await expect(page.getByRole('heading', { name: 'What' })).toBeVisible()
    await expect(page.getByText('positioned errors')).toBeVisible()
    await expect(page.locator('pre code')).toContainText('key: value')
    await expect(page.getByText(/^Issue #3:/)).toHaveCount(0)

    // #101's own second example issue was never dispatched -- an honest gap,
    // not a fabricated body.
    await page.goto('/board/format-converter/2')
    await expect(page.getByTestId('board-detail-no-body')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/format-converter/issues/2',
    )
    await expectShellAlive(page)
  })
})
