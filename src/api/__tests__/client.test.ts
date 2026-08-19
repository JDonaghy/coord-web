/**
 * Unit tests for `src/api/client.ts`'s drive-queue functions (issue #5,
 * QW-1) — a mocked global `fetch` asserting request shape (method/path/
 * body) and response parsing, the same bar this file's other functions are
 * held to (see the issue's "no UI in this issue" scope note).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { fetchDriveQueue, driveQueueAction, type DriveQueueData } from '@/api/client'

function makeDriveQueueData(): DriveQueueData {
  return {
    entries: [
      {
        id: 1,
        repo_name: 'myrepo',
        issue_number: 42,
        position: 0,
        machine: 'laptop',
        after_json: [],
        state: 'waiting',
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
        launch_host: '',
        hold_scope: 'entry',
        resumes: 0,
        retry_backoff_at: null,
      },
    ],
    summary: {
      level: 'normal',
      pending: 1,
      running: 0,
      waiting: 1,
      blocked: 0,
      eligible: 1,
      held: 0,
      fleet_held: 0,
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchDriveQueue', () => {
  it('GETs /api/drive-queue with no query string when repo is omitted', async () => {
    const data = makeDriveQueueData()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(data), { status: 200 }),
    )

    const result = await fetchDriveQueue()

    expect(fetch).toHaveBeenCalledWith('/api/drive-queue', undefined)
    expect(result).toEqual(data)
  })

  it('GETs /api/drive-queue?repo=<encoded> when repo is given', async () => {
    const data = makeDriveQueueData()
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(data), { status: 200 }),
    )

    await fetchDriveQueue('my/repo')

    expect(fetch).toHaveBeenCalledWith('/api/drive-queue?repo=my%2Frepo', undefined)
  })

  it('throws with the response body on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('boom', { status: 500 }),
    )

    await expect(fetchDriveQueue()).rejects.toThrow(/HTTP 500.*boom/)
  })
})

describe('driveQueueAction', () => {
  it('POSTs the body as JSON to /api/drive-queue/action and returns the parsed result', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    const body = { repo: 'myrepo', issue: 42, action: 'remove' as const }
    const result = await driveQueueAction(body)

    expect(fetch).toHaveBeenCalledWith('/api/drive-queue/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(result).toEqual({ ok: true })
  })

  it('returns {ok: false, error} from the body on a non-ok response, without throwing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: 'not implemented' }), { status: 501 }),
    )

    const result = await driveQueueAction({ repo: 'myrepo', issue: 42, action: 'add' })

    expect(result).toEqual({ ok: false, error: 'not implemented' })
  })

  it('falls back to an HTTP-status error when the body has none, on a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({}), { status: 501 }),
    )

    const result = await driveQueueAction({ repo: 'myrepo', issue: 42, action: 'move', to_position: 2 })

    expect(result).toEqual({ ok: false, error: 'HTTP 501' })
  })
})
