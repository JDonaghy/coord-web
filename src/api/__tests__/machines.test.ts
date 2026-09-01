/**
 * Unit tests for `src/api/client.ts`'s Machines-surface functions (#61) — a
 * mocked global `fetch` asserting request shape and, critically, the
 * older-API degradation path issue #61 calls out by name: every one of these
 * endpoints 404s against a coord server that predates
 * claude-coordinator#3027 (every coord server running today), and that must
 * resolve to an honest `{available: false}`, never a thrown `Error` and
 * never a value indistinguishable from "loaded, genuinely empty."
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchMachine,
  fetchMachineHealth,
  fetchMachineMetrics,
  fetchMachineWorkStats,
  fetchMachines,
  type MachineHealthRow,
  type MachineMetricsSeries,
  type MachineState,
  type MachineWorkStats,
} from '@/api/client'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchMachines', () => {
  it('GETs /api/machines and returns {available: true, data} on 200', async () => {
    const machines: MachineState[] = [
      {
        name: 'laptop',
        host: 'laptop.tailnet.ts.net',
        reachable: true,
        last_seen: 1_700_000_000,
        active_assignments: 1,
        headless_workers: 2,
        severity: 'ok',
        agent_version: '1.2.3',
        is_local: true,
        quiet_hours_paused: false,
        hand_paused: false,
        release_cordoned: false,
      },
    ]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(machines), { status: 200 }))

    const result = await fetchMachines()

    expect(fetch).toHaveBeenCalledWith('/api/machines')
    expect(result).toEqual({ available: true, data: machines })
  })

  it('resolves to {available: false} on 404 -- the older-API degradation path (#61)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('not found', { status: 404 }))

    const result = await fetchMachines()

    expect(result).toEqual({ available: false })
  })

  it('still throws on a real server error, never silently degrading a 500', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }))

    await expect(fetchMachines()).rejects.toThrow(/HTTP 500.*boom/)
  })
})

describe('fetchMachine', () => {
  it('GETs /api/machines/{name}, encoded', async () => {
    const machine: MachineState = {
      name: 'a b',
      host: null,
      reachable: false,
      last_seen: null,
      active_assignments: 0,
      headless_workers: 0,
      severity: 'unknown',
      agent_version: null,
      is_local: false,
      quiet_hours_paused: false,
      hand_paused: false,
      release_cordoned: false,
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(machine), { status: 200 }))

    const result = await fetchMachine('a b')

    expect(fetch).toHaveBeenCalledWith('/api/machines/a%20b')
    expect(result).toEqual({ available: true, data: machine })
  })

  it('resolves to {available: false} on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))
    expect(await fetchMachine('laptop')).toEqual({ available: false })
  })
})

describe('fetchMachineMetrics / fetchMachineHealth / fetchMachineWorkStats', () => {
  it('build the expected per-machine sub-paths, encoded', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await fetchMachineMetrics('a b')
    expect(fetch).toHaveBeenLastCalledWith('/api/machines/a%20b/metrics')

    vi.mocked(fetch).mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await fetchMachineHealth('a b')
    expect(fetch).toHaveBeenLastCalledWith('/api/machines/a%20b/health')

    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await fetchMachineWorkStats('a b')
    expect(fetch).toHaveBeenLastCalledWith('/api/machines/a%20b/work-stats')
  })

  it('each degrades to {available: false} on 404 independently', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))

    expect(await fetchMachineMetrics('laptop')).toEqual({ available: false })
    expect(await fetchMachineHealth('laptop')).toEqual({ available: false })
    expect(await fetchMachineWorkStats('laptop')).toEqual({ available: false })
  })

  it('parses real payloads when available', async () => {
    const series: MachineMetricsSeries[] = [{ metric: 'load1', unit: null, points: [{ t: 1, value: 0.5 }] }]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(series), { status: 200 }))
    expect(await fetchMachineMetrics('laptop')).toEqual({ available: true, data: series })

    const health: MachineHealthRow[] = [
      { check: 'disk', status: 'ok', detail: null, checked_at: 1_700_000_000 },
    ]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(health), { status: 200 }))
    expect(await fetchMachineHealth('laptop')).toEqual({ available: true, data: health })

    const workStats: MachineWorkStats = {
      machine: 'laptop',
      window_seconds: 86400,
      assignments_completed: 3,
      assignments_failed: 1,
      cost_usd: 1.23,
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(workStats), { status: 200 }))
    expect(await fetchMachineWorkStats('laptop')).toEqual({ available: true, data: workStats })
  })
})
