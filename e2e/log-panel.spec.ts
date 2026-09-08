/**
 * E2E coverage for #110 — the stage rail + turn stream at `/log/:repo/:issue`
 * (`LogPanel.tsx`/`StageRail.tsx`).
 *
 * `/api/pipeline` is mocked via `page.route()`, the standard convention this
 * suite uses everywhere except `live-update-fixture.spec.ts` (see that
 * file's header). `GET /api/assignment/{id}/log` is SSE, which
 * `page.route()` can only fulfil as a static, connection-closing body —
 * `realtime.spec.ts` already established the fix for that class of endpoint
 * in this repo: inject a controllable fake `window.EventSource` via
 * `page.addInitScript()` before `page.goto()`, then drive it from Node.
 * Reused here verbatim (own copy, not imported — a Playwright spec file
 * doesn't share module scope with another spec, and `addInitScript`'s
 * closure must be self-contained JS with no outer references anyway).
 */
import { test, expect, type Page } from '@playwright/test'

// ── Fake EventSource injection (mirrors realtime.spec.ts) ──────────────────

async function installFakeEventSource(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeEventSource {
      url: string
      closed = false
      onopen: ((ev: unknown) => void) | null = null
      onerror: ((ev: unknown) => void) | null = null
      private listeners: Record<string, Array<(ev: { data: string }) => void>> = {}

      constructor(url: string) {
        this.url = url
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).__sse.instances.push(this)
      }

      addEventListener(type: string, cb: (ev: { data: string }) => void): void {
        ;(this.listeners[type] ??= []).push(cb)
      }

      close(): void {
        this.closed = true
      }

      emitOpen(): void {
        this.onopen?.({})
      }

      emitMessage(type: string, data: string): void {
        for (const cb of this.listeners[type] ?? []) cb({ data })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).__sse = { instances: [] as FakeEventSource[] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).EventSource = FakeEventSource
  })
}

/** Drives the fake `EventSource` instance whose `url` contains *urlPart* —
 * scoping past the global `/events` connection `RealtimeProvider` always
 * opens too, which this spec never drives. */
async function emitToLogStream(
  page: Page,
  urlPart: string,
  action: 'open' | { message: [string, string] },
): Promise<void> {
  await page.waitForFunction(
    (part) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sse = (window as any).__sse
      return sse.instances.some((i: { url: string; closed: boolean }) => !i.closed && i.url.includes(part))
    },
    urlPart,
  )
  await page.evaluate(
    ({ part, act }: { part: string; act: 'open' | { message: [string, string] } }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sse = (window as any).__sse
      const inst = sse.instances
        .filter((i: { url: string; closed: boolean }) => !i.closed && i.url.includes(part))
        .at(-1)
      if (act === 'open') inst.emitOpen()
      else inst.emitMessage(act.message[0], act.message[1])
    },
    { part: urlPart, act: action },
  )
}

// ── Seeded pipeline row ──────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

function makePipelineRow() {
  return {
    assignment_id: 'work-42',
    issue_number: 42,
    issue_title: 'Fix the dashboard rendering',
    repo_name: 'api',
    machine_name: 'laptop',
    current_stage: 'coding',
    stages: [
      { name: 'coding', status: 'active', is_current: true },
      { name: 'smoke', status: 'waiting', is_current: false },
      { name: 'review', status: 'waiting', is_current: false },
      { name: 'uat', status: 'waiting', is_current: false },
      { name: 'merge', status: 'waiting', is_current: false },
    ],
    available_gates: [],
    progress_pct: 10,
    review_findings_pending: false,
    review_verdict: null,
    review_verdict_original: null,
    review_verdict_override_reason: null,
    review_findings_body: null,
    test_verdict: null,
    needs_attention: false,
    needs_attention_reason: null,
    needs_attention_detail: null,
    finished_at: null,
  }
}

function assistantLine(text: string, tools: Array<{ name: string; input?: unknown }> = []) {
  const content: unknown[] = [{ type: 'text', text }]
  for (const t of tools) content.push({ type: 'tool_use', name: t.name, input: t.input })
  return JSON.stringify({ type: 'assistant', message: { content } }) + '\n'
}

async function mockPipeline(page: Page, rows: unknown[]): Promise<void> {
  await page.route('**/api/pipeline', (route) => route.fulfill(json(rows)))
}

test.describe('LogPanel — stage rail + turn stream (#110)', () => {
  test('renders the stage rail and streams a turn (narration + tool call)', async ({ page }) => {
    await installFakeEventSource(page)
    await mockPipeline(page, [makePipelineRow()])

    await page.goto('/log/api/42')

    // Stage rail: five connected boxes, the in-flight one distinguishable
    // from stages not yet reached.
    await expect(page.getByTestId('stage-rail-coding')).toBeVisible()
    await expect(page.getByTestId('stage-rail-coding')).toHaveAttribute('data-stage-current', 'true')
    await expect(page.getByTestId('stage-rail-merge')).toHaveAttribute('data-stage-fill', 'pending')

    await emitToLogStream(page, '/api/assignment/work-42/log', 'open')
    await emitToLogStream(page, '/api/assignment/work-42/log', {
      message: [
        'log',
        assistantLine('Looking at the failing test.', [{ name: 'Bash', input: { command: 'npm test' } }]),
      ],
    })

    const turn = page.getByTestId('log-entry-turn-1')
    await expect(turn).toBeVisible()
    await expect(turn).toContainText('Turn 1')
    await expect(turn).toContainText('Looking at the failing test.')
    await expect(turn).toContainText('Bash')
    await expect(turn).toContainText('npm test')
  })

  test('a rate_limit_event is never silently dropped', async ({ page }) => {
    await installFakeEventSource(page)
    await mockPipeline(page, [makePipelineRow()])
    await page.goto('/log/api/42')

    await emitToLogStream(page, '/api/assignment/work-42/log', 'open')
    await emitToLogStream(page, '/api/assignment/work-42/log', {
      message: [
        'log',
        JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: { status: 'rejected', resetsAt: 1893456000 },
        }) + '\n',
      ],
    })

    await expect(page.getByTestId('log-entry-rate-limit')).toContainText('[rate_limit]')
  })

  test('an issue with no recorded leg renders an honest empty state, not a blank page', async ({ page }) => {
    await installFakeEventSource(page)
    await mockPipeline(page, [])
    await page.goto('/log/api/999')

    await expect(page.getByTestId('log-not-found')).toBeVisible()
    await expect(page.getByTestId('log-turn-stream')).toHaveCount(0)
  })

  test('a Board detail issue links to its Log view', async ({ page }) => {
    await mockPipeline(page, [])
    await page.route('**/api/sessions', (route) => route.fulfill(json([])))
    await page.route('**/api/drive-queue', (route) =>
      route.fulfill(
        json({
          entries: [],
          summary: { level: 'ok', pending: 0, running: 0, waiting: 0, blocked: 0, eligible: 0, held: 0, fleet_held: 0 },
          titles: {},
        }),
      ),
    )
    await page.route('**/api/issue/api/42', (route) =>
      route.fulfill(
        json({
          repo_name: 'api',
          number: 42,
          title: 'Fix the dashboard rendering',
          body: 'body text',
          state: 'open',
          labels: [],
          milestone_number: null,
          milestone_title: null,
          html_url: 'https://github.com/JDonaghy/api/issues/42',
        }),
      ),
    )

    await page.goto('/board/api/42')
    const logLink = page.getByTestId('board-detail-log-link')
    await expect(logLink).toBeVisible()
    await expect(logLink).toHaveAttribute('href', '/log/api/42')
  })
})
