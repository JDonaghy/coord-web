/**
 * Unit tests for `src/api/client.ts`'s Machines-surface functions (#76's
 * re-wire) — a mocked global `fetch` asserting request shape against the
 * real four fleet-wide endpoints (`/api/machines`, `/api/machines/health`,
 * `/api/machines/metrics`, `/api/machines/stats`), plus the per-machine
 * convenience wrappers built on top of them (client-side filter/join, no
 * network call of their own) and the version-skew degradation path issue
 * #61 established: a 404 on any of the four real endpoints resolves to an
 * honest `{available: false}`, never a thrown `Error` and never a value
 * indistinguishable from "loaded, genuinely empty."
 *
 * Fixture shapes here are transcribed from a real server's own
 * `GET /openapi.json` (#76 verified this against a local `coord web
 * --fixture` on `coord==0.5.341`), not guessed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchFleetChecks,
  fetchMachine,
  fetchMachineHealth,
  fetchMachineJobs,
  fetchMachineMetrics,
  fetchMachines,
  fetchMachinesHealth,
  fetchMachinesMetrics,
  fetchMachinesStats,
  fetchMachineWorkers,
  fetchMachineWorkStats,
  fetchFleetCapacity,
  joinMachineSeverity,
  type MachinesHealthResponse,
  type MachinesMetricsResponse,
  type MachineState,
  type MachineStatsRow,
} from '@/api/client'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeMachine(overrides: Partial<MachineState> = {}): MachineState {
  return {
    name: 'laptop',
    host: 'laptop.tailnet.ts.net',
    state: 'online',
    reason: '',
    latency_ms: 12,
    agent_version: '1.2.3',
    repos: ['coord-web'],
    worktree_bytes: null,
    ...overrides,
  }
}

describe('fetchMachines', () => {
  it('GETs /api/machines and returns {available: true, data} on 200', async () => {
    const machines: MachineState[] = [makeMachine()]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(machines), { status: 200 }))

    const result = await fetchMachines()

    expect(fetch).toHaveBeenCalledWith('/api/machines')
    expect(result).toEqual({ available: true, data: machines })
  })

  it('resolves to {available: false} on 404 -- the version-skew degradation path (#61)', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('not found', { status: 404 }))

    const result = await fetchMachines()

    expect(result).toEqual({ available: false })
  })

  it('still throws on a real server error, never silently degrading a 500', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }))

    await expect(fetchMachines()).rejects.toThrow(/HTTP 500.*boom/)
  })
})

describe('fetchMachine (client-side filter, #76)', () => {
  it('finds one roster entry by name -- no per-machine route exists', async () => {
    const machines = [makeMachine({ name: 'a b' }), makeMachine({ name: 'other' })]
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(machines), { status: 200 }))

    const result = await fetchMachine('a b')

    expect(fetch).toHaveBeenCalledWith('/api/machines')
    expect(result).toEqual({ available: true, data: machines[0] })
  })

  it('resolves to {available: false} when the roster route 404s', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))
    expect(await fetchMachine('laptop')).toEqual({ available: false })
  })

  it('resolves to {available: false} when the roster is available but has no row for this name', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([makeMachine({ name: 'other' })]), { status: 200 }))
    expect(await fetchMachine('missing')).toEqual({ available: false })
  })
})

describe('fetchMachinesHealth / fetchMachinesMetrics / fetchMachinesStats', () => {
  it('GET the real fleet-wide endpoints', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"schema":1,"refreshed_at":null,"machine_health":[],"fleet_checks":[],"truncated":false}', { status: 200 }),
    )
    await fetchMachinesHealth()
    expect(fetch).toHaveBeenLastCalledWith('/api/machines/health')

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"schema":1,"generated_at":1,"since":null,"resolution":null,"machines":{}}', { status: 200 }),
    )
    await fetchMachinesMetrics()
    expect(fetch).toHaveBeenLastCalledWith('/api/machines/metrics')

    vi.mocked(fetch).mockResolvedValueOnce(new Response('[]', { status: 200 }))
    await fetchMachinesStats()
    expect(fetch).toHaveBeenLastCalledWith('/api/machines/stats')
  })

  it('each degrades to {available: false} on 404 independently', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))

    expect(await fetchMachinesHealth()).toEqual({ available: false })
    expect(await fetchMachinesMetrics()).toEqual({ available: false })
    expect(await fetchMachinesStats()).toEqual({ available: false })
  })
})

describe('fetchMachineHealth (per-machine join, #76)', () => {
  const health: MachinesHealthResponse = {
    schema: 1,
    refreshed_at: 1_700_000_500,
    machine_health: [
      {
        machine: 'laptop',
        state: 'online',
        reason: '',
        stale: false,
        severity: 'warn',
        checked_at: 1_700_000_000,
        results: [{ key: 'disk', check_id: 'disk', scope: 'machine', title: 'Disk', label: 'disk', severity: 'warn', headroom: '86% used', detail: 'low' }],
      },
    ],
    fleet_checks: [
      { key: 'board_latency', check_id: 'board_latency', scope: 'fleet', title: 'Board latency', label: 'board latency', severity: 'ok', headroom: '10ms' },
    ],
    truncated: false,
  }

  it('finds this machine\'s row in machine_health[], minus the redundant machine key', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(health), { status: 200 }))
    const row = health.machine_health[0]
    expect(await fetchMachineHealth('laptop')).toEqual({
      available: true,
      data: { severity: row.severity, stale: row.stale, checked_at: row.checked_at, results: row.results },
    })
  })

  it('synthesizes an explicit "never polled" snapshot for a machine absent from machine_health', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(health), { status: 200 }))
    expect(await fetchMachineHealth('unheard-of')).toEqual({
      available: true,
      data: { severity: 'unknown', stale: false, checked_at: null, results: [] },
    })
  })

  it('resolves to {available: false} when /api/machines/health itself 404s', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))
    expect(await fetchMachineHealth('laptop')).toEqual({ available: false })
  })

  it('fetchFleetChecks reads fleet_checks off the same response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(health), { status: 200 }))
    expect(await fetchFleetChecks()).toEqual({ available: true, data: health.fleet_checks })
  })
})

describe('joinMachineSeverity', () => {
  it('joins each roster machine to its machine_health severity by name', () => {
    const machines = [makeMachine({ name: 'a' }), makeMachine({ name: 'b' })]
    const health: MachinesHealthResponse = {
      schema: 1,
      refreshed_at: null,
      machine_health: [
        { machine: 'a', state: 'online', reason: '', severity: 'crit', stale: false, checked_at: 1, results: [] },
      ],
      fleet_checks: [],
      truncated: false,
    }
    expect(joinMachineSeverity(machines, health)).toEqual({ a: 'crit', b: 'unknown' })
  })

  it('falls back to unknown for every machine when health is null -- never crashes, never fabricates ok', () => {
    const machines = [makeMachine({ name: 'a' })]
    expect(joinMachineSeverity(machines, null)).toEqual({ a: 'unknown' })
  })
})

describe('fetchMachineMetrics (per-machine reshape, #76)', () => {
  it('reshapes this machine\'s raw samples into cpu_pct/mem_pct series', async () => {
    const response: MachinesMetricsResponse = {
      schema: 1,
      generated_at: 100,
      since: null,
      resolution: null,
      machines: {
        laptop: [
          { timestamp: 1, status: 'ok', cpu_percent: 40, mem_percent: 60, mem_used_mb: 100, mem_total_mb: 200, reason: '' },
          { timestamp: 2, status: 'unknown', cpu_percent: null, mem_percent: null, mem_used_mb: null, mem_total_mb: null, reason: 'timeout' },
        ],
      },
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
    expect(await fetchMachineMetrics('laptop')).toEqual({
      available: true,
      data: [
        { metric: 'cpu_pct', unit: '%', points: [{ t: 1, value: 40 }, { t: 2, value: null }] },
        { metric: 'mem_pct', unit: '%', points: [{ t: 1, value: 60 }, { t: 2, value: null }] },
      ],
    })
  })

  it('a status: unknown sample is a gap even if cpu/mem happen to carry a stale number', async () => {
    const response: MachinesMetricsResponse = {
      schema: 1,
      generated_at: 100,
      since: null,
      resolution: null,
      machines: { laptop: [{ timestamp: 1, status: 'unknown', cpu_percent: 99, mem_percent: 99, mem_used_mb: null, mem_total_mb: null, reason: 'timeout' }] },
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
    const result = await fetchMachineMetrics('laptop')
    expect(result).toEqual({
      available: true,
      data: [
        { metric: 'cpu_pct', unit: '%', points: [{ t: 1, value: null }] },
        { metric: 'mem_pct', unit: '%', points: [{ t: 1, value: null }] },
      ],
    })
  })

  it('resolves to empty (but available) series for a machine absent from machines{}', async () => {
    const response: MachinesMetricsResponse = { schema: 1, generated_at: 100, since: null, resolution: null, machines: {} }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }))
    expect(await fetchMachineMetrics('unheard-of')).toEqual({
      available: true,
      data: [
        { metric: 'cpu_pct', unit: '%', points: [] },
        { metric: 'mem_pct', unit: '%', points: [] },
      ],
    })
  })

  it('resolves to {available: false} when /api/machines/metrics itself 404s', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))
    expect(await fetchMachineMetrics('laptop')).toEqual({ available: false })
  })
})

describe('fetchMachineWorkStats / fetchMachineJobs / fetchFleetCapacity (#76)', () => {
  const stats: MachineStatsRow[] = [
    {
      name: 'laptop',
      capacity: { active: 2, max: 6 },
      counts: { completed: 4, failed: 1 },
      job_history: [
        { assignment_id: 'job-1', repo_name: 'coord-web', issue_number: 10, issue_title: 'Fix', type: 'work', status: 'failed', dispatched_at: 1, finished_at: 1_699_999_000 },
      ],
    },
    {
      name: 'other',
      capacity: { active: 1, max: 4 },
      counts: { completed: 0, failed: 0 },
      job_history: [],
    },
  ]

  it('fetchMachineWorkStats reads this machine\'s row', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(stats), { status: 200 }))
    expect(await fetchMachineWorkStats('laptop')).toEqual({
      available: true,
      data: { machine: 'laptop', assignments_completed: 4, assignments_failed: 1 },
    })
  })

  it('fetchMachineWorkStats synthesizes an explicit zero row for a machine absent from the response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(stats), { status: 200 }))
    expect(await fetchMachineWorkStats('unheard-of')).toEqual({
      available: true,
      data: { machine: 'unheard-of', assignments_completed: 0, assignments_failed: 0 },
    })
  })

  it('fetchMachineJobs reads this machine\'s own job_history[] -- already scoped, no filtering needed', async () => {
    // A fresh `Response` per call -- its body is a stream that can only be
    // read once, so a shared instance would make the second call's
    // `res.json()` see an already-consumed body.
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify(stats), { status: 200 }))
    expect(await fetchMachineJobs('laptop')).toEqual({ available: true, data: stats[0].job_history })
    expect(await fetchMachineJobs('unheard-of')).toEqual({ available: true, data: [] })
  })

  it('fetchFleetCapacity sums active/max across every machine row', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(stats), { status: 200 }))
    expect(await fetchFleetCapacity()).toEqual({ available: true, data: { used: 3, total: 10 } })
  })

  it('fetchFleetCapacity reports total: null for an empty fleet, never a fabricated 0', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('[]', { status: 200 }))
    expect(await fetchFleetCapacity()).toEqual({ available: true, data: { used: 0, total: null } })
  })

  it('each degrades to {available: false} when /api/machines/stats 404s', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))
    expect(await fetchMachineWorkStats('laptop')).toEqual({ available: false })
    expect(await fetchMachineJobs('laptop')).toEqual({ available: false })
    expect(await fetchFleetCapacity()).toEqual({ available: false })
  })

  it('still throws on a real server error, never silently degrading a 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(fetchMachineWorkStats('laptop')).rejects.toThrow(/HTTP 500.*boom/)
  })
})

describe('fetchMachineWorkers (roster field read, #76)', () => {
  it('reads assignments.active off the roster row -- no separate route exists', async () => {
    const machine = makeMachine({
      name: 'laptop',
      assignments: { active: [{ assignment_id: 'wk-1', status: 'running', spec: { issue_number: 42, issue_title: 'Fix', repo_name: 'coord-web' } }] },
    })
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([machine]), { status: 200 }))
    expect(await fetchMachineWorkers('laptop')).toEqual({ available: true, data: machine.assignments?.active })
  })

  it('normalizes an absent/null assignments field to [] -- the wire omits it when idle', async () => {
    const machine = makeMachine({ name: 'idle-box' })
    delete (machine as { assignments?: unknown }).assignments
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([machine]), { status: 200 }))
    expect(await fetchMachineWorkers('idle-box')).toEqual({ available: true, data: [] })
  })

  it('resolves to {available: false} when the roster route 404s', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }))
    expect(await fetchMachineWorkers('laptop')).toEqual({ available: false })
  })
})
